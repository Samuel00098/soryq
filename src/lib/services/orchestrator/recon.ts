/**
 * Reconnaissance — the research layer of the orchestrator.
 *
 * Before dispatching a task to a coding agent, the orchestrator gathers
 * context: it reads relevant files, checks git history, looks at the project
 * structure — whatever an LLM decides would help the agent succeed on the
 * first try. The result is an enriched prompt that includes all the context
 * the agent needs, so it doesn't waste context window on discovery.
 */

import { invoke } from '@tauri-apps/api/core';

// ─── Types ──────────────────────────────────────────────────────────────────

/** One piece of information gathered during reconnaissance. */
export interface ReconFinding {
  /** Short label: "src/payment.ts", "git log (last 5)", etc. */
  label: string;
  /** The content discovered. */
  content: string;
  /** How many chars (roughly) to help the LLM prioritise. */
  size: number;
}

/** The full context bundle produced by reconnaissance. */
export interface ReconContext {
  /** Human-readable summary of what was found. */
  summary: string;
  /** Individual findings. */
  findings: ReconFinding[];
  /** Suggested prompt for the coding agent, with context baked in. */
  enrichedPrompt: string;
}

// ─── Reconnaissance logic ───────────────────────────────────────────────────

const MAX_RECON_FILES = 8;
const MAX_TOTAL_RECON_CHARS = 24000;
const MAX_FILE_READ_CHARS = 8000;

/**
 * Given a workspace root path and a user command, ask the LLM what files
 * and information would be useful to gather, then collect them.
 *
 * @param command - The user's original command(s)
 * @param rootPath - Absolute path to the project root
 * @param projectId - The project's UUID, for project-scoped git commands
 * @param projectName - Display name of the project
 * @param llmCall - A function that calls ai_complete (injected so callers
 *   can provide their own provider/credentials)
 */
export async function reconnoiter(
  command: string,
  rootPath: string,
  projectName: string,
  llmCall: (systemPrompt: string, userText: string) => Promise<string>,
  projectId?: string,
): Promise<ReconContext> {
  const plan = await planRecon(command, rootPath, projectName, llmCall);
  const findings = await executeRecon(plan, rootPath, projectId);
  const enrichedPrompt = await craftPrompt(
    command,
    findings,
    rootPath,
    projectName,
    llmCall,
  );

  const summaryLines: string[] = [];
  for (const f of findings) {
    const preview = f.content.replace(/\s+/g, ' ').trim().slice(0, 80);
    summaryLines.push(`• ${f.label} (${formatSize(f.size)}) — ${preview}…`);
  }

  return {
    summary: summaryLines.join('\n'),
    findings,
    enrichedPrompt,
  };
}

// ─── Step 1: Plan what to gather ────────────────────────────────────────────

interface ReconPlan {
  /** Files to read (relative to project root). */
  readFiles: string[];
  /** Number of git log entries to fetch. */
  gitLogCount: number;
  /** Whether to check git status/diff. */
  checkGitStatus: boolean;
  /** Whether to list the project tree. */
  listProjectTree: boolean;
}

async function planRecon(
  command: string,
  rootPath: string,
  projectName: string,
  llmCall: (systemPrompt: string, userText: string) => Promise<string>,
): Promise<ReconPlan> {
  // Read the top-level directory listing to give the LLM context.
  let projectTree = '';
  try {
    const entries = await invoke<Array<{ name: string; type: string }>>('fs_read_dir', { path: rootPath });
    const limited = entries.filter((e) => !e.name.startsWith('.') && !e.name.startsWith('node_modules')).slice(0, 40);
    projectTree = limited.map((e) => `  ${e.type === 'dir' ? '[dir]' : '[file]'} ${e.name}`).join('\n');
  } catch {
    projectTree = '(could not read directory)';
  }

  const systemPrompt = [
    'You are a reconnaissance planner for a coding agent orchestrator.',
    'Given a user command and a project structure, decide what information to gather',
    'so the coding agent has maximum context and can succeed on the first try.',
    '',
    'Return a JSON object with these fields:',
    '- "readFiles": array of relative file paths to read (most relevant first). Max ' + MAX_RECON_FILES + ' files.',
    '- "gitLogCount": number of recent git log entries to fetch (0-20, 0 = skip).',
    '- "checkGitStatus": boolean — whether to check for uncommitted changes.',
    '- "listProjectTree": boolean — whether to list the project directory structure.',
    '',
    'Be surgical. Only request files that are directly relevant to the command.',
    'Prefer source files over config files.',
    'No markdown fences — pure JSON only.',
  ].join('\n');

  const userText = [
    `Project: ${projectName}`,
    `Root: ${rootPath}`,
    '',
    'Project structure (top-level):',
    projectTree,
    '',
    `User command: ${command}`,
    '',
    'Return the JSON plan:',
  ].join('\n');

  try {
    const raw = await llmCall(systemPrompt, userText);
    const cleaned = raw.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1').trim();
    const json = JSON.parse(cleaned);
    return {
      readFiles: Array.isArray(json.readFiles) ? json.readFiles.slice(0, MAX_RECON_FILES) : [],
      gitLogCount: typeof json.gitLogCount === 'number' ? Math.min(json.gitLogCount, 20) : Math.max(json.gitLogCount, 0),
      checkGitStatus: json.checkGitStatus === true,
      listProjectTree: json.listProjectTree === true,
    };
  } catch {
    // Fallback plan if LLM parsing fails.
    return {
      readFiles: [],
      gitLogCount: 5,
      checkGitStatus: true,
      listProjectTree: true,
    };
  }
}

// ─── Step 2: Execute the plan ───────────────────────────────────────────────

async function executeRecon(plan: ReconPlan, rootPath: string, projectId?: string): Promise<ReconFinding[]> {
  // All sources are independent — kick them off in parallel.
  const filePromises = plan.readFiles.slice(0, MAX_RECON_FILES).map(
    async (relPath): Promise<ReconFinding | null> => {
      try {
        const content = await invoke<string>('fs_read_file', { path: pathJoin(rootPath, relPath) });
        const truncated = content.length > MAX_FILE_READ_CHARS
          ? content.slice(0, MAX_FILE_READ_CHARS) + '\n… (truncated)'
          : content;
        return { label: relPath, content: truncated, size: truncated.length };
      } catch {
        return null;
      }
    }
  );

  const gitLogP: Promise<ReconFinding | null> = (plan.gitLogCount > 0 && !!projectId)
    ? invoke<Array<{ graph: string; hash?: string; author?: string; date?: string; refs?: string; subject?: string }>>('workspace_git_log', { projectId })
        .then((log) => {
          if (!log?.length) return null;
          const recent = log.slice(0, plan.gitLogCount);
          const logText = recent
            .map((e) => `${e.hash ?? ''}  ${e.author ?? ''}  ${e.date ?? ''}\n    ${e.subject ?? ''}${e.refs ? ` (${e.refs})` : ''}`)
            .join('\n');
          return { label: `git log (last ${recent.length})`, content: logText, size: logText.length };
        })
        .catch(() => null)
    : Promise.resolve(null);

  const gitStatusP: Promise<ReconFinding | null> = (plan.checkGitStatus && !!projectId)
    ? invoke<{ branch: string; modified: string[]; added: string[]; deleted: string[]; untracked: string[]; file_stats: Record<string, [number, number]>; total_additions: number; total_deletions: number }>('workspace_git_status', { projectId })
        .then((status) => {
          const parts = [`Branch: ${status.branch}`];
          if (status.modified.length) parts.push(`Modified: ${status.modified.join(', ')}`);
          if (status.added.length) parts.push(`Added: ${status.added.join(', ')}`);
          if (status.deleted.length) parts.push(`Deleted: ${status.deleted.join(', ')}`);
          if (status.untracked.length) parts.push(`Untracked: ${status.untracked.join(', ')}`);
          parts.push(`+${status.total_additions} / -${status.total_deletions}`);
          const statusText = parts.join('\n');
          return statusText.trim() ? { label: 'git status (uncommitted changes)', content: statusText, size: statusText.length } : null;
        })
        .catch(() => null)
    : Promise.resolve(null);

  const gitDiffP: Promise<ReconFinding | null> = (plan.checkGitStatus && !!projectId)
    ? invoke<string>('workspace_git_diff', { projectId, filePath: null as string | null })
        .then((diff) => {
          if (!diff?.trim() || diff.length <= 10) return null;
          const truncated = diff.length > 4000 ? diff.slice(0, 4000) + '\n… (diff truncated)' : diff;
          return { label: 'git diff (working tree)', content: truncated, size: truncated.length };
        })
        .catch(() => null)
    : Promise.resolve(null);

  const treeP: Promise<ReconFinding | null> = plan.listProjectTree
    ? buildProjectTree(rootPath, 2, 50)
        .then((tree) => ({ label: 'project structure (source directories)', content: tree, size: tree.length }))
        .catch(() => null)
    : Promise.resolve(null);

  const [fileResults, gitLog, gitStatus, gitDiff, tree] = await Promise.all([
    Promise.all(filePromises),
    gitLogP,
    gitStatusP,
    gitDiffP,
    treeP,
  ]);

  // Assemble in the original priority order, then apply the total chars budget.
  const candidates: ReconFinding[] = [
    ...fileResults.filter((f): f is ReconFinding => f !== null),
    ...[gitLog, gitStatus, gitDiff, tree].filter((f): f is ReconFinding => f !== null),
  ];

  const findings: ReconFinding[] = [];
  let totalChars = 0;
  for (const f of candidates) {
    if (totalChars + f.size > MAX_TOTAL_RECON_CHARS) break;
    findings.push(f);
    totalChars += f.size;
  }
  return findings;
}

// ─── Step 3: Craft the enriched prompt ──────────────────────────────────────

async function craftPrompt(
  command: string,
  findings: ReconFinding[],
  rootPath: string,
  projectName: string,
  llmCall: (systemPrompt: string, userText: string) => Promise<string>,
): Promise<string> {
  const contextBlock = findings
    .map((f) => `─── ${f.label} ───\n${f.content}`)
    .join('\n\n');

  const systemPrompt = [
    'You are a prompt engineering specialist for coding agents.',
    'Your job is to take a user command and the context gathered from their',
    'codebase, and produce a single, self-contained, precise prompt that a',
    'coding agent (like Claude Code) can execute successfully on the first try.',
    '',
    'Rules:',
    '- Include ALL relevant context (file contents, git history) inline.',
    '- Be specific about what files to modify, what patterns to follow.',
    '- If the command is vague, use the context to infer the most likely intent.',
    '- Include exact function names, line numbers, error messages where known.',
    '- Do NOT ask the agent to do discovery — it should have everything it needs.',
    '- End with a clear definition of done (how to verify success).',
    '- Keep it concise but complete. No fluff.',
    '- Output ONLY the prompt for the coding agent — no preamble, no explanation.',
  ].join('\n');

  const userText = [
    `Project: ${projectName}`,
    `Root path: ${rootPath}`,
    '',
    '=== Context gathered from codebase ===',
    contextBlock || '(no additional context available)',
    '',
    '=== User command ===',
    command,
    '',
    'Write the prompt for the coding agent:',
  ].join('\n');

  try {
    const prompt = await llmCall(systemPrompt, userText);
    return prompt.trim() || command;
  } catch {
    // Fallback: use the original command as the prompt.
    return command;
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pathJoin(a: string, b: string): string {
  const sep = a.includes('\\') ? '\\' : '/';
  const aEnd = a.endsWith(sep) ? a.slice(0, -1) : a;
  const bStart = b.startsWith(sep) ? b.slice(1) : b;
  return `${aEnd}${sep}${bStart}`;
}

/**
 * Build a compact project tree, depth-limited, entry-limited.
 * Only shows source directories and common entry points.
 */
async function buildProjectTree(
  rootPath: string,
  maxDepth: number,
  maxEntries: number,
): Promise<string> {
  const entries: string[] = [];
  const SKIP_DIRS = new Set(['node_modules', '.git', '.soryq', 'dist', 'build', '.next', '__pycache__', 'target', '.vscode', '.idea']);
  const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.ttf', '.woff', '.woff2', '.eot']);

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth || entries.length >= maxEntries) return;
    try {
      const items = await invoke<Array<{ name: string; type: string }>>('fs_read_dir', { path: dir });
      for (const item of items) {
        if (entries.length >= maxEntries) return;
        if (item.name.startsWith('.')) continue;
        if (item.type === 'dir' && SKIP_DIRS.has(item.name)) continue;
        if (item.type !== 'dir' && SKIP_EXT.has(item.name.slice(item.name.lastIndexOf('.')))) continue;

        const indent = '  '.repeat(depth);
        const relative = dir === rootPath ? item.name : `${dir.slice(rootPath.length + 1)}/${item.name}`;
        entries.push(`${indent}${item.type === 'dir' ? '[dir]' : '[file]'} ${relative}`);
        if (item.type === 'dir') {
          await walk(`${dir}/${item.name}`, depth + 1);
        }
      }
    } catch {
      // Permission denied, etc.
    }
  }

  await walk(rootPath, 0);
  return entries.join('\n');
}

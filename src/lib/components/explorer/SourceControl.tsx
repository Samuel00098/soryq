import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { activeProject, activeProjectId } from '$lib/stores/workspace';
import { openFile } from '$lib/stores/editor';
import { showToast } from '$lib/stores/notification';
import FileIcon from './FileIcon.tsx';
import {
  branchInfo,
  checkoutBranch,
  createBranch,
  deleteBranch,
  refreshBranches,
} from '$lib/stores/gitBranch';
import type { GitBranchInfo } from '$lib/stores/zustand/gitBranch';
import {
  aiProvider,
  currentAiModel,
  getProviderBaseUrl,
  getProviderDef,
  isLocalProvider,
} from '$lib/stores/settings';
import { isProviderApiKeyConfiguredLocal } from '$lib/services/ai-keychain';
import { createGithubRepo, githubTokenExists, saveGithubToken } from '$lib/services/github';
import { devpet } from '$lib/stores/devpet';
import { useStore } from '$lib/react/useStore';
import { useGitStatusCache, type GitStatusData as GitStatus, type GitLogEntry } from '$lib/stores/zustand/gitStatus';
import './SourceControl.css';

type FileKind = 'modified' | 'added' | 'deleted' | 'untracked' | 'conflicted';

const graphColors = ['#22d3ee', '#a78bfa', '#fb7185', '#34d399', '#fbbf24', '#60a5fa', '#f472b6'];

function getGraphColor(idx: number) {
  return graphColors[idx % graphColors.length];
}

function Spinner({ size = 12 }: { size?: number }) {
  return (
    <svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <polyline points="21 3 21 8 16 8" />
    </svg>
  );
}

function BranchIcon({ className }: { className?: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 01-9 9" />
    </svg>
  );
}

export default function SourceControl() {
  const project = useStore(activeProject);
  const projectId = useStore(activeProjectId);
  const branches = useStore(branchInfo);
  const provider = useStore(aiProvider);
  const model = useStore(currentAiModel);

  // Read git status/history from the persistent per-project cache so reopening
  // the panel shows the last-known state instantly (no remount-cold skeleton).
  const gitStatus = useGitStatusCache((s) => (projectId ? s.statusByProject[projectId] ?? null : null));
  const gitHistory = useGitStatusCache((s) => (projectId ? s.historyByProject[projectId] ?? null : null));
  const [isFetchingStatus, setIsFetchingStatus] = useState(false);
  const [isFetchingHistory, setIsFetchingHistory] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isGeneratingMsg, setIsGeneratingMsg] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [changesExpanded, setChangesExpanded] = useState(true);
  const [commitsExpanded, setCommitsExpanded] = useState(true);

  const [publishOpen, setPublishOpen] = useState(false);
  const [publishName, setPublishName] = useState('');
  const [publishDesc, setPublishDesc] = useState('');
  const [publishPrivate, setPublishPrivate] = useState(true);
  const [isPublishing, setIsPublishing] = useState(false);
  const [githubTokenSaved, setGithubTokenSaved] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [publishError, setPublishError] = useState<string | null>(null);

  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [knownFiles, setKnownFiles] = useState<Set<string>>(new Set());
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [newBranchMode, setNewBranchMode] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchFrom, setNewBranchFrom] = useState('');
  const [branchSearch, setBranchSearch] = useState('');
  const [deleteConfirmBranch, setDeleteConfirmBranch] = useState<string | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);

  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const refreshGenerationRef = useRef(0);
  const statusRequestGenerationRef = useRef(0);
  const historyRequestGenerationRef = useRef(0);
  const projectRef = useRef(project);
  const projectIdRef = useRef(projectId);
  const branchesRef = useRef<GitBranchInfo | null>(branches);
  const providerRef = useRef(provider);
  const modelRef = useRef(model);
  const commitMessageRef = useRef(commitMessage);
  const selectedFilesRef = useRef(selectedFiles);
  const knownFilesRef = useRef(knownFiles);

  projectRef.current = project;
  projectIdRef.current = projectId;
  branchesRef.current = branches;
  providerRef.current = provider;
  modelRef.current = model;
  commitMessageRef.current = commitMessage;
  selectedFilesRef.current = selectedFiles;
  knownFilesRef.current = knownFiles;

  const notAGitRepo = !!errorMsg && errorMsg.toLowerCase().includes('not a git repository');
  const needsPublish = notAGitRepo || (!!branches && branches.has_remote === false);
  const allChangedFiles = useMemo(
    () => (gitStatus ? [...gitStatus.modified, ...gitStatus.added, ...gitStatus.deleted, ...gitStatus.untracked] : []),
    [gitStatus],
  );
  const selectedCount = useMemo(
    () => allChangedFiles.filter((file) => selectedFiles.has(file)).length,
    [allChangedFiles, selectedFiles],
  );
  const allSelected = allChangedFiles.length > 0 && selectedCount === allChangedFiles.length;
  const aheadCount = branches?.ahead ?? 0;
  const behindCount = branches?.behind ?? 0;
  const isUnpublished = !!branches && branches.has_remote && branches.upstream === null;
  const hasUnpushed = aheadCount > 0 || isUnpublished;
  const totalChanges = gitStatus
    ? gitStatus.modified.length + gitStatus.added.length + gitStatus.deleted.length + gitStatus.untracked.length + (gitStatus.conflicted?.length ?? 0)
    : 0;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedCount > 0 && !allSelected;
    }
  }, [allSelected, selectedCount]);

  useEffect(() => {
    if (projectId) {
      // Don't clear the cached status/history — keep showing the last-known
      // state while a background refresh runs, so the panel never flashes empty.
      setErrorMsg(null);
      setBranchPickerOpen(false);
      setNewBranchMode(false);
      setDeleteConfirmBranch(null);
      setBranchError(null);
      setCommitMessage('');
      setSelectedFiles(new Set());
      setKnownFiles(new Set());
      void refreshAll();
      void refreshBranches(projectId);
    } else {
      setErrorMsg(null);
    }
  }, [projectId]);

  function toggleFile(file: string) {
    setSelectedFiles((current) => {
      const next = new Set(current);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  }

  function toggleAllFiles() {
    setSelectedFiles(allSelected ? new Set() : new Set(allChangedFiles));
  }

  async function openPublish() {
    setPublishError(null);
    const base = (projectRef.current?.name ?? '').trim();
    setPublishName(base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-project');
    setGithubTokenSaved(await githubTokenExists());
    setPublishOpen(true);
  }

  async function doPublish() {
    const id = projectIdRef.current;
    const name = publishName.trim();
    if (!id || !name) return;

    setPublishError(null);
    setIsPublishing(true);
    try {
      if (!githubTokenSaved) {
        const token = tokenInput.trim();
        if (!token) {
          setPublishError('Enter a GitHub personal access token first.');
          return;
        }
        await saveGithubToken(token);
        setGithubTokenSaved(true);
        setTokenInput('');
      }

      const result = await createGithubRepo(id, name, publishDesc.trim(), publishPrivate);
      showToast(
        result.pushed ? `Published to ${result.full_name}!` : `Created ${result.full_name} - commit some files, then push.`,
        'success',
      );
      setPublishOpen(false);
      setPublishDesc('');
      if (result.html_url) {
        invoke('preview_open_in_browser', { url: result.html_url }).catch(() => {});
      }
      await refreshAll();
    } catch (err) {
      setPublishError(String(err));
    } finally {
      setIsPublishing(false);
    }
  }

  async function refreshAll() {
    const generation = ++refreshGenerationRef.current;
    setErrorMsg(null);
    const id = projectIdRef.current;
    await Promise.all([
      fetchStatus(generation),
      fetchHistory(generation),
      id ? refreshBranches(id) : Promise.resolve(),
    ]);
  }

  async function fetchStatus(generation: number) {
    const id = projectIdRef.current;
    if (!id) return;

    const requestGeneration = ++statusRequestGenerationRef.current;
    setIsFetchingStatus(true);
    try {
      const status = await invoke<GitStatus>('workspace_git_status', { projectId: id });
      if (generation !== refreshGenerationRef.current || requestGeneration !== statusRequestGenerationRef.current) return;
      useGitStatusCache.getState().setStatus(id, status);

      const files = [...status.modified, ...status.added, ...status.deleted, ...status.untracked];
      const nextSelection = new Set<string>();
      for (const file of files) {
        if (!knownFilesRef.current.has(file) || selectedFilesRef.current.has(file)) nextSelection.add(file);
      }
      setSelectedFiles(nextSelection);
      selectedFilesRef.current = nextSelection;
      const nextKnown = new Set(files);
      setKnownFiles(nextKnown);
      knownFilesRef.current = nextKnown;

      if (!commitMessageRef.current.trim()) {
        const filenames = files.map((filePath) => {
          const parts = filePath.split(/[/\\]/);
          return parts[parts.length - 1];
        });
        const uniqueFilenames = Array.from(new Set(filenames));
        let nextMessage = '';
        if (uniqueFilenames.length === 1) nextMessage = `Update ${uniqueFilenames[0]}`;
        else if (uniqueFilenames.length === 2) nextMessage = `Update ${uniqueFilenames[0]} and ${uniqueFilenames[1]}`;
        else if (uniqueFilenames.length > 2) nextMessage = `Update ${uniqueFilenames[0]}, ${uniqueFilenames[1]} and ${uniqueFilenames.length - 2} other files`;
        else nextMessage = 'Auto-update from Forge';

        if (files.length > 0) {
          setCommitMessage(nextMessage);
          commitMessageRef.current = nextMessage;
        }
      }
    } catch (err) {
      if (generation !== refreshGenerationRef.current || requestGeneration !== statusRequestGenerationRef.current) return;
      console.error('Failed to get git status:', err);
      setErrorMsg(String(err));
    } finally {
      if (generation === refreshGenerationRef.current && requestGeneration === statusRequestGenerationRef.current) {
        setIsFetchingStatus(false);
      }
    }
  }

  async function fetchHistory(generation: number) {
    const id = projectIdRef.current;
    if (!id) return;

    const requestGeneration = ++historyRequestGenerationRef.current;
    setIsFetchingHistory(true);
    try {
      const history = await invoke<GitLogEntry[]>('workspace_git_log', { projectId: id });
      if (generation !== refreshGenerationRef.current || requestGeneration !== historyRequestGenerationRef.current) return;
      useGitStatusCache.getState().setHistory(id, history);
    } catch (err) {
      if (generation !== refreshGenerationRef.current || requestGeneration !== historyRequestGenerationRef.current) return;
      console.error('Failed to get git history:', err);
    } finally {
      if (generation === refreshGenerationRef.current && requestGeneration === historyRequestGenerationRef.current) {
        setIsFetchingHistory(false);
      }
    }
  }

  async function triggerGitCommit() {
    const id = projectIdRef.current;
    if (!id || !commitMessage.trim()) return;
    if (allChangedFiles.length > 0 && selectedCount === 0) {
      showToast('Select at least one file to commit.', 'warning');
      return;
    }

    const files = allSelected ? null : allChangedFiles.filter((file) => selectedFiles.has(file));
    setIsCommitting(true);
    showToast('Committing changes...', 'info');
    try {
      await invoke<string>('workspace_git_commit', { projectId: id, message: commitMessage.trim(), files });
      showToast('Successfully committed changes!', 'success');
      devpet.onCommit();
      setCommitMessage('');
      commitMessageRef.current = '';
      await refreshAll();
    } catch (err) {
      console.error(err);
      showToast(String(err) || 'Git commit failed.', 'error');
    } finally {
      setIsCommitting(false);
    }
  }

  async function triggerGitPush() {
    const id = projectIdRef.current;
    if (!id) return;

    setIsPushing(true);
    showToast('Pushing to GitHub...', 'info');
    try {
      const response = await invoke<string>('workspace_git_push', { projectId: id });
      showToast(response || 'Successfully pushed to GitHub!', 'success');
      devpet.onPush();
      await refreshAll();
    } catch (err) {
      console.error(err);
      showToast(String(err) || 'Git push failed.', 'error');
    } finally {
      setIsPushing(false);
    }
  }

  async function triggerGitFetch() {
    const id = projectIdRef.current;
    if (!id) return;

    setIsFetching(true);
    showToast('Fetching from GitHub...', 'info');
    try {
      const response = await invoke<string>('workspace_git_fetch', { projectId: id });
      showToast(response || 'Successfully fetched from GitHub!', 'success');
      await refreshAll();
    } catch (err) {
      console.error(err);
      showToast(String(err) || 'Git fetch failed.', 'error');
    } finally {
      setIsFetching(false);
    }
  }

  async function handleFileClick(relativePath: string) {
    const currentProject = projectRef.current;
    if (!currentProject) return;
    try {
      await openFile(`${currentProject.root_path}/${relativePath}`);
    } catch (err) {
      console.error('Failed to open file:', err);
      showToast('Failed to open file', 'error');
    }
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void triggerGitCommit();
    }
  }

  async function generateCommitMessage() {
    const id = projectIdRef.current;
    if (!id) return;

    setIsGeneratingMsg(true);
    try {
      const diff = await invoke<string>('workspace_git_diff', { projectId: id, filePath: null });
      const untrackedSection = gitStatus?.untracked.length ? `\n\nNew untracked files:\n${gitStatus.untracked.join('\n')}` : '';
      const context = (diff || '') + untrackedSection;
      if (!context.trim()) {
        showToast('No changes to summarize.', 'info');
        return;
      }

      const currentProvider = providerRef.current;
      const local = isLocalProvider(currentProvider);
      const baseUrl = local ? getProviderBaseUrl(currentProvider) : '';
      if (!local && !isProviderApiKeyConfiguredLocal(currentProvider)) {
        showToast(`Add your ${getProviderDef(currentProvider).label} API key in Settings -> Models to generate commit messages.`, 'warning');
        return;
      }

      const message = await invoke<string>('ai_generate_commit_message', {
        diff: context,
        provider: currentProvider,
        model: modelRef.current,
        apiKey: '',
        baseUrl: baseUrl || undefined,
      });
      setCommitMessage(message);
      commitMessageRef.current = message;
    } catch (err) {
      const msg = String(err);
      const currentProvider = providerRef.current;
      if (msg.includes('API key is not set')) {
        showToast(`Add your ${getProviderDef(currentProvider).label} API key in Settings -> Models to generate commit messages.`, 'warning');
      } else if (msg.includes('Server URL is not set')) {
        showToast(`Set your ${getProviderDef(currentProvider).label} server URL in Settings -> Models to generate commit messages.`, 'warning');
      } else {
        showToast(msg || 'Failed to generate commit message.', 'error');
      }
    } finally {
      setIsGeneratingMsg(false);
    }
  }

  async function createBranchSubmit() {
    const currentProject = projectRef.current;
    if (!newBranchName.trim() || !currentProject) return;
    try {
      await createBranch(currentProject.id, newBranchName.trim(), newBranchFrom || undefined);
      setNewBranchMode(false);
      setBranchError(null);
    } catch (err) {
      setBranchError(String(err));
    }
  }

  async function switchBranch(branch: string) {
    const currentProject = projectRef.current;
    if (!currentProject) return;
    try {
      await checkoutBranch(currentProject.id, branch);
      setBranchPickerOpen(false);
      setBranchError(null);
    } catch (err) {
      setBranchError(String(err));
    }
  }

  async function createFromRemote(branch: string) {
    const currentProject = projectRef.current;
    if (!currentProject) return;
    const localName = branch.split('/').slice(1).join('/');
    try {
      await createBranch(currentProject.id, localName, branch);
      setBranchPickerOpen(false);
    } catch (err) {
      setBranchError(String(err));
    }
  }

  async function confirmDeleteBranch(branch: string) {
    const currentProject = projectRef.current;
    if (!currentProject) return;
    try {
      await deleteBranch(currentProject.id, branch);
      setDeleteConfirmBranch(null);
    } catch (err) {
      setBranchError(String(err));
      setDeleteConfirmBranch(null);
    }
  }

  function renderPublishForm() {
    return (
      <div className="publish-form">
        <div className="publish-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 22 12c0-5.52-4.48-10-10-10z" />
          </svg>
          Publish to GitHub
        </div>
        {!githubTokenSaved && (
          <>
            <input className="publish-input" type="password" placeholder="Personal access token (ghp_...)" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} autoComplete="off" />
            <button className="publish-help" onClick={() => invoke('preview_open_in_browser', { url: 'https://github.com/settings/tokens/new?scopes=repo&description=Soryq' }).catch(() => {})}>
              Create a token with 'repo' scope -&gt;
            </button>
          </>
        )}
        <div className="publish-security-note">
          GitHub tokens are stored in the OS keychain and used only for repository create/push actions from this project.
        </div>
        <input className="publish-input" type="text" placeholder="repository-name" value={publishName} onChange={(event) => setPublishName(event.target.value)} autoComplete="off" />
        <input className="publish-input" type="text" placeholder="Description (optional)" value={publishDesc} onChange={(event) => setPublishDesc(event.target.value)} autoComplete="off" />
        <label className="publish-checkbox">
          <input type="checkbox" checked={publishPrivate} onChange={(event) => setPublishPrivate(event.target.checked)} />
          <span>Private repository</span>
        </label>
        {publishError && <div className="publish-err-msg">{publishError}</div>}
        <div className="publish-actions">
          <button className="publish-create-btn" onClick={() => void doPublish()} disabled={isPublishing || !publishName.trim() || (!githubTokenSaved && !tokenInput.trim())}>
            {isPublishing ? <><Spinner /><span>Publishing...</span></> : <span>Create &amp; Push</span>}
          </button>
          <button className="publish-cancel-btn" onClick={() => { setPublishOpen(false); setPublishError(null); }}>Cancel</button>
        </div>
      </div>
    );
  }

  function renderFileRow(file: string, kind: FileKind, badge: string, openable: boolean) {
    const checked = selectedFiles.has(file);
    return (
      <div key={`${kind}:${file}`} className={`sc-file-item ${kind}${checked ? '' : ' unselected'}`}>
        <input
          type="checkbox"
          className="sc-file-check"
          checked={checked}
          onChange={() => toggleFile(file)}
          title={checked ? 'Exclude from commit' : 'Include in commit'}
          aria-label={`Include ${file} in commit`}
        />
        <button className="sc-file-open" onClick={() => openable && void handleFileClick(file)} disabled={!openable} title={openable ? file : 'Deleted file cannot be opened'}>
          <FileIcon name={file.split('/').pop() || ''} isDir={false} />
          <span className="file-path">{file}</span>
          <span className={`status-badge ${kind}`}>{badge}</span>
        </button>
      </div>
    );
  }

  function renderGraphChar(char: string, idx: number) {
    const style = { color: getGraphColor(idx) };
    if (char === '*') return <span key={idx} className="graph-node" style={style}>&bull;</span>;
    if (char === '|') return <span key={idx} className="graph-line" style={style}>&#9474;</span>;
    if (char === '/') return <span key={idx} className="graph-line" style={style}>/</span>;
    if (char === '\\') return <span key={idx} className="graph-line" style={style}>\</span>;
    if (char === '_') return <span key={idx} className="graph-line" style={style}>&#9472;</span>;
    return <span key={idx} className="graph-space">{char}</span>;
  }

  const filteredLocalBranches = (branches?.local ?? []).filter((branch) => branch.toLowerCase().includes(branchSearch.toLowerCase()));
  const filteredRemoteBranches = (branches?.remote ?? []).filter((branch) => branch.toLowerCase().includes(branchSearch.toLowerCase()));

  return (
    <>
      <div className="source-control">
        <div className="sc-header">
          <span className="sc-title">Source Control</span>
          <div className="sc-header-actions">
            <button className="header-btn" onClick={() => void triggerGitFetch()} title="Fetch from Remote" disabled={isFetching}>
              <svg className={isFetching ? 'spin' : undefined} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
            <button className="header-btn" onClick={() => void refreshAll()} title="Refresh Status & History" disabled={isFetchingStatus || isFetchingHistory}>
              <svg className={isFetchingStatus || isFetchingHistory ? 'spin' : undefined} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23,4 23,10 17,10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
          </div>
        </div>

        {project && (
          <>
            <div className="branch-bar">
              <BranchIcon className="branch-icon" />
              <button className="branch-name-btn" onClick={() => { setBranchPickerOpen((open) => !open); setBranchSearch(''); }} title="Switch branch">
                {branches?.current || 'no branch'}
              </button>
              {branches?.has_remote && (
                isUnpublished ? (
                  <span className="sync-badge unpublished" title="This branch is not on the remote yet - Push to publish it">unpublished</span>
                ) : (aheadCount > 0 || behindCount > 0) && (
                  <span className="sync-badge" title={`${aheadCount} ahead / ${behindCount} behind ${branches?.upstream}`}>
                    {aheadCount > 0 && <span className="ahead">&uarr;{aheadCount}</span>}
                    {behindCount > 0 && <span className="behind">&darr;{behindCount}</span>}
                  </span>
                )
              )}
              <button className="branch-new-btn" onClick={() => { setNewBranchMode(true); setNewBranchName(''); setNewBranchFrom(branchesRef.current?.current || ''); setBranchPickerOpen(false); }} title="New branch">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>

            {branchPickerOpen && (
              <div className="branch-picker">
                <input className="branch-search" type="text" placeholder="Filter branches..." value={branchSearch} onChange={(event) => setBranchSearch(event.target.value)} />
                <div className="branch-list">
                  {filteredLocalBranches.map((branch) => (
                    <div key={branch} className={`branch-item${branch === branches?.current ? ' current' : ''}`}>
                      <button className="branch-item-name" onClick={() => void switchBranch(branch)}>
                        {branch === branches?.current && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                        {branch}
                      </button>
                      {branch !== branches?.current && (
                        deleteConfirmBranch === branch ? (
                          <span className="delete-confirm-row">
                            <button className="delete-yes" onClick={() => void confirmDeleteBranch(branch)}>Delete</button>
                            <button className="delete-no" onClick={() => setDeleteConfirmBranch(null)}>Cancel</button>
                          </span>
                        ) : (
                          <button className="branch-delete-btn" onClick={() => setDeleteConfirmBranch(branch)} title="Delete branch">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" />
                            </svg>
                          </button>
                        )
                      )}
                    </div>
                  ))}
                  {filteredRemoteBranches.length > 0 && (
                    <>
                      <div className="branch-section-label">Remote</div>
                      {filteredRemoteBranches.map((branch) => (
                        <div key={branch} className="branch-item remote">
                          <button className="branch-item-name" onClick={() => void createFromRemote(branch)}>{branch}</button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}

            {newBranchMode && (
              <div className="new-branch-form">
                <input
                  className="branch-input"
                  type="text"
                  placeholder="Branch name..."
                  value={newBranchName}
                  onChange={(event) => setNewBranchName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void createBranchSubmit();
                    if (event.key === 'Escape') setNewBranchMode(false);
                  }}
                />
                <div className="new-branch-actions">
                  <button className="branch-create-btn" onClick={() => void createBranchSubmit()}>Create</button>
                  <button className="branch-cancel-btn" onClick={() => setNewBranchMode(false)}>Cancel</button>
                </div>
              </div>
            )}

            {branchError && <div className="branch-error">{branchError} <button onClick={() => setBranchError(null)}>x</button></div>}

            <div className="sc-scope-note">
              <span>Project</span>
              <strong title={project.root_path}>{project.name}</strong>
              <em>Git actions run against this open project folder.</em>
            </div>
          </>
        )}

        <div className="sc-content">
          {errorMsg && notAGitRepo ? (
            <div className="sc-clean">
              <BranchIcon />
              <p>Not on GitHub yet</p>
              <p className="sub">This folder isn't a Git repository. Publish it to create a repo and push your files.</p>
              {publishOpen ? renderPublishForm() : <button className="publish-cta" onClick={() => void openPublish()}>Publish to GitHub</button>}
            </div>
          ) : errorMsg ? (
            <div className="sc-error">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p>{errorMsg}</p>
            </div>
          ) : (isFetchingStatus && !gitStatus) || (isFetchingHistory && !gitHistory) ? (
            <div className="sc-loading-skeleton-container">
              <div className="skeleton-header">
                <div className="skeleton-bar skeleton-header-short" />
                <div className="skeleton-bar skeleton-header-long" />
              </div>
              <div className="skeleton-list">
                {[0, 1, 2].map((idx) => (
                  <div key={idx} className="skeleton-list-item">
                    <div className="skeleton-bar skeleton-check" />
                    <div className="skeleton-bar skeleton-file" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              {needsPublish && (
                <div className="publish-banner">
                  {publishOpen ? renderPublishForm() : (
                    <div className="publish-banner-row">
                      <span className="publish-banner-text">This repo isn't on GitHub yet.</span>
                      <button className="publish-cta small" onClick={() => void openPublish()}>Publish to GitHub</button>
                    </div>
                  )}
                </div>
              )}

              <div className="sc-commit-section">
                <div className="sc-commit-input-wrap">
                  <textarea
                    className="sc-commit-input"
                    placeholder="Commit message (Ctrl+Enter to commit)..."
                    value={commitMessage}
                    onChange={(event) => setCommitMessage(event.target.value)}
                    onKeyDown={handleInputKeyDown}
                    rows={5}
                  />
                  <button className="ai-gen-btn" onClick={() => void generateCommitMessage()} disabled={isGeneratingMsg} title="Generate commit message with AI">
                    {isGeneratingMsg ? <Spinner /> : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
                        <path d="M19 15l.75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75z" />
                      </svg>
                    )}
                  </button>
                </div>

                <button
                  className="sc-action-btn commit-btn"
                  onClick={() => void triggerGitCommit()}
                  disabled={isCommitting || !commitMessage.trim() || (totalChanges > 0 && selectedCount === 0)}
                  title={totalChanges > 0 && selectedCount === 0 ? 'Select at least one file to commit' : 'Commit changes locally (Ctrl+Enter)'}
                >
                  {isCommitting ? <><Spinner /><span>Committing...</span></> : <span>Commit</span>}
                </button>

                <button
                  className={`sc-action-btn push-btn${hasUnpushed ? ' has-unpushed' : ''}`}
                  onClick={() => void triggerGitPush()}
                  disabled={isPushing}
                  title={hasUnpushed ? (isUnpublished ? 'Publish this branch to the remote' : `Push ${aheadCount} local commit${aheadCount === 1 ? '' : 's'} to remote`) : 'Push committed changes to remote repository'}
                >
                  {isPushing ? <><Spinner /><span>Pushing...</span></> : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
                      </svg>
                      <span>Push{aheadCount > 0 ? ` (${aheadCount})` : ''}</span>
                    </>
                  )}
                </button>
              </div>

              <div className="sc-scrollable">
                <div className="sc-section-head-row">
                  <button className="sc-section-header" onClick={() => setChangesExpanded((expanded) => !expanded)} aria-expanded={changesExpanded}>
                    <svg className={`chevron${changesExpanded ? ' expanded' : ''}`} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    <span className="sc-section-title">Changes ({totalChanges})</span>
                  </button>
                  {totalChanges > 0 && (
                    <label className="sc-select-all" title="Select all / none">
                      <input ref={selectAllRef} type="checkbox" checked={allSelected} onChange={toggleAllFiles} aria-label="Select all files for commit" />
                      <span>{selectedCount}/{totalChanges}</span>
                    </label>
                  )}
                </div>

                {changesExpanded && (
                  gitStatus && totalChanges > 0 ? (
                    <div className="sc-files">
                      {(gitStatus.conflicted ?? []).map((file) => renderFileRow(file, 'conflicted', '!', true))}
                      {gitStatus.modified.map((file) => renderFileRow(file, 'modified', 'M', true))}
                      {gitStatus.added.map((file) => renderFileRow(file, 'added', 'A', true))}
                      {gitStatus.deleted.map((file) => renderFileRow(file, 'deleted', 'D', false))}
                      {gitStatus.untracked.map((file) => renderFileRow(file, 'untracked', 'U', true))}
                    </div>
                  ) : (
                    <div className="sc-clean">
                      <svg width="48" height="48" viewBox="0 0 64 64" fill="none" stroke="currentColor" className="animated-svg-floating">
                        <circle cx="32" cy="32" r="28" fill="var(--bg-hover)" stroke="var(--border)" strokeWidth="1" />
                        <circle cx="32" cy="32" r="20" fill="rgba(74, 222, 128, 0.08)" stroke="rgba(74, 222, 128, 0.2)" strokeWidth="1.5" />
                        <path d="M22 18 L 32,28 M 32,28 L 32,46" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" />
                        <circle cx="22" cy="18" r="4" fill="var(--bg-secondary)" stroke="var(--text-muted)" strokeWidth="2" />
                        <circle cx="32" cy="46" r="4" fill="var(--bg-secondary)" stroke="var(--text-muted)" strokeWidth="2" />
                        <circle cx="42" cy="22" r="8" fill="var(--success)" stroke="var(--bg-secondary)" strokeWidth="2" />
                        <polyline points="39 22 41 24 45 20" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <p>Workspace is Clean</p>
                      <p className="sub">No modifications detected in your git working tree.</p>
                    </div>
                  )
                )}

                <button className="sc-section-header" onClick={() => setCommitsExpanded((expanded) => !expanded)} aria-expanded={commitsExpanded}>
                  <svg className={`chevron${commitsExpanded ? ' expanded' : ''}`} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <span className="sc-section-title">Commits (Graph)</span>
                </button>

                {commitsExpanded && (
                  <div className="sc-commits-list">
                    {gitHistory && gitHistory.length > 0 ? (
                      gitHistory.map((entry, entryIndex) => (
                        <div key={`${entry.hash ?? 'graph'}:${entryIndex}`} className={`history-row${entry.hash ? '' : ' graph-only'}`}>
                          <span className="graph-col">{entry.graph.split('').map(renderGraphChar)}</span>
                          {entry.hash && (
                            <div className="commit-info">
                              <div className="commit-meta">
                                <span className="commit-hash" title={entry.hash}>{entry.hash}</span>
                                {entry.refs && <span className="commit-ref-badge" title={entry.refs}>{entry.refs}</span>}
                                <span className="commit-date" title={`Author: ${entry.author || ''}`}>{entry.date}</span>
                              </div>
                              <span className="commit-subject" title={entry.subject ?? undefined}>{entry.subject}</span>
                            </div>
                          )}
                        </div>
                      ))
                    ) : isFetchingHistory ? (
                      <div className="sc-loading-skeleton">
                        {[0, 1, 2, 3].map((idx) => (
                          <div key={idx} className="skeleton-item">
                            <div className="skeleton-dot" />
                            <div className="skeleton-col">
                              <div className="skeleton-bar skeleton-commit-short" />
                              <div className="skeleton-bar skeleton-commit-long" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="sc-clean">
                        <svg width="48" height="48" viewBox="0 0 64 64" fill="none" stroke="currentColor" className="animated-svg-floating">
                          <circle cx="32" cy="32" r="28" fill="var(--bg-hover)" stroke="var(--border)" strokeWidth="1" />
                          <path d="M32 14v36" stroke="var(--text-muted)" strokeDasharray="3,3" strokeWidth="2" />
                          <circle cx="32" cy="20" r="4" fill="var(--text-muted)" />
                          <circle cx="32" cy="32" r="4" fill="var(--text-muted)" />
                          <circle cx="32" cy="44" r="4" fill="var(--text-muted)" />
                          <circle cx="44" cy="32" r="7" fill="var(--warning)" stroke="var(--bg-secondary)" strokeWidth="1.5" />
                          <line x1="44" y1="29" x2="44" y2="33" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                          <circle cx="44" cy="36" r="0.75" fill="#fff" />
                        </svg>
                        <p>No Commit History</p>
                        <p className="sub">This branch has no commits recorded yet.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

import { useMemo, type CSSProperties } from 'react';

type IconDef = { color: string; icon: string };

const shrink: CSSProperties = { flexShrink: 0 };

function getIconDef(name: string, isDir: boolean): IconDef {
  if (isDir) return { color: '#e8b84b', icon: 'folder' };

  const lower = name.toLowerCase();
  const ext = lower.split('.').pop() || '';

  // Special filenames
  if (lower === 'package.json' || lower === 'package-lock.json') return { color: '#cb3837', icon: 'npm' };
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return { color: '#2496ed', icon: 'docker' };
  if (lower === '.gitignore' || lower === '.gitattributes') return { color: '#f05032', icon: 'git' };
  if (lower === '.env' || lower.startsWith('.env.')) return { color: '#ecd53f', icon: 'env' };
  if (lower === 'readme.md' || lower === 'readme') return { color: '#4ec9b0', icon: 'markdown' };
  if (lower === 'cargo.toml' || lower === 'cargo.lock') return { color: '#dea584', icon: 'rust' };
  if (lower === 'tailwind.config.js' || lower === 'tailwind.config.ts') return { color: '#38bdf8', icon: 'tailwind' };
  if (lower === 'vite.config.js' || lower === 'vite.config.ts') return { color: '#646cff', icon: 'vite' };
  if (lower === 'svelte.config.js' || lower === 'svelte.config.ts') return { color: '#ff3e00', icon: 'svelte' };
  const map: Record<string, IconDef> = {
    // Web
    ts: { color: '#3178c6', icon: 'typescript' },
    tsx: { color: '#61dafb', icon: 'react' },
    js: { color: '#f7df1e', icon: 'javascript' },
    jsx: { color: '#61dafb', icon: 'react' },
    mjs: { color: '#f7df1e', icon: 'javascript' },
    cjs: { color: '#f7df1e', icon: 'javascript' },
    html: { color: '#e44d26', icon: 'html' },
    htm: { color: '#e44d26', icon: 'html' },
    css: { color: '#264de4', icon: 'css' },
    scss: { color: '#cc6699', icon: 'scss' },
    sass: { color: '#cc6699', icon: 'scss' },
    less: { color: '#1d365d', icon: 'less' },
    svelte: { color: '#ff3e00', icon: 'svelte' },
    vue: { color: '#4dba87', icon: 'vue' },
    astro: { color: '#ff5d01', icon: 'astro' },

    // Config / Data
    json: { color: '#fbc02d', icon: 'json' },
    jsonc: { color: '#fbc02d', icon: 'json' },
    yaml: { color: '#cc1a1a', icon: 'yaml' },
    yml: { color: '#cc1a1a', icon: 'yaml' },
    toml: { color: '#9c4221', icon: 'toml' },
    xml: { color: '#ff8a00', icon: 'xml' },
    csv: { color: '#4caf50', icon: 'csv' },
    env: { color: '#ecd53f', icon: 'env' },

    // Languages
    rs: { color: '#dea584', icon: 'rust' },
    py: { color: '#3572a5', icon: 'python' },
    rb: { color: '#701516', icon: 'ruby' },
    go: { color: '#00add8', icon: 'go' },
    java: { color: '#b07219', icon: 'java' },
    kt: { color: '#a97bff', icon: 'kotlin' },
    swift: { color: '#f05138', icon: 'swift' },
    cpp: { color: '#f34b7d', icon: 'cpp' },
    c: { color: '#555555', icon: 'c' },
    cs: { color: '#178600', icon: 'csharp' },
    php: { color: '#4f5d95', icon: 'php' },
    lua: { color: '#000080', icon: 'lua' },
    dart: { color: '#00b4ab', icon: 'dart' },
    zig: { color: '#ec915c', icon: 'zig' },

    // Shell / Scripts
    sh: { color: '#89e051', icon: 'shell' },
    bash: { color: '#89e051', icon: 'shell' },
    zsh: { color: '#89e051', icon: 'shell' },
    fish: { color: '#89e051', icon: 'shell' },
    ps1: { color: '#012456', icon: 'powershell' },
    bat: { color: '#c1f12e', icon: 'shell' },
    cmd: { color: '#c1f12e', icon: 'shell' },

    // Docs
    md: { color: '#4ec9b0', icon: 'markdown' },
    mdx: { color: '#4ec9b0', icon: 'markdown' },
    txt: { color: '#8b8b8b', icon: 'text' },
    pdf: { color: '#ff1744', icon: 'pdf' },

    // Images
    png: { color: '#9c27b0', icon: 'image' },
    jpg: { color: '#9c27b0', icon: 'image' },
    jpeg: { color: '#9c27b0', icon: 'image' },
    gif: { color: '#9c27b0', icon: 'image' },
    webp: { color: '#9c27b0', icon: 'image' },
    svg: { color: '#ffb300', icon: 'svg' },
    ico: { color: '#9c27b0', icon: 'image' },
    bmp: { color: '#9c27b0', icon: 'image' },

    // Video / Audio
    mp4: { color: '#ff5722', icon: 'video' },
    webm: { color: '#ff5722', icon: 'video' },
    mov: { color: '#ff5722', icon: 'video' },
    mp3: { color: '#e91e63', icon: 'audio' },
    wav: { color: '#e91e63', icon: 'audio' },

    // Lock / Build
    lock: { color: '#8b8b8b', icon: 'lock' },
    sum: { color: '#8b8b8b', icon: 'lock' },
    log: { color: '#8b8b8b', icon: 'log' },
  };

  return map[ext] || { color: '#8b8b8b', icon: 'file' };
}

export default function FileIcon({ name, isDir }: { name: string; isDir: boolean }) {
  const def = useMemo(() => getIconDef(name, isDir), [name, isDir]);
  const c = def.color;

  switch (def.icon) {
    case 'folder':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <path d="M3 7a2 2 0 012-2h3.586a2 2 0 011.414.586L11.414 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" fill={c} opacity="1.0" />
          <path d="M3 9h18" stroke={c} strokeWidth="0.5" opacity="0.5" />
        </svg>
      );
    case 'typescript':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <rect width="24" height="24" rx="3" fill={c} opacity="0.15" />
          <text x="4" y="17" fontSize="11" fontWeight="800" fill={c} fontFamily="monospace">TS</text>
        </svg>
      );
    case 'javascript':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <rect width="24" height="24" rx="3" fill={c} opacity="0.15" />
          <text x="4" y="17" fontSize="11" fontWeight="800" fill={c} fontFamily="monospace">JS</text>
        </svg>
      );
    case 'react':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <circle cx="12" cy="12" r="2" fill={c} />
          <ellipse cx="12" cy="12" rx="10" ry="4" stroke={c} strokeWidth="1.4" fill="none" />
          <ellipse cx="12" cy="12" rx="10" ry="4" stroke={c} strokeWidth="1.4" fill="none" transform="rotate(60 12 12)" />
          <ellipse cx="12" cy="12" rx="10" ry="4" stroke={c} strokeWidth="1.4" fill="none" transform="rotate(120 12 12)" />
        </svg>
      );
    case 'svelte':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <path d="M20.4 5.8C18.4 2.8 14.3 1.9 11.3 3.8L5.3 7.6c-3 1.9-4 5.8-2.2 8.9.8 1.3 2 2.3 3.4 2.9-.3.7-.3 1.5.1 2.2.8 1.3 2.5 1.7 3.7.9l6-3.8c3-1.9 4-5.8 2.2-8.9-.8-1.3-2-2.3-3.4-2.9.3-.7.3-1.5-.1-2.2-.8-1.3-2.5-1.7-3.7-.9L5.3 7.6" fill="none" stroke={c} strokeWidth="1.5" />
          <path d="M10.5 18.2l6-3.8c1.5-1 2-2.9 1.1-4.5-.6-.9-1.5-1.5-2.6-1.6l-7.5 4.7c-.8.5-1 1.5-.5 2.3.4.6 1.1.9 1.8.8" fill={c} opacity="0.8" />
        </svg>
      );
    case 'vue':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <path d="M2 3l10 17L22 3h-4l-6 10.5L6 3z" fill={c} opacity="0.85" />
          <path d="M6 3l6 10.5L18 3h-3l-3 5.5L9 3z" fill={c} opacity="0.5" />
        </svg>
      );
    case 'html':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <path d="M3 2l1.7 19L12 22l7.3-1L21 2z" fill={c} opacity="0.85" />
          <path d="M12 19.5l5.9-1.6.8-9.4H7.2l.2 2.4h8.4l-.3 3.2-3.5 1-3.5-1-.2-2.5H6.1l.4 5 5.5 1.9z" fill="white" opacity="0.9" />
        </svg>
      );
    case 'css':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <path d="M3 2l1.7 19L12 22l7.3-1L21 2z" fill={c} opacity="0.85" />
          <path d="M12 19.5l5.9-1.6.8-9.4H7.2l.2 2.4h8.6l-.3 2.8-4.4 1.3-4.4-1.3-.3-3H5.3l.5 5.5 6.2 1.8z" fill="white" opacity="0.9" />
        </svg>
      );
    case 'scss':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <rect width="24" height="24" rx="3" fill={c} opacity="0.15" />
          <text x="2" y="17" fontSize="10" fontWeight="800" fill={c} fontFamily="monospace">Sc</text>
        </svg>
      );
    case 'json':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <path d="M5 3a2 2 0 00-2 2v4a2 2 0 01-2 2 2 2 0 012 2v4a2 2 0 002 2" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
          <path d="M19 3a2 2 0 012 2v4a2 2 0 002 2 2 2 0 00-2 2v4a2 2 0 01-2 2" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'markdown':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <rect x="2" y="4" width="20" height="16" rx="2" stroke={c} strokeWidth="1.5" />
          <path d="M6 15V9l3 3 3-3v6" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M15 13l2 2 2-2" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M17 9v6" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'rust':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke={c} strokeWidth="1.5" />
          <circle cx="12" cy="12" r="3" fill={c} opacity="0.7" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'python':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <path d="M12 2C8 2 6 4 6 7v2h6v1H5C3 10 2 11.5 2 14s1 4 3 4h1v-2.5c0-2 1.5-3.5 3.5-3.5h5c2 0 3.5-1.5 3.5-3.5V7c0-3-2-5-6-5z" fill={c} opacity="0.85" />
          <path d="M12 22c4 0 6-2 6-5v-2h-6v-1h7c2 0 3-1.5 3-4s-1-4-3-4h-1v2.5c0 2-1.5 3.5-3.5 3.5h-5C7.5 12 6 13.5 6 15.5V17c0 3 2 5 6 5z" fill={c} opacity="0.55" />
          <circle cx="9.5" cy="6.5" r="1" fill="white" />
          <circle cx="14.5" cy="17.5" r="1" fill="white" />
        </svg>
      );
    case 'go':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <rect width="24" height="24" rx="3" fill={c} opacity="0.12" />
          <text x="3" y="17" fontSize="11" fontWeight="800" fill={c} fontFamily="monospace">Go</text>
        </svg>
      );
    case 'ruby':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <path d="M4 16L2 9l6-7h8l6 7-2 7-8 6-8-6z" fill={c} opacity="0.85" />
          <path d="M10 2L8 9l4 3 4-3-2-7" fill={c} opacity="0.5" />
        </svg>
      );
    case 'shell':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <rect x="2" y="3" width="20" height="18" rx="3" stroke={c} strokeWidth="1.5" fill={c} fillOpacity="0.1" />
          <path d="M6 9l4 3-4 3" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 15h6" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case 'image':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <rect x="2" y="4" width="20" height="16" rx="2" stroke={c} strokeWidth="1.5" fill={c} fillOpacity="0.1" />
          <circle cx="9" cy="10" r="2" fill={c} opacity="0.7" />
          <path d="M3 18l5-5 3 3 3-3 6 5" stroke={c} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'svg':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <rect x="2" y="4" width="20" height="16" rx="2" stroke={c} strokeWidth="1.5" fill={c} fillOpacity="0.1" />
          <circle cx="12" cy="12" r="4" fill={c} opacity="0.6" />
          <text x="9" y="15" fontSize="7" fontWeight="700" fill={c} fontFamily="monospace">S</text>
        </svg>
      );
    case 'git':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <circle cx="6" cy="6" r="2.5" fill={c} />
          <circle cx="18" cy="6" r="2.5" fill={c} />
          <circle cx="6" cy="18" r="2.5" fill={c} />
          <path d="M6 8.5v7M8.5 6h7" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M18 8.5C18 13 13 15.5 6 15.5" stroke={c} strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </svg>
      );
    case 'env':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <rect x="2" y="3" width="20" height="18" rx="2" stroke={c} strokeWidth="1.5" fill={c} fillOpacity="0.1" />
          <path d="M7 8h10M7 12h6M7 16h8" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case 'yaml':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <rect width="24" height="24" rx="3" fill={c} opacity="0.12" />
          <text x="2" y="17" fontSize="9" fontWeight="800" fill={c} fontFamily="monospace">YML</text>
        </svg>
      );
    case 'lock':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <rect x="4" y="11" width="16" height="11" rx="2" stroke={c} strokeWidth="1.5" fill={c} fillOpacity="0.1" />
          <path d="M8 11V7a4 4 0 018 0v4" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="12" cy="16" r="1.5" fill={c} />
        </svg>
      );
    case 'npm':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <rect width="24" height="24" rx="3" fill={c} opacity="0.12" />
          <text x="1" y="17" fontSize="9" fontWeight="900" fill={c} fontFamily="monospace">npm</text>
        </svg>
      );
    case 'docker':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <rect x="2" y="9" width="4" height="3" rx="0.5" fill={c} opacity="0.8" />
          <rect x="7" y="9" width="4" height="3" rx="0.5" fill={c} opacity="0.8" />
          <rect x="12" y="9" width="4" height="3" rx="0.5" fill={c} opacity="0.8" />
          <rect x="7" y="5" width="4" height="3" rx="0.5" fill={c} opacity="0.8" />
          <rect x="12" y="5" width="4" height="3" rx="0.5" fill={c} opacity="0.8" />
          <rect x="12" y="1" width="4" height="3" rx="0.5" fill={c} opacity="0.8" />
          <path d="M22 11c-.5-1-1.5-1.5-3-1.5h-1V8.5c-1.5 0-2.5.5-3 1.5H2c0 3.5 2 6 5.5 6h9c3 0 5.5-1.5 5.5-4.5" stroke={c} strokeWidth="1" fill="none" />
        </svg>
      );
    case 'text':
    case 'log':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke={c} strokeWidth="1.5" fill={c} fillOpacity="0.08" />
          <path d="M14 2v6h6" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M8 13h8M8 17h5" stroke={c} strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={shrink} aria-hidden="true">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke={c} strokeWidth="1.5" fill={c} fillOpacity="0.08" />
          <path d="M14 2v6h6" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

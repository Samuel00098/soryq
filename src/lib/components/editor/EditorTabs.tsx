import { useEditorStore } from '$lib/stores/zustand/editor';
import { clampHorizontalScroll } from '$lib/actions/clampHorizontalScroll';
import { useAction } from '$lib/react/useAction';
import './EditorTabs.css';

// Short, language-specific badge (label + brand color) shown on each tab,
// replacing a generic "TXT" for every file. Keyed by the language ids that
// detectLanguage() produces (see stores/editor.ts).
type Badge = { label: string; color: string };
const LANG_BADGE: Record<string, Badge> = {
  image: { label: 'IMG', color: '#b78cf0' },
  javascript: { label: 'JS', color: '#f0db4f' },
  typescript: { label: 'TS', color: '#3178c6' },
  html: { label: 'HTML', color: '#e34f26' },
  css: { label: 'CSS', color: '#519aba' },
  scss: { label: 'SCSS', color: '#cd6799' },
  sass: { label: 'SASS', color: '#cd6799' },
  rust: { label: 'RS', color: '#dea584' },
  json: { label: 'JSON', color: '#cbcb41' },
  markdown: { label: 'MD', color: '#519aba' },
  python: { label: 'PY', color: '#ffd43b' },
  java: { label: 'JAVA', color: '#e76f00' },
  cpp: { label: 'C++', color: '#5e97d0' },
  csharp: { label: 'C#', color: '#a074c4' },
  svelte: { label: 'SV', color: '#ff3e00' },
  toml: { label: 'TOML', color: '#b8845f' },
  php: { label: 'PHP', color: '#8993be' },
  sql: { label: 'SQL', color: '#e38c00' },
  xml: { label: 'XML', color: '#e37933' },
  yaml: { label: 'YAML', color: '#cb171e' },
  go: { label: 'GO', color: '#00add8' },
  swift: { label: 'SW', color: '#f05138' },
  kotlin: { label: 'KT', color: '#a97bff' },
  shell: { label: 'SH', color: '#89e051' },
  plaintext: { label: 'TXT', color: 'var(--text-muted)' },
};

function langBadge(language: string | undefined, kind: string): Badge {
  if (kind === 'image') return LANG_BADGE.image;
  return LANG_BADGE[language ?? ''] ?? LANG_BADGE.plaintext;
}

function getFileName(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

export default function EditorTabs() {
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const closeFile = useEditorStore((s) => s.closeFile);
  const files = useEditorStore((s) => s.openFiles);
  const active = useEditorStore((s) => s.activeFile);
  const cache = useEditorStore((s) => s.fileCache);
  const tabsRef = useAction<HTMLDivElement>(clampHorizontalScroll);

  function handleTabClick(path: string) {
    setActiveFile(path);
  }

  function handleCloseClick(e: React.MouseEvent, path: string) {
    e.stopPropagation();
    closeFile(path);
  }

  return (
    <div className="editor-tabs" ref={tabsRef}>
      {files.map((file) => {
        const fileState = cache.get(file);
        if (!fileState) return null;
        const badge = langBadge(fileState.language, fileState.kind);
        return (
          <button
            key={file}
            className={`editor-tab${active === file ? ' active' : ''}${fileState.isDirty ? ' dirty' : ''}`}
            onClick={() => handleTabClick(file)}
            title={file}
          >
            <span className="tab-icon" style={{ color: badge.color }}>
              {badge.label}
            </span>
            <span className="tab-label">{getFileName(file)}</span>
            {fileState.isDirty && <span className="tab-dirty-indicator"></span>}
            <span
              className="tab-close-btn"
              onClick={(e) => handleCloseClick(e, file)}
              role="button"
              tabIndex={0}
              aria-label="Close tab"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </span>
          </button>
        );
      })}
    </div>
  );
}

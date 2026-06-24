import { useEffect, useMemo } from 'react';
import EditorTabs from './EditorTabs.tsx';
import ImageViewer from './ImageViewer.tsx';
import MarkdownPreview from '$lib/components/preview/MarkdownPreview.tsx';
import { useEditorStore } from '$lib/stores/zustand/editor';
import CodeEditor from './CodeEditor.tsx';
import './EditorPanel.css';

function CodeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function EditorPanel() {
  const files = useEditorStore((s) => s.openFiles);
  const active = useEditorStore((s) => s.activeFile);
  const cache = useEditorStore((s) => s.fileCache);
  const saveActiveFile = useEditorStore((s) => s.saveActiveFile);
  const markdownPreviewPaths = useEditorStore((s) => s.markdownPreviewPaths);
  const setMarkdownPreview = useEditorStore((s) => s.setMarkdownPreview);

  const file = active ? cache.get(active) : null;
  const showMarkdownPreview = active ? markdownPreviewPaths.has(active) : false;

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        void saveActiveFile();
      }
    }

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, []);

  const codeEditorProps = useMemo(
    () =>
      file
        ? {
            filePath: file.path,
            initialContent: file.content,
            language: file.language,
          }
        : undefined,
    [file?.path],
  );

  if (files.length === 0 || !active || !file) {
    return (
      <div className="editor-panel">
        <div className="editor-empty-placeholder">
          <div className="placeholder-icon">&#128196;</div>
          <p className="placeholder-text">Open a file from the Explorer</p>
          <p className="placeholder-hint">Click the folder icon in the activity bar to browse files</p>
        </div>
      </div>
    );
  }

  const canPreviewMarkdown = file.kind === 'text' && file.language === 'markdown';

  return (
    <div className="editor-panel">
      <div className="editor-toolbar">
        <EditorTabs />
        {canPreviewMarkdown && (
          <button
            className={`markdown-toggle-btn${showMarkdownPreview ? ' active' : ''}`}
            onClick={() => active && setMarkdownPreview(active, !showMarkdownPreview)}
            title={showMarkdownPreview ? 'Show Editor' : 'Show Preview'}
            aria-label="Toggle markdown preview"
          >
            {showMarkdownPreview ? <CodeIcon /> : <EyeIcon />}
            <span>{showMarkdownPreview ? 'Show Code' : 'Show Preview'}</span>
          </button>
        )}
      </div>

      <div className="editor-workspace-area">
        {file.kind === 'image' && file.imageSrc ? (
          <ImageViewer src={file.imageSrc} path={file.path} mimeType={file.mimeType} size={file.size} />
        ) : file.language === 'markdown' && showMarkdownPreview ? (
          <MarkdownPreview content={file.content} />
        ) : (
          codeEditorProps && (
            <CodeEditor
              key={file.path}
              {...codeEditorProps}
            />
          )
        )}
      </div>
    </div>
  );
}

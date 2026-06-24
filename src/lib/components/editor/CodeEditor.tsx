import { useEffect, useRef, useState } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  scrollPastEnd,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  foldGutter,
  foldKeymap,
  indentOnInput,
  bracketMatching,
  syntaxHighlighting,
  HighlightStyle,
  StreamLanguage,
} from '@codemirror/language';
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
} from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';

// Language support
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { rust } from '@codemirror/lang-rust';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { php } from '@codemirror/lang-php';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { go } from '@codemirror/lang-go';
import { sass } from '@codemirror/lang-sass';
import { svelte } from '@replit/codemirror-lang-svelte';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { kotlin, csharp } from '@codemirror/legacy-modes/mode/clike';
import { toml } from '@codemirror/legacy-modes/mode/toml';

import { updateContent, updateCursorPosition, jumpToLine, activeSelection } from '$lib/stores/editor';
import { devpet } from '$lib/stores/devpet';
import { activeProject } from '$lib/stores/workspace';
import {
  fontSize,
  resolvedFontFamily,
  tabSize,
  wordWrap,
  minimap,
  vimMode,
  enableLsp,
} from '$lib/stores/settings';
import { vim } from '@replit/codemirror-vim';
import { createLspExtension, lspSupportsLanguage, lspReload, type LspHandle } from '$lib/services/lsp/client';
import { ghostText } from '$lib/services/completion/ghost-text';
import { useStore } from '$lib/react/useStore';
import './CodeEditor.css';

type CodeEditorProps = {
  filePath: string;
  initialContent: string;
  language: string;
};

const customTheme = EditorView.theme({
  "&": {
    color: "var(--text-primary)",
    backgroundColor: "transparent",
    height: "100%",
    fontSize: "var(--editor-font-size, 13px)",
    fontFamily: "var(--editor-font-family, monospace)",
  },
  ".cm-content": {
    caretColor: "var(--accent)",
    fontFamily: "inherit",
    fontSize: "inherit",
    padding: "10px 0",
  },
  ".cm-line": {
    padding: "0 8px 0 12px",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--selection-bg)",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--text-muted)",
    border: "none",
    borderRight: "1px solid var(--border)",
    fontFamily: "inherit",
  },
  ".cm-gutterElement": {
    padding: "0 8px 0 4px",
  },
  ".cm-activeLine": { backgroundColor: "var(--editor-lineHighlight, rgba(255, 255, 255, 0.03))" },
  ".cm-activeLineGutter": { backgroundColor: "var(--editor-lineHighlight, rgba(255, 255, 255, 0.03))", color: "var(--text-primary)" },
}, { dark: true });

const customHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "var(--syntax-keyword)" },
  { tag: t.operator, color: "var(--syntax-operator)" },
  { tag: t.punctuation, color: "var(--syntax-punctuation)" },
  { tag: t.special(t.bracket), color: "var(--syntax-punctuation)" },
  { tag: t.string, color: "var(--syntax-string)" },
  { tag: t.number, color: "var(--syntax-number)" },
  { tag: t.bool, color: "var(--syntax-number)" },
  { tag: t.variableName, color: "var(--syntax-variable)" },
  { tag: t.definition(t.variableName), color: "var(--syntax-variable)" },
  { tag: t.function(t.variableName), color: "var(--syntax-function)" },
  { tag: t.typeName, color: "var(--syntax-type)" },
  { tag: t.className, color: "var(--syntax-type)" },
  { tag: t.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: t.meta, color: "var(--syntax-constant)" },
  { tag: t.heading, color: "var(--syntax-keyword)", fontWeight: "bold" },
]);

function getLanguageExtension(lang: string) {
  switch (lang) {
    case 'javascript':
      return javascript();
    case 'typescript':
      return javascript({ typescript: true });
    case 'html':
      return html();
    case 'css':
      return css();
    case 'rust':
      return rust();
    case 'json':
      return json();
    case 'markdown':
      return markdown();
    case 'python':
      return python();
    case 'java':
      return java();
    case 'cpp':
      return cpp();
    case 'php':
      return php();
    case 'sql':
      return sql();
    case 'xml':
      return xml();
    case 'yaml':
      return yaml();
    case 'go':
      return go();
    case 'scss':
    case 'sass':
      return sass();
    case 'svelte':
      return svelte();
    case 'toml':
      return StreamLanguage.define(toml);
    case 'csharp':
      return StreamLanguage.define(csharp);
    case 'shell':
      return StreamLanguage.define(shell);
    case 'swift':
      return StreamLanguage.define(swift);
    case 'kotlin':
      return StreamLanguage.define(kotlin);
    default:
      return [];
  }
}

export default function CodeEditor({ filePath, initialContent, language }: CodeEditorProps) {
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const minimapContainerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const isUpdatingFromStoreRef = useRef(false);
  const [currentText, setCurrentText] = useState(initialContent);

  const fontSizeValue = useStore(fontSize);
  const resolvedFontFamilyValue = useStore(resolvedFontFamily);
  const tabSizeValue = useStore(tabSize);
  const wordWrapValue = useStore(wordWrap);
  const minimapValue = useStore(minimap);
  const vimModeValue = useStore(vimMode);
  const enableLspValue = useStore(enableLsp);
  const jumpToLineValue = useStore(jumpToLine);
  const activeProjectValue = useStore(activeProject);
  const lspReloadValue = useStore(lspReload);

  // CodeMirror Compartments for dynamic configuration. Created once per mount,
  // mirroring the Svelte component's module-instance-scoped compartments.
  const tabSizeCompartmentRef = useRef<Compartment | null>(null);
  const wordWrapCompartmentRef = useRef<Compartment | null>(null);
  const vimModeCompartmentRef = useRef<Compartment | null>(null);
  // LSP extension is loaded asynchronously (server must spawn first), so it lives
  // in its own compartment that starts empty and gets reconfigured once ready.
  const lspCompartmentRef = useRef<Compartment | null>(null);

  // The active language-server document handle for the open file, and a
  // generation counter so a slow server start can't clobber a newer file switch.
  const lspHandleRef = useRef<LspHandle | null>(null);
  const lspGenerationRef = useRef(0);

  function createEditorState(content: string) {
    const tabSizeCompartment = tabSizeCompartmentRef.current!;
    const wordWrapCompartment = wordWrapCompartmentRef.current!;
    const vimModeCompartment = vimModeCompartmentRef.current!;
    const lspCompartment = lspCompartmentRef.current!;

    return EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(customHighlightStyle),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        getLanguageExtension(language),
        ghostText(language),
        customTheme,
        scrollPastEnd(),
        EditorView.editable.of(true),
        EditorState.readOnly.of(false),
        tabSizeCompartment.of(EditorState.tabSize.of(tabSizeValue)),
        wordWrapCompartment.of(wordWrapValue ? EditorView.lineWrapping : []),
        vimModeCompartment.of(vimModeValue ? vim() : []),
        lspCompartment.of([]),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !isUpdatingFromStoreRef.current) {
            const doc = update.state.doc.toString();
            setCurrentText(doc);
            updateContent(filePath, doc);

            let insertedChars = 0;
            update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
              insertedChars += inserted.length;
            });
            if (insertedChars > 0) {
              devpet.onType(insertedChars);
            }
          }
          if (update.selectionSet) {
            const sel = update.state.selection.main;
            const lineObj = update.state.doc.lineAt(sel.head);
            updateCursorPosition(lineObj.number, sel.head - lineObj.from + 1);
            // Surface the highlighted text (capped) so the assistant can see it.
            const selectedText = sel.empty ? '' : update.state.sliceDoc(sel.from, sel.to);
            activeSelection.set(selectedText.length > 2000 ? selectedText.slice(0, 2000) : selectedText);
          }
        }),
      ],
    });
  }

  function syncMinimapScroll() {
    const view = viewRef.current;
    const minimapContainer = minimapContainerRef.current;
    if (!view || !minimapContainer) return;
    const scrollEl = view.scrollDOM;
    const scrollPct = scrollEl.scrollTop / Math.max(1, scrollEl.scrollHeight - scrollEl.clientHeight);
    minimapContainer.scrollTop = scrollPct * (minimapContainer.scrollHeight - minimapContainer.clientHeight);
  }

  /**
   * (Re)load the language server extension for the current file. Tears down any
   * prior handle, then — if LSP is enabled, the language is supported, and a
   * project is open — asks the backend to start (or reuse) a server and swaps the
   * extension into `lspCompartment`. A generation guard discards a stale result
   * if the user switched files while the server was starting.
   */
  async function loadLsp(path: string, lang: string, root: string | undefined, enabled: boolean) {
    const gen = ++lspGenerationRef.current;

    const prev = lspHandleRef.current;
    lspHandleRef.current = null;
    if (prev) prev.dispose();
    const view = viewRef.current;
    const lspCompartment = lspCompartmentRef.current!;
    if (view) view.dispatch({ effects: lspCompartment.reconfigure([]) });

    if (!enabled || !root || !lspSupportsLanguage(lang)) return;

    let handle: LspHandle | null = null;
    try {
      handle = await createLspExtension(path, lang, root);
    } catch (e) {
      console.error('Failed to load LSP extension:', e);
      return;
    }

    // A newer load started, or the editor went away, while we were awaiting.
    if (gen !== lspGenerationRef.current || !viewRef.current) {
      handle?.dispose();
      return;
    }
    lspHandleRef.current = handle;
    if (handle) {
      viewRef.current.dispatch({ effects: lspCompartment.reconfigure(handle.extension) });
    }
  }

  // Mount CodeMirror once on initial mount, and tear it down on unmount.
  useEffect(() => {
    tabSizeCompartmentRef.current = new Compartment();
    wordWrapCompartmentRef.current = new Compartment();
    vimModeCompartmentRef.current = new Compartment();
    lspCompartmentRef.current = new Compartment();

    const view = new EditorView({
      state: createEditorState(initialContent),
      parent: editorContainerRef.current!,
    });
    viewRef.current = view;
    view.scrollDOM.addEventListener('scroll', syncMinimapScroll);

    return () => {
      if (lspHandleRef.current) {
        lspHandleRef.current.dispose();
        lspHandleRef.current = null;
      }
      view.scrollDOM.removeEventListener('scroll', syncMinimapScroll);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep editor content in sync if initialContent changes from parent (e.g. file switched or saved)
  useEffect(() => {
    const view = viewRef.current;
    if (view && filePath) {
      const currentDoc = view.state.doc.toString();
      const normalize = (s: string) => s.replace(/\r\n/g, '\n');
      if (normalize(currentDoc) !== normalize(initialContent)) {
        isUpdatingFromStoreRef.current = true;
        view.setState(createEditorState(initialContent));
        setCurrentText(initialContent);
        isUpdatingFromStoreRef.current = false;
      }
    } else {
      setCurrentText(initialContent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, initialContent]);

  // React to dynamic settings changes in compartments
  useEffect(() => {
    const view = viewRef.current;
    if (view) {
      view.dispatch({
        effects: [
          tabSizeCompartmentRef.current!.reconfigure(EditorState.tabSize.of(tabSizeValue)),
          wordWrapCompartmentRef.current!.reconfigure(wordWrapValue ? EditorView.lineWrapping : []),
          vimModeCompartmentRef.current!.reconfigure(vimModeValue ? vim() : []),
        ]
      });
    }
  }, [tabSizeValue, wordWrapValue, vimModeValue]);

  // Jump to specific line when requested by search or other triggers
  useEffect(() => {
    const view = viewRef.current;
    if (view && jumpToLineValue && jumpToLineValue.path === filePath) {
      const lineNum = Math.min(jumpToLineValue.line, view.state.doc.lines);
      if (lineNum > 0) {
        try {
          const line = view.state.doc.line(lineNum);
          view.dispatch({
            selection: { anchor: line.from, head: line.to },
            scrollIntoView: true
          });
          view.focus();
        } catch (e) {
          console.error("Failed to jump to line in CodeMirror:", e);
        }
      }
      jumpToLine.set(null);
    }
  }, [jumpToLineValue, filePath]);

  // Load / reload the language server whenever the file, language, project root,
  // or the LSP toggle changes. Declared after the setState effect above so that,
  // on a file switch, it runs after the fresh editor state (with an empty LSP
  // compartment) is installed and reconfigures it for the new document.
  useEffect(() => {
    const enabled = enableLspValue;
    const root = activeProjectValue?.root_path;
    const path = filePath;
    const lang = language;
    // Re-run after a successful server install so LSP activates without a reopen.
    void lspReloadValue;
    if (!viewRef.current) return;
    void loadLsp(path, lang, root, enabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableLspValue, activeProjectValue?.root_path, filePath, language, lspReloadValue]);

  return (
    <div className="editor-layout">
      <div
        className="code-editor-container"
        style={{
          '--editor-font-size': `${fontSizeValue}px`,
          '--editor-font-family': resolvedFontFamilyValue,
        } as React.CSSProperties}
        ref={editorContainerRef}
      ></div>

      {minimapValue && (
        <div className="minimap-container" ref={minimapContainerRef} aria-hidden="true">
          <pre className="minimap-content" style={{ fontFamily: resolvedFontFamilyValue }}>{currentText}</pre>
        </div>
      )}
    </div>
  );
}

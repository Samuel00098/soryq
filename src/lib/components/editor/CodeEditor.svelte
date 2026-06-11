<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
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

  import { updateContent, updateCursorPosition, jumpToLine } from '$lib/stores/editor';
  import {
    fontSize,
    resolvedFontFamily,
    tabSize,
    wordWrap,
    minimap,
    vimMode,
  } from '$lib/stores/settings';
  import { vim } from '@replit/codemirror-vim';

  let { filePath, initialContent, language } = $props<{
    filePath: string;
    initialContent: string;
    language: string;
  }>();

  let editorContainer = $state<HTMLDivElement>();
  let minimapContainer = $state<HTMLDivElement | null>(null);
  let view = $state<EditorView | null>(null);
  let isUpdatingFromStore = false;
  
  // svelte-ignore state_referenced_locally
  let currentText = $state(initialContent);

  // CodeMirror Compartments for dynamic configuration
  const tabSizeCompartment = new Compartment();
  const wordWrapCompartment = new Compartment();
  const vimModeCompartment = new Compartment();

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

  function createEditorState(content: string) {
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
        customTheme,
        scrollPastEnd(),
        EditorView.editable.of(true),
        EditorState.readOnly.of(false),
        tabSizeCompartment.of(EditorState.tabSize.of($tabSize)),
        wordWrapCompartment.of($wordWrap ? EditorView.lineWrapping : []),
        vimModeCompartment.of($vimMode ? vim() : []),
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
          if (update.docChanged && !isUpdatingFromStore) {
            const doc = update.state.doc.toString();
            currentText = doc;
            updateContent(filePath, doc);
          }
          if (update.selectionSet) {
            const pos = update.state.selection.main.head;
            const lineObj = update.state.doc.lineAt(pos);
            updateCursorPosition(lineObj.number, pos - lineObj.from + 1);
          }
        }),
      ],
    });
  }

  function syncMinimapScroll() {
    if (!view || !minimapContainer) return;
    const scrollEl = view.scrollDOM;
    const scrollPct = scrollEl.scrollTop / Math.max(1, scrollEl.scrollHeight - scrollEl.clientHeight);
    minimapContainer.scrollTop = scrollPct * (minimapContainer.scrollHeight - minimapContainer.clientHeight);
  }

  onMount(() => {
    view = new EditorView({
      state: createEditorState(initialContent),
      parent: editorContainer,
    });
    view.scrollDOM.addEventListener('scroll', syncMinimapScroll);
  });

  onDestroy(() => {
    if (view) {
      view.scrollDOM.removeEventListener('scroll', syncMinimapScroll);
      view.destroy();
    }
  });

  // Keep editor content in sync if initialContent changes from parent (e.g. file switched or saved)
  $effect(() => {
    if (view && filePath) {
      const currentDoc = view.state.doc.toString();
      const normalize = (s: string) => s.replace(/\r\n/g, '\n');
      if (normalize(currentDoc) !== normalize(initialContent)) {
        isUpdatingFromStore = true;
        view.setState(createEditorState(initialContent));
        currentText = initialContent;
        isUpdatingFromStore = false;
      }
    } else {
      currentText = initialContent;
    }
  });

  // React to dynamic settings changes in compartments
  $effect(() => {
    if (view) {
      view.dispatch({
        effects: [
          tabSizeCompartment.reconfigure(EditorState.tabSize.of($tabSize)),
          wordWrapCompartment.reconfigure($wordWrap ? EditorView.lineWrapping : []),
          vimModeCompartment.reconfigure($vimMode ? vim() : []),
        ]
      });
    }
  });

  // Jump to specific line when requested by search or other triggers
  $effect(() => {
    if (view && $jumpToLine && $jumpToLine.path === filePath) {
      const lineNum = Math.min($jumpToLine.line, view.state.doc.lines);
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
  });
</script>

<div class="editor-layout">
  <div
    class="code-editor-container"
    style="--editor-font-size: {$fontSize}px; --editor-font-family: {$resolvedFontFamily};"
    bind:this={editorContainer}
  ></div>

  {#if $minimap}
    <div class="minimap-container" bind:this={minimapContainer} aria-hidden="true">
      <pre class="minimap-content" style="font-family: {$resolvedFontFamily};">{currentText}</pre>
    </div>
  {/if}
</div>

<style>
  .editor-layout {
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
    position: relative;
  }
  .code-editor-container {
    flex: 1;
    height: 100%;
    overflow: hidden;
  }
  :global(.cm-editor) {
    height: 100%;
  }
  .minimap-container {
    width: 80px;
    height: 100%;
    background: var(--bg-tertiary);
    border-left: 1px solid var(--border);
    overflow: hidden;
    user-select: none;
    pointer-events: none;
    opacity: 0.55;
    transition: opacity 0.2s;
  }
  :global(:root:not(.solid-theme)) .minimap-container {
    background: rgba(var(--bg-tertiary-rgb, 34, 34, 42), var(--frost-surface, 0.72));
  }
  .minimap-container:hover {
    opacity: 0.85;
  }
  .minimap-content {
    font-size: 3px;
    line-height: 4.5px;
    padding: 8px 4px;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--text-muted);
  }
</style>

/**
 * AI ghost text ("Cursor Tab") for the code editor.
 *
 * As you pause while typing, this asks an AI model to predict the next bit of
 * code and shows it as faded inline text after the cursor; press Tab to accept,
 * Esc or keep typing to dismiss. This is the *predictive* layer — distinct from
 * the LSP popup, which lists symbols that actually exist. The two coexist.
 *
 * It reuses the existing `ai_complete` Tauri command (keys resolved server-side
 * from the keychain) and a dedicated completion provider/model so predictions can
 * run on a fast, cheap model independent of the main AI provider.
 */
import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import {
  EditorView,
  Decoration,
  WidgetType,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { StateField, StateEffect, Prec, Facet, type Extension } from '@codemirror/state';
import {
  aiGhostTextEnabled,
  aiCompletionProvider,
  aiCompletionModelByProvider,
  getProviderDef,
  isLocalProvider,
  getProviderBaseUrl,
} from '$lib/stores/settings';
import { isProviderApiKeyConfiguredLocal } from '$lib/services/ai-keychain';

/** How long the user must pause (ms) before we ask for a prediction. */
const DEBOUNCE_MS = 280;
/** Context window sent around the cursor. */
const PREFIX_CHARS = 2000;
const SUFFIX_CHARS = 800;

type Suggestion = { from: number; text: string };

// ---------------------------------------------------------------------------
// Completion request
// ---------------------------------------------------------------------------

function cleanCompletion(raw: string): string {
  let text = raw;
  // Strip a single wrapping code fence if the model added one.
  const fence = text.match(/^\s*```[a-zA-Z0-9]*\n([\s\S]*?)\n?```\s*$/);
  if (fence) text = fence[1];
  // Models sometimes prefix the reply with a newline; keep internal structure
  // but drop a leading blank that would push the suggestion off the cursor line.
  text = text.replace(/^\n+/, '');
  // Cap runaway responses.
  if (text.length > 600) text = text.slice(0, 600);
  return text;
}

/**
 * Ask the configured model to continue the code at the cursor. Returns '' when
 * ghost text is disabled, no key/URL is configured, or the model declines.
 */
async function fetchCompletion(
  prefix: string,
  suffix: string,
  language: string,
): Promise<string> {
  if (!get(aiGhostTextEnabled)) return '';
  if (!prefix.trim()) return '';

  const provider = get(aiCompletionProvider);
  const local = isLocalProvider(provider);
  const baseUrl = local ? getProviderBaseUrl(provider) : '';
  if (local ? !baseUrl : !isProviderApiKeyConfiguredLocal(provider)) return '';

  const def = getProviderDef(provider);
  const model = get(aiCompletionModelByProvider)[provider]?.trim() || def.defaultModel;

  const system =
    `You are a code autocomplete engine. Continue the ${language} code exactly at <CURSOR>. ` +
    `Reply with ONLY the raw text to insert at the cursor — no explanations, no markdown fences, ` +
    `no repetition of the code before the cursor. Prefer short completions (a few lines at most). ` +
    `If no useful completion is possible, reply with nothing.`;
  const user = `${prefix}<CURSOR>${suffix}`;

  try {
    const raw = await invoke<string>('ai_complete', {
      systemPrompt: system,
      userText: user,
      provider,
      model,
      apiKey: '',
      baseUrl: baseUrl || undefined,
    });
    return cleanCompletion(raw);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// CodeMirror extension
// ---------------------------------------------------------------------------

const setSuggestion = StateEffect.define<Suggestion | null>();

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: GhostWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = 'cm-ghost-text';
    // Render multi-line predictions, preserving newlines.
    const lines = this.text.split('\n');
    lines.forEach((line, i) => {
      if (i > 0) wrap.appendChild(document.createElement('br'));
      wrap.appendChild(document.createTextNode(line));
    });
    return wrap;
  }
  // Ghost text isn't real content; don't let it swallow events.
  ignoreEvent() {
    return false;
  }
}

const suggestionField = StateField.define<Suggestion | null>({
  create() {
    return null;
  },
  update(value, tr) {
    // An explicit effect always wins (set or clear).
    for (const e of tr.effects) {
      if (e.is(setSuggestion)) return e.value;
    }
    // Any user edit or cursor move invalidates a stale suggestion.
    if (tr.docChanged || tr.selection) return null;
    return value;
  },
  provide: (f) =>
    EditorView.decorations.from(f, (value): DecorationSet => {
      if (!value) return Decoration.none;
      const deco = Decoration.widget({
        widget: new GhostWidget(value.text),
        side: 1,
      });
      return Decoration.set([deco.range(value.from)]);
    }),
});

const ghostPlugin = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private gen = 0;

    update(update: ViewUpdate) {
      if (update.docChanged) {
        // The field already cleared any old suggestion on this edit; schedule a
        // fresh request after the user pauses.
        this.schedule(update.view);
      } else if (update.selectionSet) {
        this.cancel();
      }
    }

    private schedule(view: EditorView) {
      this.cancel();
      this.timer = setTimeout(() => void this.request(view), DEBOUNCE_MS);
    }

    private cancel() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.gen++; // invalidate any in-flight request
    }

    private async request(view: EditorView) {
      const gen = ++this.gen;
      const sel = view.state.selection.main;
      if (!sel.empty) return;

      const pos = sel.head;
      const doc = view.state.doc;
      const prefix = doc.sliceString(Math.max(0, pos - PREFIX_CHARS), pos);
      const suffix = doc.sliceString(pos, Math.min(doc.length, pos + SUFFIX_CHARS));
      const language = view.state.facet(ghostLanguage);

      const text = await fetchCompletion(prefix, suffix, language);

      // Discard if a newer request started, the doc/cursor moved, or empty.
      if (gen !== this.gen || !text) return;
      const now = view.state.selection.main;
      if (!now.empty || now.head !== pos) return;

      view.dispatch({ effects: setSuggestion.of({ from: pos, text }) });
    }

    destroy() {
      this.cancel();
    }
  },
);

function accept(view: EditorView): boolean {
  const s = view.state.field(suggestionField, false);
  if (!s) return false;
  view.dispatch({
    changes: { from: s.from, insert: s.text },
    selection: { anchor: s.from + s.text.length },
    effects: setSuggestion.of(null),
    userEvent: 'input.complete',
  });
  return true;
}

function dismiss(view: EditorView): boolean {
  const s = view.state.field(suggestionField, false);
  if (!s) return false;
  view.dispatch({ effects: setSuggestion.of(null) });
  return true;
}

// Tab must beat the editor's indent-with-tab binding when a suggestion is shown.
const ghostKeymap = Prec.highest(
  keymap.of([
    { key: 'Tab', run: accept },
    { key: 'Escape', run: dismiss },
  ]),
);

const ghostTheme = EditorView.baseTheme({
  '.cm-ghost-text': {
    opacity: '0.45',
    color: 'var(--text-muted, #888)',
    fontStyle: 'italic',
  },
});

// Per-editor language id, read by the request plugin to flavour the prompt.
const ghostLanguage = Facet.define<string, string>({
  combine: (values) => values[0] ?? 'plaintext',
});

/**
 * The ghost-text extension. Always safe to include — it self-gates on the
 * `aiGhostTextEnabled` setting and a configured provider, doing nothing until
 * the user turns it on.
 */
export function ghostText(language: string): Extension {
  return [
    ghostLanguage.of(language),
    suggestionField,
    ghostPlugin,
    ghostKeymap,
    ghostTheme,
  ];
}

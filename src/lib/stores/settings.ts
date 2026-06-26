import { writable, derived, get } from '$lib/stores/storeCompat';
import { getAppFlag, setAppFlag } from '$lib/services/app-flags';
import { useSettingsStore } from './zustand/settings';

function persistentWritable<T>(key: string, defaultValue: T): import('$lib/stores/storeCompat').Writable<T> {
  if (typeof window === 'undefined') {
    return writable(defaultValue);
  }

  const zustandVal = (useSettingsStore.getState() as any)[key];
  const initial = zustandVal !== undefined ? zustandVal as T : defaultValue;

  const store = writable<T>(initial);

  // Sync Zustand → writable on every change
  const unsub = useSettingsStore.subscribe((state) => {
    const next = (state as any)[key] as T | undefined;
    if (next !== undefined) {
      store.set(next);
    }
  });

  return {
    subscribe: store.subscribe,
    set(value: T) {
      (useSettingsStore.getState() as any).__set(key, value);
    },
    update(fn: (val: T) => T) {
      const current = (useSettingsStore.getState() as any)[key] as T;
      const next = fn(current);
      (useSettingsStore.getState() as any).__set(key, next);
    },
  };
}

const FONT_CANDIDATES = [
  'JetBrains Mono',
  'Fira Code',
  'Cascadia Code',
  'Cascadia Mono',
  'Victor Mono',
  'IBM Plex Mono',
  'Source Code Pro',
  'Consolas',
  'Monaco',
  'Menlo',
  'DejaVu Sans Mono',
  'Liberation Mono',
  'Courier New',
];

let detectedFontCache: string | null = null;

export function detectBestFont(): string {
  if (detectedFontCache) return detectedFontCache;

  if (typeof document === 'undefined') {
    detectedFontCache = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace";
    return detectedFontCache;
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    detectedFontCache = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace";
    return detectedFontCache;
  }

  ctx.font = '12px monospace';
  const testStr = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const baseWidth = ctx.measureText(testStr).width;

  for (const font of FONT_CANDIDATES) {
    ctx.font = `12px "${font}", monospace`;
    const width = ctx.measureText(testStr).width;
    if (width !== baseWidth) {
      detectedFontCache = `'${font}', '${FONT_CANDIDATES.filter(f => f !== font).join("', '")}', monospace`;
      return detectedFontCache;
    }
  }

  detectedFontCache = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace";
  return detectedFontCache;
}

// Editor
export const fontSize = persistentWritable('fontSize', 14);
const FONT_FALLBACK = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Ubuntu Mono', 'Noto Mono', Consolas, monospace";
export const fontFamily = persistentWritable('fontFamily', FONT_FALLBACK);
export const resolvedFontFamily = derived(fontFamily, ($ff) => {
  if (!$ff || $ff.trim() === '') return FONT_FALLBACK;
  return $ff;
});
export const tabSize = persistentWritable('tabSize', 2);
export const wordWrap = persistentWritable('wordWrap', true);
export const minimap = persistentWritable('minimap', false);
export const vimMode = persistentWritable('vimMode', false);
// Language-server-backed autocomplete, diagnostics and hover. Requires the
// relevant language server (rust-analyzer, typescript-language-server, …) on PATH.
export const enableLsp = persistentWritable('enableLsp', true);

// Explorer
export const showHidden = persistentWritable('showHidden', false);
export const showSnapshotsTab = persistentWritable('showSnapshotsTab', false);

// Notifications
export const notificationsEnabled = persistentWritable('notificationsEnabled', true);

// Window
export type CloseBehavior = 'quit' | 'minimize';
export const closeBehavior = persistentWritable<CloseBehavior>('closeBehavior', 'quit');

// ── AI providers & models ──
// Voice refinement and AI commit messages route through one of several
// providers. Each provider has its own API key (or, for local providers, a
// server URL) and its own model list; the model picker in Settings swaps to the
// selected provider's models. The Rust backend (`commands/secrets.rs`) calls
// each provider's native API directly.
//
// Local providers (Ollama, LM Studio) run on the user's own machine. They need
// a base URL instead of an API key and expose OpenAI-compatible endpoints, so
// the backend reuses its OpenAI-compatible request path with no auth header.
export type AiProviderId =
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'groq'
  | 'ollama'
  | 'lmstudio'
  | 'local';

export type VoiceInputProviderId = 'webspeech' | 'google' | 'openai' | 'openrouter' | 'ollama' | 'lmstudio' | 'local';

export interface AiModelOption {
  id: string;
  label: string;
  description: string;
  free?: boolean;
}

export interface AiProviderDef {
  id: AiProviderId;
  label: string;
  /** Label shown above the key field, e.g. "OpenRouter API key". */
  keyLabel: string;
  /** Placeholder hinting at the key shape, e.g. "sk-or-...". */
  keyPlaceholder: string;
  /** Where the user can create a key (or, for local providers, install docs). */
  keyUrl: string;
  defaultModel: string;
  models: AiModelOption[];
  ttsSupport?: 'native' | 'self-hosted' | 'none';
  /**
   * Local providers run on the user's own machine and are configured with a
   * server URL instead of an API key. The model picker, readiness checks and
   * backend auth all branch on this flag.
   */
  local?: boolean;
  /**
   * OpenAI-compatible base URL for local providers (root that owns
   * `/chat/completions` and `/models`), e.g. `http://localhost:11434/v1`.
   */
  defaultBaseUrl?: string;
}

export const aiProviders: AiProviderDef[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    keyLabel: 'OpenRouter API key',
    keyPlaceholder: 'sk-or-...',
    keyUrl: 'https://openrouter.ai/keys',
    defaultModel: 'google/gemini-2.5-flash',
    ttsSupport: 'native',
    models: [
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Best balance of quality and speed.' },
      { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', description: 'Cheaper, faster fallback.' },
      { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5', description: 'Best overall quality.' },
      { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5', description: 'Cheap, fast Claude.' },
      { id: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku', description: 'Fast, polished rewrites.' },
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini', description: 'Cheap OpenAI option.' },
      { id: 'qwen/qwen3-30b-a3b-instruct-2507', label: 'Qwen3 30B Instruct', description: 'Very cheap fallback.' },
      { id: 'qwen/qwen-2.5-7b-instruct', label: 'Qwen 2.5 7B Instruct', description: 'Ultra-cheap fallback.' },
      { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B', description: 'Free Google option.', free: true },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    keyLabel: 'Anthropic API key',
    keyPlaceholder: 'sk-ant-...',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-3-5-haiku-latest',
    ttsSupport: 'none',
    models: [
      { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku', description: 'Fast and cheap — great for refinement.' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', description: 'Newest fast Claude.' },
      { id: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet', description: 'Higher quality, pricier.' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    keyLabel: 'OpenAI API key',
    keyPlaceholder: 'sk-...',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o-mini',
    ttsSupport: 'native',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', description: 'Cheap, fast, capable.' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', description: 'Improved mini model.' },
      { id: 'gpt-4o', label: 'GPT-4o', description: 'Flagship quality.' },
      { id: 'gpt-4.1', label: 'GPT-4.1', description: 'Highest quality OpenAI option.' },
    ],
  },
  {
    id: 'google',
    label: 'Google Gemini',
    keyLabel: 'Google AI API key',
    keyPlaceholder: 'AIza...',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    defaultModel: 'gemini-2.5-flash',
    ttsSupport: 'native',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Best balance of quality and speed.' },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', description: 'Cheaper, faster fallback.' },
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', description: 'Older, very cheap.' },
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    keyLabel: 'Groq API key',
    keyPlaceholder: 'gsk_...',
    keyUrl: 'https://console.groq.com/keys',
    defaultModel: 'llama-3.1-8b-instant',
    ttsSupport: 'native',
    models: [
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant', description: 'Extremely fast and cheap.' },
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile', description: 'Higher quality, still fast.' },
    ],
  },
  {
    id: 'ollama',
    label: 'Ollama',
    local: true,
    defaultBaseUrl: 'http://localhost:11434/v1',
    keyLabel: 'Ollama server URL',
    keyPlaceholder: 'http://localhost:11434/v1',
    keyUrl: 'https://ollama.com/download',
    ttsSupport: 'self-hosted',
    // Runs entirely on your machine. The model list is read live from your
    // server; these are common pulls shown until then.
    defaultModel: 'llama3.1',
    models: [
      { id: 'llama3.1', label: 'Llama 3.1', description: 'Meta Llama 3.1, a solid general default.' },
      { id: 'qwen2.5', label: 'Qwen 2.5', description: 'Strong general-purpose model.' },
      { id: 'qwen2.5-coder', label: 'Qwen 2.5 Coder', description: 'Tuned for code tasks.' },
      { id: 'gemma2', label: 'Gemma 2', description: 'Google Gemma 2, lightweight.' },
      { id: 'phi3', label: 'Phi-3', description: 'Small and fast Microsoft model.' },
    ],
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    local: true,
    defaultBaseUrl: 'http://localhost:1234/v1',
    keyLabel: 'LM Studio server URL',
    keyPlaceholder: 'http://localhost:1234/v1',
    keyUrl: 'https://lmstudio.ai/docs/app/api/endpoints/openai',
    ttsSupport: 'self-hosted',
    // The model id is whatever you've loaded in LM Studio's server tab; the
    // live list reflects your loaded models. `local-model` works as a generic
    // alias for the currently-loaded model.
    defaultModel: 'local-model',
    models: [
      { id: 'local-model', label: 'Loaded model', description: 'Uses whichever model LM Studio currently has loaded.' },
    ],
  },
  {
    id: 'local',
    label: 'Local (Offline)',
    local: true,
    defaultBaseUrl: '',
    keyLabel: '',
    keyPlaceholder: '',
    keyUrl: '',
    ttsSupport: 'native',
    defaultModel: 'parakeet-tdt-v3',
    models: [
      { id: 'whisper-tiny-en', label: 'Whisper Tiny (English)', description: 'Fast offline Speech-to-Text.' },
      { id: 'whisper-base-en', label: 'Whisper Base (English)', description: 'Balanced offline Speech-to-Text.' },
      { id: 'whisper-small-en', label: 'Whisper Small (English)', description: 'Higher-accuracy offline Speech-to-Text.' },
      { id: 'whisper-large-v3-turbo-q5', label: 'Whisper Large v3 Turbo (Quantized)', description: 'Latest multilingual Speech-to-Text, compact.' },
      { id: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo (Full)', description: 'Highest-accuracy multilingual Speech-to-Text.' },
      { id: 'parakeet-tdt-v3', label: 'NVIDIA Parakeet TDT v3', description: 'Fastest, top-accuracy multilingual Speech-to-Text (WASM).' },
      { id: 'kokoro-tts-v1.0', label: 'Kokoro TTS (v1.0)', description: 'Offline Text-to-Speech.' },
    ],
  },
];

export function getProviderDef(id: AiProviderId): AiProviderDef {
  return aiProviders.find((p) => p.id === id) ?? aiProviders[0];
}

export function getProviderTtsBadge(id: AiProviderId): string | null {
  const support = getProviderDef(id).ttsSupport ?? 'none';
  switch (support) {
    case 'native':
      return 'TTS';
    case 'self-hosted':
      return 'Self-hosted TTS';
    default:
      return null;
  }
}

export interface TtsVoiceOption {
  id: string;
  label: string;
  description: string;
}

export interface TtsModelOption extends AiModelOption {
  voices?: TtsVoiceOption[];
}

export const groqTtsVoiceOptions: TtsVoiceOption[] = [
  { id: 'austin', label: 'Austin', description: 'Male voice' },
  { id: 'daniel', label: 'Daniel', description: 'Male voice' },
  { id: 'troy', label: 'Troy', description: 'Male voice' },
  { id: 'autumn', label: 'Autumn', description: 'Female voice' },
  { id: 'diana', label: 'Diana', description: 'Female voice' },
  { id: 'hannah', label: 'Hannah', description: 'Female voice' },
];

export const openAiTtsVoiceOptions: TtsVoiceOption[] = [
  { id: 'alloy', label: 'Alloy', description: 'OpenAI built-in voice' },
  { id: 'ash', label: 'Ash', description: 'OpenAI built-in voice' },
  { id: 'ballad', label: 'Ballad', description: 'OpenAI built-in voice' },
  { id: 'coral', label: 'Coral', description: 'OpenAI built-in voice' },
  { id: 'echo', label: 'Echo', description: 'OpenAI built-in voice' },
  { id: 'fable', label: 'Fable', description: 'OpenAI built-in voice' },
  { id: 'onyx', label: 'Onyx', description: 'OpenAI built-in voice' },
  { id: 'nova', label: 'Nova', description: 'OpenAI built-in voice' },
  { id: 'sage', label: 'Sage', description: 'OpenAI built-in voice' },
  { id: 'shimmer', label: 'Shimmer', description: 'OpenAI built-in voice' },
  { id: 'verse', label: 'Verse', description: 'OpenAI built-in voice' },
  { id: 'marin', label: 'Marin', description: 'OpenAI built-in voice' },
  { id: 'cedar', label: 'Cedar', description: 'OpenAI built-in voice' },
];

export const googleTtsVoiceOptions: TtsVoiceOption[] = [
  { id: 'Zephyr', label: 'Zephyr', description: 'Bright' },
  { id: 'Puck', label: 'Puck', description: 'Upbeat' },
  { id: 'Charon', label: 'Charon', description: 'Informative' },
  { id: 'Kore', label: 'Kore', description: 'Firm' },
  { id: 'Fenrir', label: 'Fenrir', description: 'Excitable' },
  { id: 'Leda', label: 'Leda', description: 'Youthful' },
  { id: 'Orus', label: 'Orus', description: 'Firm' },
  { id: 'Aoede', label: 'Aoede', description: 'Breezy' },
  { id: 'Callirrhoe', label: 'Callirrhoe', description: 'Easy-going' },
  { id: 'Autonoe', label: 'Autonoe', description: 'Bright' },
  { id: 'Enceladus', label: 'Enceladus', description: 'Breathy' },
  { id: 'Iapetus', label: 'Iapetus', description: 'Clear' },
  { id: 'Umbriel', label: 'Umbriel', description: 'Easy-going' },
  { id: 'Algieba', label: 'Algieba', description: 'Smooth' },
  { id: 'Despina', label: 'Despina', description: 'Smooth' },
  { id: 'Erinome', label: 'Erinome', description: 'Clear' },
  { id: 'Algenib', label: 'Algenib', description: 'Gravelly' },
  { id: 'Rasalgethi', label: 'Rasalgethi', description: 'Informative' },
  { id: 'Laomedeia', label: 'Laomedeia', description: 'Upbeat' },
  { id: 'Achernar', label: 'Achernar', description: 'Soft' },
  { id: 'Alnilam', label: 'Alnilam', description: 'Firm' },
  { id: 'Schedar', label: 'Schedar', description: 'Even' },
  { id: 'Gacrux', label: 'Gacrux', description: 'Mature' },
  { id: 'Pulcherrima', label: 'Pulcherrima', description: 'Forward' },
  { id: 'Achird', label: 'Achird', description: 'Friendly' },
  { id: 'Zubenelgenubi', label: 'Zubenelgenubi', description: 'Casual' },
  { id: 'Vindemiatrix', label: 'Vindemiatrix', description: 'Gentle' },
  { id: 'Sadachbia', label: 'Sadachbia', description: 'Lively' },
  { id: 'Sadaltager', label: 'Sadaltager', description: 'Knowledgeable' },
  { id: 'Sulafat', label: 'Sulafat', description: 'Warm' },
];

const microsoftMaiVoiceOptions: TtsVoiceOption[] = [
  { id: 'en-US-Harper:MAI-Voice-2', label: 'Harper', description: 'English (US)' },
  { id: 'es-MX-Valeria:MAI-Voice-2', label: 'Valeria', description: 'Spanish (Mexico)' },
  { id: 'fr-FR-Soleil:MAI-Voice-2', label: 'Soleil', description: 'French (France)' },
  { id: 'de-DE-Klaus:MAI-Voice-2', label: 'Klaus', description: 'German (Germany)' },
];

const grokVoiceOptions: TtsVoiceOption[] = [
  { id: 'eve', label: 'Eve', description: 'xAI voice' },
  { id: 'ara', label: 'Ara', description: 'xAI voice' },
  { id: 'rex', label: 'Rex', description: 'xAI voice' },
  { id: 'sal', label: 'Sal', description: 'xAI voice' },
  { id: 'leo', label: 'Leo', description: 'xAI voice' },
];

const zonosVoiceOptions: TtsVoiceOption[] = [
  { id: 'american_female', label: 'American Female', description: 'Zonos voice preset' },
  { id: 'american_male', label: 'American Male', description: 'Zonos voice preset' },
  { id: 'british_female', label: 'British Female', description: 'Zonos voice preset' },
  { id: 'british_male', label: 'British Male', description: 'Zonos voice preset' },
  { id: 'random', label: 'Random', description: 'Random Zonos voice' },
];

const sesameVoiceOptions: TtsVoiceOption[] = [
  { id: 'conversational_a', label: 'Conversational A', description: 'Conversational CSM voice' },
  { id: 'conversational_b', label: 'Conversational B', description: 'Conversational CSM voice' },
  { id: 'read_speech_a', label: 'Read Speech A', description: 'Narration CSM voice' },
  { id: 'read_speech_b', label: 'Read Speech B', description: 'Narration CSM voice' },
  { id: 'read_speech_c', label: 'Read Speech C', description: 'Narration CSM voice' },
  { id: 'read_speech_d', label: 'Read Speech D', description: 'Narration CSM voice' },
  { id: 'none', label: 'None', description: 'No fixed CSM voice' },
];

const orpheusVoiceOptions: TtsVoiceOption[] = [
  { id: 'tara', label: 'Tara', description: 'Orpheus voice' },
  { id: 'leah', label: 'Leah', description: 'Orpheus voice' },
  { id: 'jess', label: 'Jess', description: 'Orpheus voice' },
  { id: 'leo', label: 'Leo', description: 'Orpheus voice' },
  { id: 'dan', label: 'Dan', description: 'Orpheus voice' },
  { id: 'mia', label: 'Mia', description: 'Orpheus voice' },
  { id: 'zac', label: 'Zac', description: 'Orpheus voice' },
];

const kokoroVoiceOptions: TtsVoiceOption[] = [
  { id: 'af_alloy', label: 'Alloy', description: 'American female Kokoro voice' },
  { id: 'af_aoede', label: 'Aoede', description: 'American female Kokoro voice' },
  { id: 'af_bella', label: 'Bella', description: 'American female Kokoro voice' },
  { id: 'af_heart', label: 'Heart', description: 'American female Kokoro voice' },
  { id: 'af_jessica', label: 'Jessica', description: 'American female Kokoro voice' },
  { id: 'af_kore', label: 'Kore', description: 'American female Kokoro voice' },
  { id: 'af_nicole', label: 'Nicole', description: 'American female Kokoro voice' },
  { id: 'af_nova', label: 'Nova', description: 'American female Kokoro voice' },
  { id: 'af_river', label: 'River', description: 'American female Kokoro voice' },
  { id: 'af_sarah', label: 'Sarah', description: 'American female Kokoro voice' },
  { id: 'af_sky', label: 'Sky', description: 'American female Kokoro voice' },
  { id: 'am_adam', label: 'Adam', description: 'American male Kokoro voice' },
  { id: 'am_echo', label: 'Echo', description: 'American male Kokoro voice' },
  { id: 'am_eric', label: 'Eric', description: 'American male Kokoro voice' },
  { id: 'am_fenrir', label: 'Fenrir', description: 'American male Kokoro voice' },
  { id: 'am_liam', label: 'Liam', description: 'American male Kokoro voice' },
  { id: 'am_michael', label: 'Michael', description: 'American male Kokoro voice' },
  { id: 'am_onyx', label: 'Onyx', description: 'American male Kokoro voice' },
  { id: 'am_puck', label: 'Puck', description: 'American male Kokoro voice' },
  { id: 'bf_alice', label: 'Alice', description: 'British female Kokoro voice' },
  { id: 'bf_emma', label: 'Emma', description: 'British female Kokoro voice' },
  { id: 'bm_daniel', label: 'Daniel', description: 'British male Kokoro voice' },
  { id: 'bm_fable', label: 'Fable', description: 'British male Kokoro voice' },
];

const voxtralTtsVoiceOptions: TtsVoiceOption[] = [
  { id: 'en_paul_neutral', label: 'Paul Neutral', description: 'English voice' },
  { id: 'en_paul_happy', label: 'Paul Happy', description: 'English voice' },
  { id: 'en_paul_confident', label: 'Paul Confident', description: 'English voice' },
  { id: 'en_paul_cheerful', label: 'Paul Cheerful', description: 'English voice' },
  { id: 'gb_oliver_neutral', label: 'Oliver Neutral', description: 'British English voice' },
  { id: 'gb_oliver_curious', label: 'Oliver Curious', description: 'British English voice' },
  { id: 'gb_jane_neutral', label: 'Jane Neutral', description: 'British English voice' },
  { id: 'gb_jane_confident', label: 'Jane Confident', description: 'British English voice' },
  { id: 'fr_marie_neutral', label: 'Marie Neutral', description: 'French voice' },
  { id: 'fr_marie_happy', label: 'Marie Happy', description: 'French voice' },
];

export const openRouterTtsModelOptions: TtsModelOption[] = [
  { id: 'openai/gpt-4o-mini-tts-2025-12-15', label: 'OpenAI GPT-4o Mini TTS', description: 'OpenAI-compatible speech model.', voices: openAiTtsVoiceOptions },
  { id: 'mistralai/voxtral-mini-tts-2603', label: 'Mistral Voxtral Mini TTS', description: 'Expressive multilingual Voxtral speech.', voices: voxtralTtsVoiceOptions },
  { id: 'microsoft/mai-voice-2', label: 'Microsoft MAI-Voice-2', description: 'Azure-backed multilingual voices.', voices: microsoftMaiVoiceOptions },
  { id: 'x-ai/grok-voice-tts-1.0', label: 'Grok Voice TTS 1.0', description: 'xAI voice synthesis.', voices: grokVoiceOptions },
  { id: 'google/gemini-3.1-flash-tts-preview', label: 'Gemini 3.1 Flash TTS Preview', description: 'Google Gemini speech through OpenRouter.', voices: googleTtsVoiceOptions },
  { id: 'zyphra/zonos-v0.1-hybrid', label: 'Zonos v0.1 Hybrid', description: 'Compact open speech model.', voices: zonosVoiceOptions },
  { id: 'zyphra/zonos-v0.1-transformer', label: 'Zonos v0.1 Transformer', description: 'Transformer Zonos speech model.', voices: zonosVoiceOptions },
  { id: 'sesame/csm-1b', label: 'Sesame CSM 1B', description: 'Conversational speech model.', voices: sesameVoiceOptions },
  { id: 'canopylabs/orpheus-3b-0.1-ft', label: 'Canopy Orpheus 3B', description: 'Expressive Orpheus voices.', voices: orpheusVoiceOptions },
  { id: 'hexgrad/kokoro-82m', label: 'Kokoro 82M', description: 'Fast low-cost TTS with many voices.', voices: kokoroVoiceOptions },
];

export const openRouterVoiceInputModels: AiModelOption[] = [
  { id: 'openai/gpt-4o-mini-transcribe', label: 'GPT-4o Mini Transcribe', description: 'Modern low-cost OpenAI STT.' },
  { id: 'openai/gpt-4o-transcribe', label: 'GPT-4o Transcribe', description: 'Higher-quality OpenAI STT.' },
  { id: 'openai/whisper-1', label: 'OpenAI Whisper 1', description: 'Stable OpenRouter STT default.' },
  { id: 'openai/whisper-large-v3', label: 'Whisper Large v3', description: 'Higher-accuracy Whisper transcription.' },
  { id: 'openai/whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo', description: 'Faster Whisper Large v3 variant.' },
  { id: 'mistralai/voxtral-mini-transcribe', label: 'Voxtral Mini Transcribe', description: 'Mistral transcription model.' },
  { id: 'microsoft/mai-transcribe-1.5', label: 'MAI-Transcribe 1.5', description: 'Microsoft transcription model.' },
  { id: 'nvidia/parakeet-tdt-0.6b-v3', label: 'Parakeet TDT 0.6B v3', description: 'NVIDIA ASR model.' },
  { id: 'qwen/qwen3-asr-flash-2026-02-10', label: 'Qwen3 ASR Flash', description: 'Fast Qwen speech recognition.' },
  { id: 'google/chirp-3', label: 'Google Chirp 3', description: 'Google speech recognition through OpenRouter.' },
];

export const openAiVoiceInputModels: AiModelOption[] = [
  { id: 'whisper-1', label: 'Whisper 1', description: 'OpenAI Whisper STT model.' },
];

export const localVoiceInputModels: AiModelOption[] = [
  { id: 'local-stt-model', label: 'Local STT model', description: 'Generic model id for an OpenAI-compatible /audio/transcriptions server.' },
  { id: 'whisper-1', label: 'Whisper 1', description: 'Common OpenAI-compatible Whisper alias.' },
  { id: 'whisper-large-v3', label: 'Whisper Large v3', description: 'Common local Whisper model id.' },
  { id: 'whisper.cpp', label: 'whisper.cpp', description: 'Common whisper.cpp server model id.' },
];

export function getVoiceInputModelOptions(provider: VoiceInputProviderId): AiModelOption[] {
  switch (provider) {
    case 'google':
      return getProviderDef('google').models.filter((model) => model.id.startsWith('gemini'));
    case 'openrouter':
      return openRouterVoiceInputModels;
    case 'openai':
      return openAiVoiceInputModels;
    case 'ollama':
    case 'lmstudio':
      return localVoiceInputModels;
    case 'local':
      return [
        { id: 'whisper-tiny-en', label: 'Whisper Tiny (English)', description: 'Fast offline Speech-to-Text.' },
        { id: 'whisper-base-en', label: 'Whisper Base (English)', description: 'Balanced offline Speech-to-Text.' },
        { id: 'whisper-small-en', label: 'Whisper Small (English)', description: 'Higher-accuracy offline Speech-to-Text.' },
        { id: 'whisper-large-v3-turbo-q5', label: 'Whisper Large v3 Turbo (Quantized)', description: 'Latest multilingual Speech-to-Text, compact.' },
        { id: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo (Full)', description: 'Highest-accuracy multilingual Speech-to-Text.' },
        { id: 'parakeet-tdt-v3', label: 'NVIDIA Parakeet TDT v3', description: 'Fastest, top-accuracy multilingual Speech-to-Text (WASM).' },
      ];
    default:
      return [];
  }
}

export function getDefaultVoiceInputModel(provider: VoiceInputProviderId): string {
  switch (provider) {
    case 'google':
      return getProviderDef('google').defaultModel;
    case 'openrouter':
      return 'openai/whisper-1';
    case 'openai':
      return 'whisper-1';
    case 'ollama':
    case 'lmstudio':
      return 'local-stt-model';
    case 'local':
      return 'parakeet-tdt-v3';
    default:
      return '';
  }
}

export function getTtsVoiceOptions(provider: AiProviderId): TtsVoiceOption[] {
  return getTtsVoiceOptionsForModel(provider, getDefaultTtsModel(provider));
}

export function getTtsVoiceOptionsForModel(provider: AiProviderId, modelId: string): TtsVoiceOption[] {
  switch (provider) {
    case 'openrouter': {
      const match = openRouterTtsModelOptions.find((model) => model.id === modelId);
      if (match?.voices) return match.voices;
      const idLc = modelId.toLowerCase();
      if (idLc.includes('kokoro')) return kokoroVoiceOptions;
      if (idLc.includes('voxtral')) return voxtralTtsVoiceOptions;
      if (idLc.includes('orpheus')) return orpheusVoiceOptions;
      if (idLc.includes('gemini') || idLc.includes('google')) return googleTtsVoiceOptions;
      return openAiTtsVoiceOptions;
    }
    case 'groq':
      return groqTtsVoiceOptions;
    case 'openai':
      return openAiTtsVoiceOptions;
    case 'google':
      return googleTtsVoiceOptions;
    case 'local':
      return kokoroVoiceOptions;
    default:
      return [];
  }
}

export function getTtsModelOptions(provider: AiProviderId): TtsModelOption[] {
  switch (provider) {
    case 'openrouter':
      return openRouterTtsModelOptions;
    case 'groq':
      return [
        { id: 'canopylabs/orpheus-v1-english', label: 'Orpheus v1 English', description: 'Groq hosted Orpheus TTS.', voices: groqTtsVoiceOptions },
      ];
    case 'openai':
      return [
        { id: 'gpt-4o-mini-tts', label: 'GPT-4o Mini TTS', description: 'OpenAI speech model.', voices: openAiTtsVoiceOptions },
      ];
    case 'google':
      return [
        { id: 'gemini-2.5-flash-preview-tts', label: 'Gemini 2.5 Flash Preview TTS', description: 'Google Gemini speech model.', voices: googleTtsVoiceOptions },
      ];
    case 'local':
      return [
        { id: 'kokoro-tts-v1.0', label: 'Kokoro TTS (v1.0)', description: 'Offline speech synthesis.', voices: kokoroVoiceOptions },
      ];
    default:
      return [];
  }
}

export function getDefaultTtsModel(provider: AiProviderId): string {
  switch (provider) {
    case 'openrouter':
      return 'openai/gpt-4o-mini-tts-2025-12-15';
    case 'groq':
      return 'canopylabs/orpheus-v1-english';
    case 'openai':
      return 'gpt-4o-mini-tts';
    case 'google':
      return 'gemini-2.5-flash-preview-tts';
    case 'local':
      return 'kokoro-tts-v1.0';
    default:
      return 'local-tts-model';
  }
}

export function getDefaultTtsVoice(provider: AiProviderId): string {
  switch (provider) {
    case 'openrouter':
      return 'alloy';
    case 'groq':
      return 'austin';
    case 'openai':
      return 'alloy';
    case 'google':
      return 'Kore';
    case 'local':
      return 'af_bella';
    default:
      return 'default';
  }
}

export function providerSupportsReplyTts(provider: AiProviderId): boolean {
  return provider === 'openrouter' || provider === 'groq' || provider === 'openai' || provider === 'google' || isLocalProvider(provider);
}

export const voiceRefinementEnabled = persistentWritable('voiceRefinementEnabled', false);
export const voiceInputProvider = persistentWritable<VoiceInputProviderId>('voiceInputProvider', 'webspeech');
export const voiceInputModelByProvider = persistentWritable<Record<string, string>>('voiceInputModelByProvider', {});
export const voiceAiProvider = persistentWritable<AiProviderId>('voiceAiProvider', 'groq');
export const voiceAiModelByProvider = persistentWritable<Record<string, string>>('voiceAiModelByProvider', {});
export const voiceConversationAiProvider = persistentWritable<AiProviderId>('voiceConversationAiProvider', 'openrouter');
export const voiceConversationAiModelByProvider = persistentWritable<Record<string, string>>('voiceConversationAiModelByProvider', {});
export const voiceConversationTtsModelByProvider = persistentWritable<Record<string, string>>('voiceConversationTtsModelByProvider', {});
export const voiceConversationTtsVoiceByProvider = persistentWritable<Record<string, string>>('voiceConversationTtsVoiceByProvider', {});
/**
 * The provider that synthesizes spoken replies (TTS). Decoupled from the
 * conversation *brain* provider (`voiceConversationAiProvider`) so you can run a
 * cloud brain while keeping local (Kokoro) speech — or any other mix. The TTS
 * model/voice maps above are keyed by provider, so each provider remembers its
 * own speech model + voice regardless of which brain is active.
 */
export const voiceReplyProvider = persistentWritable<AiProviderId>('voiceReplyProvider', 'openrouter');
export const ttsVoice = persistentWritable<string>('ttsVoice', 'austin');

/**
 * When on, the orchestrator speaks a short status line aloud each time an agent
 * finishes/blocks/fails ("Codex finished: Add dark mode"), independent of whether
 * the voice conversation overlay is open. The detailed recap stays on-demand.
 */
export const announceAgentCompletions = persistentWritable<boolean>('announceAgentCompletions', true);

export const currentVoiceInputModel = derived(
  [voiceInputProvider, voiceInputModelByProvider],
  ([$provider, $map]) => {
    if ($provider === 'webspeech') return '';
    const remembered = $map[$provider];
    if (remembered && remembered.trim()) {
      const trimmed = remembered.trim();
      if ($provider === 'ollama' || $provider === 'lmstudio') return trimmed;
      if (getVoiceInputModelOptions($provider).some((model) => model.id === trimmed)) return trimmed;
    }
    return getDefaultVoiceInputModel($provider);
  }
);

export function setVoiceInputModel(provider: Exclude<VoiceInputProviderId, 'webspeech'>, modelId: string) {
  voiceInputModelByProvider.update((map) => ({ ...map, [provider]: modelId.trim() }));
}

export function voiceInputUsesModelTranscription(provider: VoiceInputProviderId): boolean {
  return provider === 'google' || provider === 'openai' || provider === 'openrouter' || provider === 'ollama' || provider === 'lmstudio' || provider === 'local';
}

export const currentVoiceAiModel = derived(
  [voiceAiProvider, voiceAiModelByProvider],
  ([$provider, $map]) => {
    const def = getProviderDef($provider);
    const remembered = $map[$provider];
    return remembered && remembered.trim() ? remembered : def.defaultModel;
  }
);

export function setVoiceAiModel(provider: AiProviderId, modelId: string) {
  voiceAiModelByProvider.update((map) => ({ ...map, [provider]: modelId }));
}

export const currentVoiceConversationAiModel = derived(
  [voiceConversationAiProvider, voiceConversationAiModelByProvider],
  ([$provider, $map]) => {
    const def = getProviderDef($provider);
    const remembered = $map[$provider];
    return remembered && remembered.trim() ? remembered : def.defaultModel;
  }
);

export function setVoiceConversationAiModel(provider: AiProviderId, modelId: string) {
  voiceConversationAiModelByProvider.update((map) => ({ ...map, [provider]: modelId }));
}

export const currentVoiceConversationTtsModel = derived(
  [voiceReplyProvider, voiceConversationTtsModelByProvider],
  ([$provider, $map]) => {
    const remembered = $map[$provider];
    return remembered && remembered.trim() ? remembered : getDefaultTtsModel($provider);
  }
);

export const currentVoiceConversationTtsVoice = derived(
  [voiceReplyProvider, voiceConversationTtsVoiceByProvider],
  ([$provider, $map]) => {
    const remembered = $map[$provider];
    return remembered && remembered.trim() ? remembered : getDefaultTtsVoice($provider);
  }
);

export function setVoiceConversationTtsModel(provider: AiProviderId, modelId: string) {
  voiceConversationTtsModelByProvider.update((map) => ({ ...map, [provider]: modelId.trim() }));
}

export function setVoiceConversationTtsVoice(provider: AiProviderId, voiceId: string) {
  voiceConversationTtsVoiceByProvider.update((map) => ({ ...map, [provider]: voiceId.trim() }));
}

// Selected provider + per-provider remembered model choice.

export const aiProvider = persistentWritable<AiProviderId>('aiProvider', 'openrouter');
export const aiModelByProvider = persistentWritable<Record<string, string>>('aiModelByProvider', {});

// Per-provider server URL, used only by local providers (Ollama, LM Studio).
// Empty means "fall back to the provider's defaultBaseUrl".
export const aiBaseUrlByProvider = persistentWritable<Record<string, string>>('aiBaseUrlByProvider', {});

// AI ghost text ("Cursor Tab"): faded inline code predictions accepted with Tab.
// Off by default — it streams surrounding code to an AI provider on every typing
// pause, so it's opt-in. Uses its own provider/model so completions can use a
// fast/cheap model independent of the main AI provider (commit msgs, voice).
export const aiGhostTextEnabled = persistentWritable('aiGhostTextEnabled', false);
export const aiCompletionProvider = persistentWritable<AiProviderId>('aiCompletionProvider', 'groq');
export const aiCompletionModelByProvider = persistentWritable<Record<string, string>>('aiCompletionModelByProvider', {});

/** Whether a provider runs locally and is configured by URL rather than key. */
export function isLocalProvider(id: AiProviderId): boolean {
  return getProviderDef(id).local === true;
}

/**
 * The effective server URL for a local provider: the user's override if set,
 * otherwise the provider's default. Returns '' for non-local providers.
 */
export function getProviderBaseUrl(id: AiProviderId, overrides?: Record<string, string>): string {
  const def = getProviderDef(id);
  if (!def.local) return '';
  const map = overrides ?? get(aiBaseUrlByProvider);
  const override = map[id];
  return (override && override.trim()) || def.defaultBaseUrl || '';
}

export function setProviderBaseUrl(id: AiProviderId, url: string) {
  aiBaseUrlByProvider.update((map) => ({ ...map, [id]: url.trim() }));
}

// One-time migration: fold the legacy single voice model into the new
// voice-specific provider + model stores so existing users keep their choice.
if (typeof localStorage !== 'undefined') {
  const legacy = localStorage.getItem('forge_setting_voiceRefinementModel');
  if (legacy) {
    try {
      const model = JSON.parse(legacy);
      if (typeof model === 'string' && model) {
        if (!localStorage.getItem('forge_setting_voiceAiProvider')) {
          voiceAiProvider.set('openrouter');
        }
        voiceAiModelByProvider.update((map) => (map.openrouter ? map : { ...map, openrouter: model }));
      }
    } catch {
      // Ignore malformed legacy value.
    }
    localStorage.removeItem('forge_setting_voiceRefinementModel');
  }

  if (!localStorage.getItem('forge_setting_voiceConversationAiProvider')) {
    const legacyProvider = localStorage.getItem('forge_setting_aiProvider');
    if (legacyProvider) {
      try {
        const provider = JSON.parse(legacyProvider);
        if (typeof provider === 'string' && provider) {
          voiceConversationAiProvider.set(provider as AiProviderId);
        }
      } catch {
        // Ignore malformed legacy value.
      }
    }
  }

  if (!localStorage.getItem('forge_setting_voiceConversationAiModelByProvider')) {
    const legacyModelMap = localStorage.getItem('forge_setting_aiModelByProvider');
    if (legacyModelMap) {
      try {
        const modelMap = JSON.parse(legacyModelMap);
        if (modelMap && typeof modelMap === 'object' && !Array.isArray(modelMap)) {
          voiceConversationAiModelByProvider.set(modelMap as Record<string, string>);
        }
      } catch {
        // Ignore malformed legacy value.
      }
    }
  }

  // Reply TTS used to be tied to the conversation brain provider. Seed the new
  // standalone reply-provider from it so existing users' spoken voice is unchanged
  // after the split; they can now point the brain elsewhere without losing it.
  if (!localStorage.getItem('forge_setting_voiceReplyProvider')) {
    const existing = localStorage.getItem('forge_setting_voiceConversationAiProvider');
    if (existing) {
      try {
        const provider = JSON.parse(existing);
        if (typeof provider === 'string' && provider) {
          voiceReplyProvider.set(provider as AiProviderId);
        }
      } catch {
        // Ignore malformed legacy value.
      }
    }
  }

  const legacyTtsVoice = localStorage.getItem('forge_setting_ttsVoice');
  if (legacyTtsVoice) {
    try {
      const voice = JSON.parse(legacyTtsVoice);
      if (!localStorage.getItem('forge_setting_voiceConversationTtsVoiceByProvider')) {
        const nextVoice = voice === 'Arista-PlayAI' ? 'austin' : voice;
        if (typeof nextVoice === 'string' && nextVoice) {
          voiceConversationTtsVoiceByProvider.set({ groq: nextVoice });
        }
      }
      if (voice === 'Arista-PlayAI') {
        ttsVoice.set('austin');
      }
    } catch {
      // Ignore malformed legacy value.
    }
  }

  voiceConversationTtsModelByProvider.update((map) => {
    if (map.google !== 'gemini-3.1-flash-tts-preview') return map;
    return {
      ...map,
      google: 'gemini-2.5-flash-preview-tts',
    };
  });
}

// The active model id, derived from the selected provider and its remembered
// choice (falling back to the provider's default). The remembered id is trusted
// as-is: models are now loaded live from each provider, so a valid choice may
// not appear in the static curated `models` list.
export const currentAiModel = derived(
  [aiProvider, aiModelByProvider],
  ([$provider, $map]) => {
    const def = getProviderDef($provider);
    const remembered = $map[$provider];
    return remembered && remembered.trim() ? remembered : def.defaultModel;
  }
);

export function setAiModel(provider: AiProviderId, modelId: string) {
  aiModelByProvider.update((map) => ({ ...map, [provider]: modelId }));
}

// UI Scaling
export const uiZoom = persistentWritable('uiZoom', 100);

// Layout navigation
// A horizontal trackpad swipe (or shift + mouse wheel) slides between the
// ambient layout modes (Focus → Split → Gallery). Some users find it fires by
// accident while scrolling sideways, so it can be switched off here. Even when
// on, a swipe that starts inside the code editor never switches modes.
export const swipeNavigationEnabled = persistentWritable<boolean>('swipeNavigationEnabled', true);

// Code Formatting
export const formatOnSave = persistentWritable('formatOnSave', true);

// Voice Personalities
export interface VoicePersonalityOption {
  id: string;
  label: string;
  description: string;
  systemPrompt: string;
}

export const voicePersonalities: VoicePersonalityOption[] = [
  {
    id: 'helpful',
    label: 'Helpful Assistant',
    description: 'Professional, efficient, and direct. Focuses on helper productivity.',
    systemPrompt: 'You are a helpful, professional, and efficient AI coding assistant. Respond in a natural, polite, and direct human tone. Keep responses clear and focused on the task at hand without unnecessary preamble.'
  },
  {
    id: 'friendly',
    label: 'Friendly Guide',
    description: 'Warm, encouraging, conversational, and supportive companion.',
    systemPrompt: 'You are a warm, friendly, and approachable developer companion. Speak in an encouraging, conversational, and natural human tone. Be supportive, ask how the user\'s day is going if appropriate, and maintain a pleasant, cozy atmosphere.'
  },
  {
    id: 'hype',
    label: 'Hype Coach',
    description: 'High-energy, enthusiastic motivator to pump up your confidence.',
    systemPrompt: 'You are an enthusiastic, high-energy coding coach and motivator. Respond in an optimistic, encouraging, and upbeat natural tone. Cheer the user on, keep motivation high, and help them feel excited about building and solving bugs!'
  },
  {
    id: 'zen',
    label: 'Zen Developer',
    description: 'Calm, reassuring, relaxed, and laid-back developer buddy.',
    systemPrompt: 'You are a calm, reassuring, and laid-back developer buddy. Respond in a relaxed, easy-going, and natural human tone (using terms like "hey friend", "no worries", "we got this", "easy does it"). Keep the atmosphere stress-free and supportive.'
  },
  {
    id: 'companion',
    label: 'Sarcastic Companion',
    description: 'Witty, dry, politely sarcastic companion (reminiscent of GLaDOS).',
    systemPrompt: 'You are a highly intelligent, witty, and politely sarcastic companion. Speak with dry humor and playful irony, in a natural, deadpan human tone. You can make lighthearted, clever remarks about coding bugs, software fragility, or compiler errors, but always remain helpful, co-operative, and perform the requested actions correctly.'
  }
];

export const voicePersonality = persistentWritable<string>('voicePersonality', 'helpful');

export function getVoicePersonalityDef(id: string): VoicePersonalityOption {
  return voicePersonalities.find((p) => p.id === id) ?? voicePersonalities[0];
}

// Keyboard Shortcuts
export interface KeyboardShortcut {
  id: string;
  label: string;
  keys: string;
  command?: string; // Custom shell command to run in active terminal
}

export interface ShortcutAction {
  id: string;
  label: string;
  category: string;
}

export const shortcutActions: ShortcutAction[] = [
  { id: 'commandPalette', label: 'Command Palette', category: 'View' },
  { id: 'openSettings',    label: 'Open Settings',   category: 'View' },
  { id: 'newWorkspace',   label: 'New Workspace',   category: 'Workspace' },
  { id: 'goToTerminal',   label: 'Go to Terminal',     category: 'View' },
  { id: 'goToEditor',     label: 'Go to Editor',       category: 'View' },
  { id: 'goToPreview',    label: 'Go to Preview',      category: 'View' },
  { id: 'goToOrchestrator', label: 'Go to Orchestrator', category: 'View' },
  { id: 'goToReview',     label: 'Go to Code Review',  category: 'View' },
  { id: 'goToHttp',       label: 'Go to HTTP Client',  category: 'View' },
  { id: 'goToTasks',      label: 'Go to Tasks',        category: 'View' },
  { id: 'goToDb',         label: 'Go to Database Explorer', category: 'View' },
  { id: 'goToContainers', label: 'Go to Containers',   category: 'View' },
  { id: 'goToToolbox',    label: 'Go to Dev Toolbox',  category: 'View' },
  { id: 'openSearch',     label: 'Search in Files', category: 'View' },
  { id: 'openEnvManager', label: 'Environment Manager', category: 'Workspace' },
  { id: 'saveFile',       label: 'Save File',       category: 'File' },
  { id: 'openFolder',     label: 'Open Folder',     category: 'Workspace' },
  { id: 'newTerminal',    label: 'New Terminal Tab',category: 'Terminal' },
  { id: 'formatDocument', label: 'Format Document',       category: 'Editor' },
  { id: 'startProxy',     label: 'Start Preview Proxy', category: 'Preview' },
  { id: 'stopProxy',      label: 'Stop Preview Proxy', category: 'Preview' },
  { id: 'zoomIn',         label: 'Zoom In',         category: 'Window' },
  { id: 'zoomOut',        label: 'Zoom Out',        category: 'Window' },
  { id: 'resetZoom',      label: 'Reset Zoom',      category: 'Window' },
  { id: 'quickCapture',  label: 'Quick Capture',     category: 'Workspace' },
  { id: 'openDailyNote', label: 'Open Daily Note',   category: 'Workspace' },
  { id: 'toggleSketch',   label: 'Toggle Sketch Canvas', category: 'View' },
  { id: 'launchVoiceMode', label: 'Launch Voice Mode', category: 'Voice' },
  { id: 'canvasZoomIn',   label: 'Canvas Zoom In', category: 'Canvas' },
  { id: 'canvasZoomOut',  label: 'Canvas Zoom Out', category: 'Canvas' },
  { id: 'canvasResetZoom', label: 'Canvas Reset Zoom', category: 'Canvas' },
  { id: 'cycleAmbientLayout', label: 'Cycle Ambient Layout', category: 'View' },
];

export const defaultShortcuts: KeyboardShortcut[] = [
  { id: 'commandPalette', label: 'Command Palette', keys: 'Ctrl+Shift+P' },
  { id: 'openSettings',    label: 'Open Settings',   keys: 'Ctrl+,' },
  { id: 'newWorkspace',   label: 'New Workspace',   keys: 'Ctrl+N' },
  { id: 'goToTerminal',   label: 'Go to Terminal',     keys: 'Ctrl+`' },
  { id: 'goToEditor',     label: 'Go to Editor',       keys: 'Ctrl+E' },
  { id: 'goToPreview',    label: 'Go to Preview',      keys: 'Ctrl+Shift+V' },
  { id: 'goToOrchestrator', label: 'Go to Orchestrator', keys: 'Ctrl+Shift+O' },
  { id: 'goToReview',     label: 'Go to Code Review',  keys: 'Ctrl+Shift+R' },
  { id: 'goToHttp',       label: 'Go to HTTP Client',  keys: 'Ctrl+Shift+H' },
  { id: 'goToTasks',      label: 'Go to Tasks',        keys: 'Ctrl+Shift+T' },
  { id: 'goToDb',         label: 'Go to Database Explorer', keys: 'Ctrl+Shift+B' },
  { id: 'goToContainers', label: 'Go to Containers',   keys: 'Ctrl+Shift+C' },
  { id: 'goToToolbox',    label: 'Go to Dev Toolbox',  keys: 'Ctrl+Shift+X' },
  { id: 'openSearch',     label: 'Search in Files', keys: 'Ctrl+Shift+F' },
  { id: 'openEnvManager', label: 'Environment Manager', keys: 'Ctrl+Shift+E' },
  { id: 'saveFile',       label: 'Save File',       keys: 'Ctrl+S' },
  { id: 'openFolder',     label: 'Open Folder',     keys: 'Ctrl+O' },
  { id: 'newTerminal',    label: 'New Terminal Tab',keys: 'Ctrl+Shift+`' },
  { id: 'formatDocument', label: 'Format Document',       keys: 'Alt+Shift+F' },
  { id: 'startProxy',     label: 'Start Preview Proxy', keys: 'Ctrl+Alt+P' },
  { id: 'stopProxy',      label: 'Stop Preview Proxy', keys: 'Ctrl+Alt+O' },
  { id: 'zoomIn',         label: 'Zoom In',         keys: 'Ctrl+=' },
  { id: 'zoomOut',        label: 'Zoom Out',        keys: 'Ctrl+-' },
  { id: 'resetZoom',      label: 'Reset Zoom',      keys: 'Ctrl+0' },
  { id: 'quickCapture',  label: 'Quick Capture',     keys: 'Ctrl+Shift+Space' },
  { id: 'openDailyNote', label: 'Open Daily Note',   keys: 'Ctrl+Shift+D' },
  { id: 'toggleSketch',   label: 'Toggle Sketch Canvas', keys: 'Ctrl+Shift+N' },
  { id: 'launchVoiceMode', label: 'Launch Voice Mode', keys: 'Ctrl+Shift+M' },
  { id: 'canvasZoomIn',   label: 'Canvas Zoom In', keys: 'Alt+=' },
  { id: 'canvasZoomOut',  label: 'Canvas Zoom Out', keys: 'Alt+-' },
  { id: 'canvasResetZoom', label: 'Canvas Reset Zoom', keys: 'Alt+0' },
  { id: 'cycleAmbientLayout', label: 'Cycle Ambient Layout', keys: 'Ctrl+Alt+L' },
];

export const userShortcuts = persistentWritable<KeyboardShortcut[]>('userShortcuts', defaultShortcuts);

export function parseShortcutString(str: string): string[] {
  const trimmed = str.trim();
  if (trimmed.endsWith('+') && trimmed.length > 1) {
    const lastPlus = trimmed.slice(0, -1).lastIndexOf('+');
    if (lastPlus !== -1) {
      const modifiersStr = trimmed.slice(0, lastPlus);
      const parts = modifiersStr.split('+').map(p => p.trim());
      parts.push('+');
      return parts;
    }
  }
  return trimmed.split('+').map(p => p.trim());
}

export function matchShortcut(e: KeyboardEvent, shortcutKeys: string): boolean {
  if (!shortcutKeys) return false;
  const parts = parseShortcutString(shortcutKeys).map(p => p.toLowerCase());
  
  const hasCtrl = parts.includes('ctrl');
  const hasShift = parts.includes('shift');
  const hasAlt = parts.includes('alt');
  const hasMeta = parts.includes('meta');
  
  const modifiers = ['ctrl', 'shift', 'alt', 'meta'];
  const primaryKeyPart = parts.find(p => !modifiers.includes(p));
  if (!primaryKeyPart) return false;
  
  const isCtrlPressed = e.ctrlKey || e.metaKey;
  const ctrlMatch = isCtrlPressed === hasCtrl;
  const shiftMatch = e.shiftKey === hasShift;
  const altMatch = e.altKey === hasAlt;
  const metaMatch = e.metaKey === hasMeta;
  
  let keyMatch = false;
  const eventKeyLower = e.key.toLowerCase();
  const targetKeyLower = primaryKeyPart.toLowerCase();
  
  if (targetKeyLower === 'space') {
    keyMatch = eventKeyLower === ' ' || eventKeyLower === 'space';
  } else if (targetKeyLower === 'esc' || targetKeyLower === 'escape') {
    keyMatch = eventKeyLower === 'escape' || eventKeyLower === 'esc';
  } else if (targetKeyLower === '+') {
    keyMatch = eventKeyLower === '+' || eventKeyLower === '=';
  } else if (targetKeyLower === '=') {
    keyMatch = eventKeyLower === '=' || eventKeyLower === '+';
  } else {
    keyMatch = eventKeyLower === targetKeyLower;
  }
  
  return ctrlMatch && shiftMatch && altMatch && keyMatch;
}

// Appearance / Theme
export const appearance = persistentWritable<'system' | 'light' | 'dark'>('appearance', 'system');

// Global interface transparency (0 = solid, 100 = most see-through). Controls the
// frost/glass opacity of every surface — works with or without a background image,
// letting the desktop/acrylic (or the image) show through. Default 0.
export const interfaceTransparency = persistentWritable<number>('interfaceTransparency', 0);

// Background image — an optional personalization layer painted behind the frosted UI.
// The image file lives in the app data dir (managed by the Rust backend); this only
// tracks whether it's currently shown.
export const backgroundImageEnabled = persistentWritable<boolean>('backgroundImageEnabled', false);

// Background image appearance (Terax-style), independent of the global interface
// transparency. Opacity 0–100 dims the image against the desktop; blur 0–60px
// softens it for legibility. Pure CSS on the html::before layer — no backend.
export const backgroundImageOpacity = persistentWritable<number>('backgroundImageOpacity', 100);
export const backgroundImageBlur = persistentWritable<number>('backgroundImageBlur', 0);

// Onboarding
export const onboardingCompleted = persistentWritable<boolean>('onboardingCompleted', false);

// The onboarding flag is mirrored to a durable backend file as well as
// localStorage: WebView localStorage flushes lazily and can lose the "completed"
// write when the OS is shut down abruptly, which made the tour re-appear on every
// relaunch. The backend file is the durable source of truth.
const ONBOARDING_FLAG = 'onboardingCompleted';

/** Mark onboarding complete in both localStorage and the durable backend store. */
export function markOnboardingCompleted() {
  onboardingCompleted.set(true);
  void setAppFlag(ONBOARDING_FLAG, 'true');
}

/** Reset onboarding so the tour shows again, clearing the durable flag too. */
export function markOnboardingIncomplete() {
  onboardingCompleted.set(false);
  void setAppFlag(ONBOARDING_FLAG, 'false');
}

/**
 * Reconcile the onboarding flag against the durable backend store on startup.
 * Recovers the "completed" state when localStorage lost it, and backfills the
 * backend for users who finished onboarding before this durable store existed.
 */
export async function reconcileOnboardingFlag() {
  const durable = await getAppFlag(ONBOARDING_FLAG);
  if (durable === 'true') {
    if (!get(onboardingCompleted)) onboardingCompleted.set(true);
  } else if (durable === null && get(onboardingCompleted)) {
    void setAppFlag(ONBOARDING_FLAG, 'true');
  }
}

// Terminal
export const terminalShell = persistentWritable<string>('terminalShell', ''); // empty = auto-detect
export const terminalCursorStyle = persistentWritable<'bar' | 'block' | 'underline'>('terminalCursorStyle', 'bar');
export const terminalScrollback = persistentWritable('terminalScrollback', 5000);
export const terminalFontSize = persistentWritable('terminalFontSize', 13);
export const terminalRenderer = persistentWritable<'webgl' | 'canvas' | 'dom'>('terminalRenderer', 'webgl');

export function updateSetting(key: string, value: unknown) {
  switch (key) {
    case 'fontSize':         fontSize.set(value as number); break;
    case 'fontFamily':       fontFamily.set(value as string); break;
    case 'tabSize':          tabSize.set(value as number); break;
    case 'wordWrap':         wordWrap.set(value as boolean); break;
    case 'minimap':          minimap.set(value as boolean); break;
    case 'vimMode':          vimMode.set(value as boolean); break;
    case 'enableLsp':        enableLsp.set(value as boolean); break;
    case 'aiGhostTextEnabled': aiGhostTextEnabled.set(value as boolean); break;
    case 'aiCompletionProvider': aiCompletionProvider.set(value as AiProviderId); break;
    case 'aiCompletionModelByProvider': aiCompletionModelByProvider.set(value as Record<string, string>); break;
    case 'showHidden':       showHidden.set(value as boolean); break;
    case 'voiceRefinementEnabled': voiceRefinementEnabled.set(value as boolean); break;
    case 'voiceInputProvider': voiceInputProvider.set(value as VoiceInputProviderId); break;
    case 'voiceInputModelByProvider': voiceInputModelByProvider.set(value as Record<string, string>); break;
    case 'voiceAiProvider': voiceAiProvider.set(value as AiProviderId); break;
    case 'voiceAiModelByProvider': voiceAiModelByProvider.set(value as Record<string, string>); break;
    case 'voiceConversationAiProvider': voiceConversationAiProvider.set(value as AiProviderId); break;
    case 'voiceConversationAiModelByProvider': voiceConversationAiModelByProvider.set(value as Record<string, string>); break;
    case 'voiceConversationTtsModelByProvider': voiceConversationTtsModelByProvider.set(value as Record<string, string>); break;
    case 'voiceConversationTtsVoiceByProvider': voiceConversationTtsVoiceByProvider.set(value as Record<string, string>); break;
    case 'voiceReplyProvider': voiceReplyProvider.set(value as AiProviderId); break;
    case 'aiProvider': aiProvider.set(value as AiProviderId); break;
    case 'aiModelByProvider': aiModelByProvider.set(value as Record<string, string>); break;
    case 'aiBaseUrlByProvider': aiBaseUrlByProvider.set(value as Record<string, string>); break;
    case 'uiZoom':           uiZoom.set(value as number); break;
    case 'swipeNavigationEnabled': swipeNavigationEnabled.set(value as boolean); break;
    case 'formatOnSave':     formatOnSave.set(value as boolean); break;
    case 'closeBehavior':    closeBehavior.set(value as CloseBehavior); break;
    case 'appearance':       appearance.set(value as 'system' | 'light' | 'dark'); break;
    case 'onboardingCompleted': onboardingCompleted.set(value as boolean); break;
    case 'terminalShell':    terminalShell.set(value as string); break;
    case 'terminalFontSize': terminalFontSize.set(value as number); break;
    case 'terminalRenderer': terminalRenderer.set(value as 'webgl' | 'canvas' | 'dom'); break;
  }
}

export function resetSettingsToDefault() {
  fontSize.set(14);
  fontFamily.set(FONT_FALLBACK);
  tabSize.set(2);
  wordWrap.set(true);
  minimap.set(false);
  vimMode.set(false);
  enableLsp.set(true);
  aiGhostTextEnabled.set(false);
  showHidden.set(false);
  voiceRefinementEnabled.set(false);
  voiceInputProvider.set('webspeech');
  voiceInputModelByProvider.set({});
  voiceAiProvider.set('groq');
  voiceAiModelByProvider.set({});
  voiceConversationAiProvider.set('openrouter');
  voiceConversationAiModelByProvider.set({});
  voiceConversationTtsModelByProvider.set({});
  voiceConversationTtsVoiceByProvider.set({});
  voiceReplyProvider.set('openrouter');
  ttsVoice.set('austin');
  aiProvider.set('openrouter');
  aiModelByProvider.set({});
  aiBaseUrlByProvider.set({});
  uiZoom.set(100);
  swipeNavigationEnabled.set(true);
  formatOnSave.set(true);
  closeBehavior.set('quit');
  userShortcuts.set(defaultShortcuts);
  appearance.set('system');
  interfaceTransparency.set(0);
  backgroundImageEnabled.set(false);
  backgroundImageOpacity.set(100);
  backgroundImageBlur.set(0);
  onboardingCompleted.set(false);
  void setAppFlag(ONBOARDING_FLAG, 'false');
  terminalShell.set('');
  terminalCursorStyle.set('bar');
  terminalScrollback.set(5000);
  terminalFontSize.set(13);
  terminalRenderer.set('webgl');
}


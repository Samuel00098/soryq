import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import {
  currentVoiceConversationTtsModel,
  currentVoiceConversationTtsVoice,
  type AiProviderId,
  getProviderDef,
  getProviderBaseUrl,
  isLocalProvider,
  providerSupportsReplyTts,
  voiceConversationAiProvider,
} from '$lib/stores/settings';
import { getProviderApiKeyLocal } from '$lib/services/ai-keychain';

let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;
// Resolver for the chunk currently playing, so stopSpeaking() can unblock the
// pipeline's `await playBytes(...)` immediately instead of waiting for `onended`
// (which never fires once we pause the element).
let currentPlaybackDone: (() => void) | null = null;
// Bumped on every speak()/stopSpeaking() call; the pipeline checks it to bail
// out of an in-flight run that has been superseded or cancelled.
let speakToken = 0;

export interface SpeakOptions {
  provider?: AiProviderId;
  model?: string;
  voice?: string;
}

type TtsAudioPayload = {
  bytes: number[];
  mime_type: string;
};

function cleanup() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.onended = null;
    currentAudio.onerror = null;
    currentAudio.src = '';
    currentAudio = null;
  }
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  // Pausing never fires `onended`, so settle the awaiting playback ourselves.
  if (currentPlaybackDone) {
    const done = currentPlaybackDone;
    currentPlaybackDone = null;
    done();
  }
}

export function stopSpeaking() {
  speakToken++;
  cleanup();
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  return 'Unknown voice response error.';
}

export function describeTtsError(error: unknown): string {
  const message = extractErrorMessage(error);
  const lowerMessage = message.toLowerCase();
  const trimVoiceModeSuffix = (value: string) => {
    const normalized = value.replace(' to use voice mode.', '.');
    return normalized.endsWith('.') ? normalized : `${normalized}.`;
  };

  if (lowerMessage.endsWith('api key is missing. add it in settings to use voice mode.')) {
    return `Voice response failed: ${trimVoiceModeSuffix(message)}`;
  }
  if (lowerMessage.endsWith('server url is missing. add it in settings to use voice mode.')) {
    return `Voice response failed: ${trimVoiceModeSuffix(message)}`;
  }
  if (message === 'Invalid voice id') {
    return 'Voice response failed: the selected voice is invalid.';
  }
  if (message === 'Invalid TTS model id') {
    return 'Voice response failed: the selected speech model is invalid.';
  }
  if (message === 'Audio playback failed') {
    return 'Voice response failed: audio playback failed.';
  }
  if (lowerMessage.includes('requires terms acceptance')) {
    return 'Voice response failed: your Groq org must accept the Orpheus TTS model terms in the Groq console.';
  }

  return `Voice response failed: ${message}`.slice(0, 220);
}

function resolveTtsConfig(options?: SpeakOptions) {
  const provider = options?.provider ?? get(voiceConversationAiProvider);
  const providerDef = getProviderDef(provider);
  const model = options?.model ?? get(currentVoiceConversationTtsModel);
  const voice = options?.voice ?? get(currentVoiceConversationTtsVoice);
  const local = isLocalProvider(provider);
  const apiKey = getProviderApiKeyLocal(provider) ?? '';
  const baseUrl = local ? getProviderBaseUrl(provider) : '';
  return {
    provider,
    providerDef,
    model,
    voice,
    local,
    apiKey,
    baseUrl,
  };
}

export function getVoiceReplyConfigError(options?: SpeakOptions): string | null {
  const { provider, providerDef, local, apiKey, baseUrl } = resolveTtsConfig(options);
  if (!providerSupportsReplyTts(provider)) {
    return `${providerDef.label} does not support spoken replies in Soryq yet. Choose OpenRouter, Groq, OpenAI, Google, or a local provider with an OpenAI-compatible speech endpoint.`;
  }
  if (local ? !baseUrl : !apiKey) {
    const kind = local ? 'server URL' : 'API key';
    return `${providerDef.label} ${kind} is missing. Add it in Settings to use voice mode.`;
  }
  return null;
}

/**
 * Break a reply into speakable chunks. The first chunk is kept to a single
 * sentence (small character cap) so the very first audio is synthesised and
 * starts playing as soon as possible; later sentences are coalesced into larger
 * chunks to keep prosody natural and limit the number of TTS round-trips.
 */
function splitIntoChunks(text: string): string[] {
  const sentences = (text.match(/\S[^.!?]*[.!?]+|\S[^.!?]*$/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) {
    const trimmed = text.trim();
    return trimmed ? [trimmed] : [];
  }

  const FIRST_CHUNK_MAX = 140;
  const REST_CHUNK_MAX = 280;
  const chunks: string[] = [];
  let buf = '';
  for (const sentence of sentences) {
    const cap = chunks.length === 0 ? FIRST_CHUNK_MAX : REST_CHUNK_MAX;
    if (!buf) {
      buf = sentence;
    } else if (buf.length + 1 + sentence.length <= cap) {
      buf = `${buf} ${sentence}`;
    } else {
      chunks.push(buf);
      buf = sentence;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function releaseAudio(audio: HTMLAudioElement, url: string) {
  audio.onended = null;
  audio.onerror = null;
  if (currentAudio === audio) currentAudio = null;
  if (currentObjectUrl === url) currentObjectUrl = null;
  URL.revokeObjectURL(url);
}

/** Play one already-synthesised chunk to completion. */
function playBytes(payload: TtsAudioPayload, token: number): Promise<void> {
  const blob = new Blob([new Uint8Array(payload.bytes)], { type: payload.mime_type || 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  currentAudio = audio;
  currentObjectUrl = url;

  return new Promise<void>((resolve, reject) => {
    // Cancellation (stopSpeaking) resolves through cleanup() via currentPlaybackDone.
    currentPlaybackDone = resolve;
    const settle = (fn: () => void) => {
      if (currentPlaybackDone === resolve) currentPlaybackDone = null;
      releaseAudio(audio, url);
      fn();
    };
    audio.onended = () => settle(resolve);
    audio.onerror = () =>
      settle(() => (token === speakToken ? reject(new Error('Audio playback failed')) : resolve()));
    audio.play().catch((err) => settle(() => (token === speakToken ? reject(err) : resolve())));
  });
}

export async function speak(text: string, options?: SpeakOptions): Promise<void> {
  cleanup();

  const configError = getVoiceReplyConfigError(options);
  if (configError) {
    throw new Error(configError);
  }

  const chunks = splitIntoChunks(text);
  if (chunks.length === 0) return;

  const { provider, model, voice, apiKey, baseUrl } = resolveTtsConfig(options);
  const token = ++speakToken;

  const generate = (chunk: string) =>
    invoke<TtsAudioPayload>('tts_speak', {
      text: chunk,
      provider,
      model,
      voice,
      apiKey,
      baseUrl: baseUrl || undefined,
    });

  // Pipeline: synthesise the next chunk while the current one is playing so the
  // model's generation latency overlaps playback instead of stacking before it.
  let nextGen: Promise<TtsAudioPayload> | null = generate(chunks[0]);
  try {
    for (let i = 0; i < chunks.length; i++) {
      const payload = await nextGen!;
      if (token !== speakToken) return; // superseded or stopped
      nextGen = i + 1 < chunks.length ? generate(chunks[i + 1]) : null;
      if (payload.bytes.length) {
        await playBytes(payload, token);
        if (token !== speakToken) return;
      }
    }
  } finally {
    // Swallow errors from an abandoned prefetch so a cancelled run never surfaces
    // an unhandled rejection.
    if (nextGen) nextGen.catch(() => {});
  }
}

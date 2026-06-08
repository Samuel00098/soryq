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
}

export function stopSpeaking() {
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

export async function speak(text: string, options?: SpeakOptions): Promise<void> {
  cleanup();

  const configError = getVoiceReplyConfigError(options);
  if (configError) {
    throw new Error(configError);
  }

  const { provider, model, voice, apiKey, baseUrl } = resolveTtsConfig(options);

  const payload = await invoke<TtsAudioPayload>('tts_speak', {
    text,
    provider,
    model,
    voice,
    apiKey,
    baseUrl: baseUrl || undefined,
  });
  if (!payload.bytes.length) return;

  const blob = new Blob([new Uint8Array(payload.bytes)], { type: payload.mime_type || 'audio/wav' });
  const url = URL.createObjectURL(blob);
  currentObjectUrl = url;

  const audio = new Audio(url);
  currentAudio = audio;

  return new Promise<void>((resolve, reject) => {
    audio.onended = () => { cleanup(); resolve(); };
    audio.onerror = () => { cleanup(); reject(new Error('Audio playback failed')); };
    audio.play().catch((err) => { cleanup(); reject(err); });
  });
}

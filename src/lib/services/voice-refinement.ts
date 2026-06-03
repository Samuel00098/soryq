import { invoke } from '@tauri-apps/api/core';
import {
  voiceRefinementEnabled,
  aiProvider,
  currentAiModel,
  getProviderDef,
  isLocalProvider,
  getProviderBaseUrl,
} from '$lib/stores/settings';
import { refineVoiceTranscript } from '$lib/services/voice-input';
import { get } from 'svelte/store';
import { getProviderApiKeyLocal } from '$lib/services/ai-keychain';

function normalizeModelOutput(text: string, preserveNewLines: boolean) {
  const trimmed = text.trim();
  if (!trimmed) return '';

  const fenced = trimmed.match(/^```(?:text|markdown)?\s*([\s\S]*?)\s*```$/i);
  const unwrapped = fenced?.[1]?.trim() ?? trimmed;

  const locallyCleaned = refineVoiceTranscript(unwrapped, { allowNewLines: preserveNewLines });
  return locallyCleaned || unwrapped;
}

function getPreserveNewLines(rawText: string) {
  return rawText.includes('\n');
}

async function requestRefinement(provider: string, model: string, apiKey: string, baseUrl: string, cleanedText: string) {
  return invoke<string>('ai_refine_prompt', {
    text: cleanedText,
    provider,
    model,
    apiKey,
    baseUrl: baseUrl || undefined,
  });
}

export type RefinementResult = { text: string; aiRefined: boolean };

export async function refineVoicePrompt(rawText: string): Promise<RefinementResult> {
  const preserveNewLines = getPreserveNewLines(rawText);
  const locallyCleaned = refineVoiceTranscript(rawText, { allowNewLines: preserveNewLines });

  if (!locallyCleaned) return { text: '', aiRefined: false };
  if (!get(voiceRefinementEnabled)) {
    return { text: locallyCleaned, aiRefined: false };
  }

  const provider = get(aiProvider);
  const local = isLocalProvider(provider);
  const apiKey = getProviderApiKeyLocal(provider) ?? '';
  const baseUrl = local ? getProviderBaseUrl(provider) : '';

  // Not configured for the selected provider (no key for cloud, no server URL
  // for local) — fall back to local cleanup silently.
  if (local ? !baseUrl : !apiKey) {
    return { text: locallyCleaned, aiRefined: false };
  }

  const def = getProviderDef(provider);
  const primaryModel = get(currentAiModel);
  // Try the chosen model first, then the rest of the same provider's models
  // (they share the same key). We never silently jump to another provider.
  const modelsToTry = [primaryModel, ...def.models.map((m) => m.id).filter((id) => id !== primaryModel)];

  for (const model of modelsToTry) {
    try {
      const remoteText = await requestRefinement(provider, model, apiKey, baseUrl, locallyCleaned);
      const normalized = normalizeModelOutput(remoteText, preserveNewLines);
      if (normalized) {
        return { text: normalized, aiRefined: true };
      }
    } catch (error) {
      const message = String(error ?? '');
      if (message.includes('API key is not set')) {
        return { text: locallyCleaned, aiRefined: false };
      }
      console.warn(`Voice refinement failed with ${provider}/${model}:`, error);
    }
  }

  return { text: locallyCleaned, aiRefined: false };
}

import { invoke } from '@tauri-apps/api/core';
import { voiceRefinementEnabled, voiceRefinementModel, type VoiceRefinementModelId } from '$lib/stores/settings';
import { refineVoiceTranscript } from '$lib/services/voice-input';
import { get } from 'svelte/store';
import { getOpenRouterApiKeyLocal } from '$lib/services/openrouter-keychain';

const FALLBACK_MODELS: VoiceRefinementModelId[] = [
  'google/gemini-2.5-flash',
  'google/gemini-2.5-flash-lite',
  'anthropic/claude-haiku-4.5',
  'anthropic/claude-3.5-haiku',
  'qwen/qwen3-30b-a3b-instruct-2507',
  'qwen/qwen-2.5-7b-instruct',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'anthropic/claude-sonnet-4.5',
];

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

async function requestOpenRouterRefinement(model: VoiceRefinementModelId, cleanedText: string) {
  const apiKey = getOpenRouterApiKeyLocal() ?? '';
  return invoke<string>('openrouter_refine_prompt', {
    text: cleanedText,
    model,
    apiKey,
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

  const primaryModel = get(voiceRefinementModel);
  const modelsToTry = [primaryModel, ...FALLBACK_MODELS.filter((model) => model !== primaryModel)];

  for (const model of modelsToTry) {
    try {
      const remoteText = await requestOpenRouterRefinement(model, locallyCleaned);
      const normalized = normalizeModelOutput(remoteText, preserveNewLines);
      if (normalized) {
        return { text: normalized, aiRefined: true };
      }
    } catch (error) {
      const message = String(error ?? '');
      if (message.includes('OpenRouter API key is not set')) {
        return { text: locallyCleaned, aiRefined: false };
      }
      console.warn(`Voice refinement failed with ${model}:`, error);
    }
  }

  return { text: locallyCleaned, aiRefined: false };
}

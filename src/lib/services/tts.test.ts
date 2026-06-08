import { describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
const getProviderApiKeyLocal = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('$lib/services/ai-keychain', () => ({ getProviderApiKeyLocal }));

import { voiceConversationAiProvider } from '$lib/stores/settings';
import { describeTtsError, getVoiceReplyConfigError } from './tts';

describe('describeTtsError', () => {
  it('gives a specific message for a missing provider key', () => {
    expect(describeTtsError(new Error('OpenAI API key is missing. Add it in Settings to use voice mode.'))).toBe(
      'Voice response failed: OpenAI API key is missing. Add it in Settings.'
    );
  });

  it('passes through backend TTS errors', () => {
    expect(describeTtsError(new Error('Groq TTS failed (401 Unauthorized): invalid_api_key'))).toBe(
      'Voice response failed: Groq TTS failed (401 Unauthorized): invalid_api_key'
    );
  });

  it('maps Groq model terms errors to an actionable message', () => {
    expect(
      describeTtsError(
        new Error(
          'Groq TTS failed (400 Bad Request): {"error":{"message":"The model `canopylabs/orpheus-v1-english` requires terms acceptance."}}'
        )
      )
    ).toBe(
      'Voice response failed: your Groq org must accept the Orpheus TTS model terms in the Groq console.'
    );
  });

  it('maps playback failures cleanly', () => {
    expect(describeTtsError(new Error('Audio playback failed'))).toBe(
      'Voice response failed: audio playback failed.'
    );
  });

  it('maps invalid model ids cleanly', () => {
    expect(describeTtsError(new Error('Invalid TTS model id'))).toBe(
      'Voice response failed: the selected speech model is invalid.'
    );
  });
});

describe('getVoiceReplyConfigError', () => {
  it('reports missing keys for the selected reply provider', () => {
    voiceConversationAiProvider.set('google');
    getProviderApiKeyLocal.mockReturnValue(null);

    expect(getVoiceReplyConfigError()).toBe(
      'Google Gemini API key is missing. Add it in Settings to use voice mode.'
    );
  });

  it('allows configured reply providers', () => {
    voiceConversationAiProvider.set('google');
    getProviderApiKeyLocal.mockReturnValue('AIza-test');

    expect(getVoiceReplyConfigError()).toBeNull();
  });
});

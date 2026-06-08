import { beforeEach, describe, expect, it, vi } from 'vitest';

const providerApiKeyExists = vi.hoisted(() => vi.fn());
const listProviderModels = vi.hoisted(() => vi.fn());
const getProviderBaseUrl = vi.hoisted(() => vi.fn((provider: string) => {
  if (provider === 'ollama') return 'http://localhost:11434/v1';
  if (provider === 'lmstudio') return 'http://localhost:1234/v1';
  return '';
}));

vi.mock('$lib/services/ai-keychain', () => ({
  providerApiKeyExists,
  listProviderModels,
}));

vi.mock('$lib/stores/settings', () => ({
  aiProviders: [
    { id: 'openrouter', label: 'OpenRouter', local: false },
    { id: 'groq', label: 'Groq', local: false },
    { id: 'ollama', label: 'Ollama', local: true },
    { id: 'lmstudio', label: 'LM Studio', local: true },
  ],
  getProviderBaseUrl,
}));

import { detectAgentAccess, getAgentAccessBlockedMessage } from './agent-access';

describe('detectAgentAccess', () => {
  beforeEach(() => {
    providerApiKeyExists.mockReset().mockResolvedValue(false);
    listProviderModels.mockReset().mockResolvedValue([]);
    getProviderBaseUrl.mockClear();
  });

  it('unlocks access when any remote provider has an API key', async () => {
    providerApiKeyExists.mockImplementation(async (provider: string) => provider === 'groq');

    await expect(detectAgentAccess()).resolves.toMatchObject({
      ready: true,
      via: 'api-key',
      providerId: 'groq',
    });
    expect(listProviderModels).not.toHaveBeenCalled();
  });

  it('unlocks access when a local provider has a detected model', async () => {
    listProviderModels.mockImplementation(async (provider: string) => (
      provider === 'ollama' ? [{ id: 'qwen2.5-coder' }] : []
    ));

    await expect(detectAgentAccess()).resolves.toMatchObject({
      ready: true,
      via: 'local-model',
      providerId: 'ollama',
    });
  });

  it('stays blocked when neither an API key nor a local model is available', async () => {
    await expect(detectAgentAccess()).resolves.toEqual({
      ready: false,
      via: 'none',
      providerId: null,
      message: getAgentAccessBlockedMessage(),
    });
  });
});

import { invoke } from '@tauri-apps/api/core';
import { isLocalProvider, getProviderBaseUrl, type AiProviderId } from '$lib/stores/settings';

// Per-provider API keys live in localStorage (primary, reliable) and are
// mirrored best-effort into the OS keychain. localStorage is the source of
// truth the app actually reads from.
function localStorageKey(provider: AiProviderId): string {
  return `soryq_${provider}_api_key`;
}

// The OpenRouter key predates multi-provider support; migrate the old name.
const LEGACY_OPENROUTER_KEY = 'forge_openrouter_api_key';

async function safeInvoke<T>(command: string, payload?: Record<string, unknown>) {
  try {
    return await invoke<T>(command, payload);
  } catch (error) {
    console.warn(`Keychain command failed: ${command}`, error);
    throw error;
  }
}

/** Read a provider's key from localStorage (primary storage). */
export function getProviderApiKeyLocal(provider: AiProviderId): string | null {
  if (typeof localStorage === 'undefined') return null;

  if (provider === 'openrouter') {
    const legacy = localStorage.getItem(LEGACY_OPENROUTER_KEY);
    if (legacy && legacy.trim()) {
      localStorage.setItem(localStorageKey('openrouter'), legacy.trim());
      localStorage.removeItem(LEGACY_OPENROUTER_KEY);
    }
  }

  const val = localStorage.getItem(localStorageKey(provider));
  return val && val.trim() ? val.trim() : null;
}

/** True if a key exists in localStorage (primary) or the OS keychain (fallback). */
export async function providerApiKeyExists(provider: AiProviderId): Promise<boolean> {
  if (getProviderApiKeyLocal(provider)) return true;
  try {
    return await safeInvoke<boolean>('provider_api_key_exists', { provider });
  } catch {
    return false;
  }
}

/** Save to localStorage (primary) and best-effort to the OS keychain. */
export async function saveProviderApiKey(provider: AiProviderId, apiKey: string): Promise<void> {
  const normalized = apiKey.trim();

  if (!normalized) {
    await clearProviderApiKey(provider);
    return;
  }

  localStorage.setItem(localStorageKey(provider), normalized);

  try {
    await safeInvoke('provider_api_key_set', { provider, apiKey: normalized });
  } catch {
    // Keychain failure is non-fatal; localStorage is the source of truth.
  }
}

/** A model offered by a provider, as returned by the backend list command. */
export interface ProviderModelInfo {
  id: string;
  label: string;
  description: string;
}

/**
 * Ask the backend to fetch the live model catalogue for a provider using its
 * stored key. Throws if no key is configured or the provider rejects the call.
 */
export async function listProviderModels(provider: AiProviderId): Promise<ProviderModelInfo[]> {
  // Local providers list models from their server URL with no API key.
  if (isLocalProvider(provider)) {
    const baseUrl = getProviderBaseUrl(provider);
    if (!baseUrl) throw new Error('No server URL configured for this provider.');
    return await safeInvoke<ProviderModelInfo[]>('list_provider_models', { provider, apiKey: '', baseUrl });
  }
  const apiKey = getProviderApiKeyLocal(provider);
  if (!apiKey) throw new Error('No API key configured for this provider.');
  return await safeInvoke<ProviderModelInfo[]>('list_provider_models', { provider, apiKey });
}

/** Clear from both localStorage and the OS keychain. */
export async function clearProviderApiKey(provider: AiProviderId): Promise<void> {
  localStorage.removeItem(localStorageKey(provider));
  if (provider === 'openrouter') localStorage.removeItem(LEGACY_OPENROUTER_KEY);
  try {
    await safeInvoke('provider_api_key_delete', { provider });
  } catch {
    // Non-fatal if keychain clear fails.
  }
}

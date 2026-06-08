import { invoke } from '@tauri-apps/api/core';
import { isLocalProvider, getProviderBaseUrl, type AiProviderId } from '$lib/stores/settings';

const KNOWN_PROVIDERS: AiProviderId[] = [
  'openrouter', 'anthropic', 'openai', 'google', 'groq', 'ollama', 'lmstudio',
];

// In-memory key cache backed by the OS keychain.
// Reads are synchronous (Map lookup). Keychain I/O only happens at init and on writes.
const keyCache = new Map<AiProviderId, string | null>();
let cacheReady = false;

/**
 * Call once at app startup. Migrates any leftover localStorage keys to the OS
 * keychain, then populates the in-memory cache from the keychain. All
 * subsequent key reads hit the cache and are synchronous.
 */
export async function initApiKeyCache(): Promise<void> {
  await migrateLocalStorageToKeychain();

  for (const provider of KNOWN_PROVIDERS) {
    try {
      const key = await invoke<string | null>('provider_api_key_get', { provider });
      keyCache.set(provider, key && key.trim() ? key.trim() : null);
    } catch {
      keyCache.set(provider, null);
    }
  }

  cacheReady = true;
}

async function migrateLocalStorageToKeychain(): Promise<void> {
  if (typeof localStorage === 'undefined') return;

  // Handle the legacy OpenRouter key name from before multi-provider support.
  const LEGACY_OPENROUTER_KEY = 'forge_openrouter_api_key';
  const legacyOrKey = localStorage.getItem(LEGACY_OPENROUTER_KEY);
  if (legacyOrKey && legacyOrKey.trim()) {
    localStorage.setItem('soryq_openrouter_api_key', legacyOrKey.trim());
    localStorage.removeItem(LEGACY_OPENROUTER_KEY);
  }

  for (const provider of KNOWN_PROVIDERS) {
    const lsKey = `soryq_${provider}_api_key`;
    const value = localStorage.getItem(lsKey);
    if (!value || !value.trim()) continue;
    try {
      await invoke('provider_api_key_set', { provider, apiKey: value.trim() });
      localStorage.removeItem(lsKey);
    } catch {
      // Migration failed for this provider — leave it in localStorage and retry next launch.
    }
  }
}

async function safeInvoke<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, payload);
  } catch (error) {
    console.warn(`Keychain command failed: ${command}`, error);
    throw error;
  }
}

/** Synchronous read from the in-memory cache. Returns null if not configured. */
export function getProviderApiKeyLocal(provider: AiProviderId): string | null {
  return keyCache.get(provider) ?? null;
}

/** True if a key exists in the cache (or the keychain if the cache is not yet ready). */
export async function providerApiKeyExists(provider: AiProviderId): Promise<boolean> {
  if (cacheReady) return !!keyCache.get(provider);
  try {
    return await safeInvoke<boolean>('provider_api_key_exists', { provider });
  } catch {
    return false;
  }
}

/** Persist to the OS keychain and update the cache. */
export async function saveProviderApiKey(provider: AiProviderId, apiKey: string): Promise<void> {
  const normalized = apiKey.trim();
  if (!normalized) {
    await clearProviderApiKey(provider);
    return;
  }
  await safeInvoke('provider_api_key_set', { provider, apiKey: normalized });
  keyCache.set(provider, normalized);
}

/** Remove from the OS keychain and update the cache. */
export async function clearProviderApiKey(provider: AiProviderId): Promise<void> {
  await safeInvoke('provider_api_key_delete', { provider });
  keyCache.set(provider, null);
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
  if (isLocalProvider(provider)) {
    const baseUrl = getProviderBaseUrl(provider);
    if (!baseUrl) throw new Error('No server URL configured for this provider.');
    return await safeInvoke<ProviderModelInfo[]>('list_provider_models', { provider, apiKey: '', baseUrl });
  }
  const apiKey = getProviderApiKeyLocal(provider);
  if (!apiKey) throw new Error('No API key configured for this provider.');
  return await safeInvoke<ProviderModelInfo[]>('list_provider_models', { provider, apiKey });
}

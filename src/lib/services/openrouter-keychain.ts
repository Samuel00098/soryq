import { invoke } from '@tauri-apps/api/core';

const LOCAL_STORAGE_KEY = 'soryq_openrouter_api_key';
const LEGACY_KEY = 'forge_openrouter_api_key';

async function safeInvoke<T>(command: string, payload?: Record<string, unknown>) {
  try {
    return await invoke<T>(command, payload);
  } catch (error) {
    console.warn(`OpenRouter keychain command failed: ${command}`, error);
    throw error;
  }
}

// Read the key from localStorage — this is the primary, reliable storage.
// Migrates automatically from the old 'forge_' key name on first read.
export function getOpenRouterApiKeyLocal(): string | null {
  if (typeof localStorage === 'undefined') return null;
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy && legacy.trim()) {
    localStorage.setItem(LOCAL_STORAGE_KEY, legacy.trim());
    localStorage.removeItem(LEGACY_KEY);
  }
  const val = localStorage.getItem(LOCAL_STORAGE_KEY);
  return val && val.trim() ? val.trim() : null;
}

// Returns true if the key exists in localStorage (primary) or OS keychain (fallback).
export async function openRouterApiKeyExists(): Promise<boolean> {
  if (getOpenRouterApiKeyLocal()) return true;
  try {
    return await safeInvoke<boolean>('openrouter_api_key_exists');
  } catch {
    return false;
  }
}

// Saves to localStorage (primary) and best-effort to the OS keychain.
export async function saveOpenRouterApiKey(apiKey: string): Promise<void> {
  const normalized = apiKey.trim();

  if (!normalized) {
    await clearOpenRouterApiKey();
    return;
  }

  // Write to localStorage first — this is what the app will actually use.
  localStorage.setItem(LOCAL_STORAGE_KEY, normalized);

  // Best-effort keychain save (extra security layer; non-fatal if it fails).
  try {
    await safeInvoke('openrouter_api_key_set', { apiKey: normalized });
  } catch {
    // Keychain failure is non-fatal; localStorage is the source of truth.
  }
}

// Clears from both localStorage and the OS keychain.
export async function clearOpenRouterApiKey(): Promise<void> {
  localStorage.removeItem(LOCAL_STORAGE_KEY);
  localStorage.removeItem(LEGACY_KEY);
  try {
    await safeInvoke('openrouter_api_key_delete');
  } catch {
    // Non-fatal if keychain clear fails.
  }
}

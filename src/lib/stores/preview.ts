import { writable, get } from 'svelte/store';
import { showToast } from './notification';

export const targetPort = writable<number>(5173);
export const proxyPort = writable<number | null>(null);
export const proxyStarted = writable<boolean>(false);
export const currentUrl = writable<string>('/');
export const isConnecting = writable<boolean>(false);

export async function ensureProxyRunning(): Promise<number | null> {
  const currentPort = get(proxyPort);
  if (currentPort) return currentPort;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const port = await invoke<number>('preview_start_proxy');
    proxyPort.set(port);
    return port;
  } catch (err) {
    console.error('Failed to ensure proxy is running:', err);
    return null;
  }
}

export async function loadProxyState() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const activeProxyPort = await invoke<number | null>('preview_get_proxy_port');
    const activeTargetPort = await invoke<number>('preview_get_target_port');
    
    targetPort.set(activeTargetPort);
    if (activeProxyPort) {
      proxyPort.set(activeProxyPort);
    } else {
      proxyPort.set(null);
    }
  } catch (err) {
    console.error('Failed to load proxy state:', err);
  }
}

export async function startProxy() {
  if (get(proxyStarted)) return;
  if (get(isConnecting)) return;
  isConnecting.set(true);
  try {
    const port = await ensureProxyRunning();
    if (port) {
      proxyStarted.set(true);
      showToast(`Dev server connection started`, 'success');
    }
  } catch (err: any) {
    console.error('Failed to start dev connection:', err);
    showToast(`Failed to start dev connection: ${err?.message || err}`, 'error');
  } finally {
    isConnecting.set(false);
  }
}

export async function stopProxy() {
  // We do not stop the background proxy server, so that external websites still work.
  // We just mark the dev server connection as stopped/inactive.
  proxyStarted.set(false);
  showToast('Dev server connection stopped', 'info');
}

export async function setTargetPort(port: number) {
  if (get(targetPort) === port) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('preview_set_target_port', { port });
    targetPort.set(port);
    showToast(`Target dev port updated to ${port}`, 'info');
  } catch (err: any) {
    console.error('Failed to set target port:', err);
    showToast(`Failed to update target port: ${err?.message || err}`, 'error');
  }
}

export async function clearProxyTarget() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('preview_clear_proxy_target');
  } catch (err) {
    console.error('Failed to clear proxy target:', err);
  }
}


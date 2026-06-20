import { writable, get } from '$lib/stores/storeCompat';
import { loadJson } from '$lib/utils/storage';
import { invoke } from '@tauri-apps/api/core';
import { activeProjectId } from '$lib/stores/workspace';

// Pull the active project's env vault and expand `{{VAR}}` placeholders in a
// request. Unknown placeholders are left intact so a typo is visible rather
// than silently blanked.
async function loadEnvVars(): Promise<Record<string, string>> {
  const pid = get(activeProjectId);
  if (!pid) return {};
  try {
    const vars = await invoke<{ key: string; value: string }[]>('env_vault_get', { projectId: pid });
    return Object.fromEntries(vars.map((v) => [v.key, v.value]));
  } catch {
    return {};
  }
}

function expandVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : `{{${k}}}`
  );
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type BodyType = 'none' | 'json' | 'text' | 'form';

export interface HttpHeader { key: string; value: string; enabled: boolean; }

export interface HttpRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: HttpHeader[];
  body: string;
  bodyType: BodyType;
  projectId: string;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
  size: number;
  ok: boolean;
}

const STORAGE_KEY = 'soryq_http_requests';

// Header keys whose values are masked before writing to localStorage.
// In-memory values stay intact; only the persisted copy is masked so tokens
// don't survive across app restarts.
const SENSITIVE_HEADER_RE = /^(authorization|x-api-key|x-auth-token|x-amz-security-token|cookie|set-cookie|proxy-authorization)$/i;

function maskSensitiveHeaders(requests: HttpRequest[]): HttpRequest[] {
  return requests.map((r) => ({
    ...r,
    headers: r.headers.map((h) =>
      SENSITIVE_HEADER_RE.test(h.key.trim()) && h.value.trim()
        ? { ...h, value: '' }
        : h
    ),
  }));
}

function load(): HttpRequest[] {
  return loadJson(STORAGE_KEY, [] as HttpRequest[]);
}

export const savedRequests = writable<HttpRequest[]>(load());
let _httpFlushTimer: ReturnType<typeof setTimeout> | null = null;
let _httpLatest: HttpRequest[] = [];
savedRequests.subscribe((v) => {
  _httpLatest = v; // always track latest value so the timer flush uses it, not a stale closure
  if (_httpFlushTimer !== null) return;
  _httpFlushTimer = setTimeout(() => {
    _httpFlushTimer = null;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(maskSensitiveHeaders(_httpLatest))); } catch {}
  }, 300);
});

export const activeRequestId = writable<string | null>(null);
export const httpResponse = writable<HttpResponse | null>(null);
export const httpLoading = writable(false);
export const httpError = writable<string | null>(null);

function makeId() { return `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

export function createRequest(projectId: string): HttpRequest {
  const req: HttpRequest = {
    id: makeId(), name: 'New Request', method: 'GET', url: '',
    headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    body: '', bodyType: 'none', projectId,
  };
  savedRequests.update((all) => [...all, req]);
  activeRequestId.set(req.id);
  return req;
}

export function deleteRequest(id: string) {
  savedRequests.update((all) => all.filter((r) => r.id !== id));
  activeRequestId.update((cur) => (cur === id ? null : cur));
  httpResponse.set(null);
}

export function updateRequest(id: string, patch: Partial<HttpRequest>) {
  savedRequests.update((all) => all.map((r) => r.id === id ? { ...r, ...patch } : r));
}

export function duplicateRequest(id: string) {
  const all = get(savedRequests);
  const orig = all.find((r) => r.id === id);
  if (!orig) return;
  const copy = { ...orig, id: makeId(), name: `${orig.name} (copy)` };
  savedRequests.update((a) => [...a, copy]);
  activeRequestId.set(copy.id);
}

function isPrivateUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    if (hostname === 'localhost') return true;
    // IPv6 link-local (fe80::/10) and loopback (::1)
    if (hostname === '::1' || hostname.toLowerCase().startsWith('fe80:')) return true;
    const parts = hostname.split('.').map(Number);
    if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
      const [a, b] = parts;
      return (
        a === 127 ||
        a === 10 ||
        a === 0 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254)
      );
    }
    return false;
  } catch {
    return false;
  }
}

export async function sendRequest(req: HttpRequest): Promise<void> {
  httpLoading.set(true);
  httpResponse.set(null);
  httpError.set(null);
  const start = Date.now();
  try {
    const env = await loadEnvVars();
    let url = expandVars(req.url.trim(), env);
    if (!url) throw new Error('URL is required');
    if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;

    if (isPrivateUrl(url)) {
      const proceed = window.confirm(
        `This request targets a local/private address (${new URL(url).hostname}).\n\nSending requests to internal services can expose sensitive data. Continue?`
      );
      if (!proceed) { httpLoading.set(false); return; }
    }

    const headers: Record<string, string> = {};
    for (const h of req.headers) {
      if (h.enabled && h.key.trim()) headers[expandVars(h.key.trim(), env)] = expandVars(h.value, env);
    }
    if (req.bodyType === 'json' && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

    let requestBody: string | null = null;
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.bodyType !== 'none' && req.body) {
      requestBody = expandVars(req.body, env);
    }

    const response = await invoke<HttpResponse>('http_send_request', {
      method: req.method,
      url,
      headers,
      body: requestBody,
    });

    httpResponse.set(response);
  } catch (e: any) {
    httpError.set(e.message || 'Request failed');
  } finally {
    httpLoading.set(false);
  }
}

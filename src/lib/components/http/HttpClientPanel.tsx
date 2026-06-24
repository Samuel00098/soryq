import { useMemo, useState } from 'react';
import {
  savedRequests, activeRequestId, httpResponse, httpLoading, httpError,
  createRequest, deleteRequest, updateRequest, duplicateRequest, sendRequest,
  type HttpRequest, type HttpMethod, type BodyType,
} from '$lib/stores/http';
import { activeProject } from '$lib/stores/workspace';
import { useStore } from '$lib/react/useStore';

import Dropdown, { type DropdownOption } from '$lib/components/shared/Dropdown.tsx';
import './HttpClientPanel.css';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: '#4ade80', POST: '#f97316', PUT: '#facc15', PATCH: '#a78bfa',
  DELETE: '#f87171', HEAD: '#60a5fa', OPTIONS: '#94a3b8',
};
const methodOptions: DropdownOption[] = METHODS.map((m) => ({
  value: m,
  label: m,
  color: METHOD_COLORS[m],
}));

const BODY_TYPES: BodyType[] = ['none', 'json', 'text', 'form'];
const REQ_TABS = ['headers', 'body', 'auth'] as const;

const PRIVATE_IP_RE = /^https?:\/\/(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0|localhost|\[::1\]|\[fe80:)/i;
const SENSITIVE_HEADER_RE = /^(authorization|x-api-key|x-auth-token|cookie|proxy-authorization)$/i;

function getStatusClass(status: number) {
  if (status < 300) return 'status-ok';
  if (status < 400) return 'status-redirect';
  if (status < 500) return 'status-client-err';
  return 'status-server-err';
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function HttpClientPanel() {
  const requests = useStore(savedRequests);
  const activeId = useStore(activeRequestId);
  const response = useStore(httpResponse);
  const loading = useStore(httpLoading);
  const error = useStore(httpError);
  const project = useStore(activeProject);

  const [activeTab, setActiveTab] = useState<'params' | 'headers' | 'body' | 'auth'>('headers');
  const [responseTab, setResponseTab] = useState<'body' | 'headers'>('body');
  const [prettyJson, setPrettyJson] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const projectRequests = useMemo(
    () => requests.filter((r) => r.projectId === (project?.id ?? '')),
    [requests, project],
  );

  const activeReq = useMemo(
    () => requests.find((r) => r.id === activeId) ?? null,
    [requests, activeId],
  );

  function patch(p: Partial<HttpRequest>) {
    if (activeReq) updateRequest(activeReq.id, p);
  }

  function addHeader() {
    if (!activeReq) return;
    patch({ headers: [...activeReq.headers, { key: '', value: '', enabled: true }] });
  }

  function updateHeader(i: number, field: 'key' | 'value' | 'enabled', val: any) {
    if (!activeReq) return;
    const headers = activeReq.headers.map((h, idx) => idx === i ? { ...h, [field]: val } : h);
    patch({ headers });
  }

  function removeHeader(i: number) {
    if (!activeReq) return;
    patch({ headers: activeReq.headers.filter((_, idx) => idx !== i) });
  }

  function tryFormatBody() {
    if (!activeReq || activeReq.bodyType !== 'json') return;
    try {
      patch({ body: JSON.stringify(JSON.parse(activeReq.body), null, 2) });
    } catch {}
  }

  function prettyPrintBody(body: string, contentType: string) {
    if (prettyJson && (contentType.includes('json') || body.trimStart().startsWith('{'))) {
      try { return JSON.stringify(JSON.parse(body), null, 2); } catch {}
    }
    return body;
  }

  const ssrfWarning = activeReq ? PRIVATE_IP_RE.test(activeReq.url.trim()) : false;
  const authHeaderWarning = activeReq
    ? activeReq.headers.some((h) => h.enabled && SENSITIVE_HEADER_RE.test(h.key.trim()) && h.value.trim())
    : false;

  return (
    <div className="http-panel">
      {/* Left: request list */}
      <div className="req-sidebar">
        <div className="req-sidebar-header">
          <span className="req-sidebar-title">Requests</span>
          <button className="req-add-btn" onClick={() => createRequest(project?.id ?? '')} title="New request">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
        </div>
        <div className="req-list">
          {projectRequests.map((req) => (
            <div className={`req-item${req.id === activeId ? ' active' : ''}`} key={req.id}>
              <button className="req-item-btn" onClick={() => activeRequestId.set(req.id)}>
                <span className="method-badge" style={{ color: METHOD_COLORS[req.method] }}>{req.method}</span>
                <span className="req-item-name">{req.name || 'Untitled'}</span>
              </button>
              <div className="req-item-actions">
                {deleteConfirm === req.id ? (
                  <>
                    <button className="req-del-yes" onClick={() => { deleteRequest(req.id); setDeleteConfirm(null); }}>Del</button>
                    <button className="req-del-no" onClick={() => setDeleteConfirm(null)}>✕</button>
                  </>
                ) : (
                  <>
                    <button className="req-action-btn" onClick={() => duplicateRequest(req.id)} title="Duplicate">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                    </button>
                    <button className="req-action-btn" onClick={() => setDeleteConfirm(req.id)} title="Delete">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /></svg>
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {projectRequests.length === 0 && (
            <div className="req-empty">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.3">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
              <p>No requests yet.<br />Click + to create one.</p>
            </div>
          )}
        </div>
      </div>

      <div className="req-divider"></div>

      {/* Right: editor + response */}
      <div className="req-main">
        {activeReq ? (
          <>
            {/* Name + URL bar */}
            <div className="req-name-row">
              <input className="req-name-input" type="text" value={activeReq.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Request name…" />
            </div>
            <div className="url-bar">
              <div style={{ width: 100, flexShrink: 0 }}>
                <Dropdown options={methodOptions} value={activeReq.method} onChange={(val) => patch({ method: val as HttpMethod })} ariaLabel="HTTP Method" />
              </div>
              <input className="url-input" type="text" value={activeReq.url} onChange={(e) => patch({ url: e.target.value })} placeholder="https://api.example.com/endpoint" spellCheck={false} />
              <button className="send-btn" onClick={() => sendRequest(activeReq!)} disabled={loading}>
                {loading ? (
                  <svg className="spin-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><polyline points="21 3 21 8 16 8" /></svg>
                ) : (
                  'Send'
                )}
              </button>
            </div>

            {/* Security warnings */}
            {ssrfWarning && (
              <div className="sec-warning">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                Targeting a local/private address — request stays on-device.
              </div>
            )}
            {authHeaderWarning && (
              <div className="sec-warning sec-warning--info">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                Auth header values are cleared from storage when the app closes.
              </div>
            )}

            {/* Request tabs */}
            <div className="req-tabs">
              {REQ_TABS.map((tab) => (
                <button key={tab} className={`req-tab${activeTab === tab ? ' active' : ''}`} onClick={() => setActiveTab(tab)}>
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  {tab === 'headers' && <span className="tab-badge">{activeReq.headers.filter(h => h.enabled && h.key).length}</span>}
                </button>
              ))}
            </div>

            <div className="req-tab-content">
              {activeTab === 'headers' && (
                <div className="headers-table">
                  {activeReq.headers.map((header, i) => (
                    <div className="header-row" key={i}>
                      <input type="checkbox" checked={header.enabled} onChange={(e) => updateHeader(i, 'enabled', e.target.checked)} />
                      <input className="header-key" type="text" value={header.key} onChange={(e) => updateHeader(i, 'key', e.target.value)} placeholder="Header" />
                      <input className="header-val" type="text" value={header.value} onChange={(e) => updateHeader(i, 'value', e.target.value)} placeholder="Value" />
                      <button className="header-del" onClick={() => removeHeader(i)}>✕</button>
                    </div>
                  ))}
                  <button className="add-header-btn" onClick={addHeader}>+ Add Header</button>
                </div>
              )}
              {activeTab === 'body' && (
                <div className="body-section">
                  <div className="body-type-row">
                    {BODY_TYPES.map((bt) => (
                      <label className="body-type-label" key={bt}>
                        <input type="radio" name="bodyType" value={bt} checked={activeReq.bodyType === bt} onChange={() => patch({ bodyType: bt })} />
                        {bt}
                      </label>
                    ))}
                    {activeReq.bodyType === 'json' && (
                      <button className="format-btn" onClick={tryFormatBody}>Format</button>
                    )}
                  </div>
                  {activeReq.bodyType !== 'none' && (
                    <textarea className="body-textarea" value={activeReq.body} onChange={(e) => patch({ body: e.target.value })} placeholder={activeReq.bodyType === 'json' ? '{\n  "key": "value"\n}' : 'Request body…'} spellCheck={false}></textarea>
                  )}
                </div>
              )}
              {activeTab === 'auth' && (
                <div className="auth-section">
                  <p className="auth-hint">Add an Authorization header in the Headers tab (e.g. Bearer token).</p>
                </div>
              )}
            </div>

            {/* Response section */}
            <div className="res-section">
              {error ? (
                <div className="res-error">{error}</div>
              ) : response ? (
                <>
                  <div className="res-header">
                    <span className={`res-status ${getStatusClass(response.status)}`}>{response.status} {response.statusText}</span>
                    <span className="res-meta">{response.duration}ms · {formatSize(response.size)}</span>
                    <div className="res-tabs">
                      <button className={`res-tab${responseTab === 'body' ? ' active' : ''}`} onClick={() => setResponseTab('body')}>Body</button>
                      <button className={`res-tab${responseTab === 'headers' ? ' active' : ''}`} onClick={() => setResponseTab('headers')}>Headers</button>
                    </div>
                    {responseTab === 'body' && (
                      <label className="pretty-toggle">
                        <input type="checkbox" checked={prettyJson} onChange={(e) => setPrettyJson(e.target.checked)} /> Pretty
                      </label>
                    )}
                    <button className="copy-res-btn" onClick={() => navigator.clipboard.writeText(response!.body)} title="Copy response">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                    </button>
                  </div>
                  {responseTab === 'body' ? (
                    <pre className="res-body">{prettyPrintBody(response.body, response.headers['content-type'] ?? '')}</pre>
                  ) : (
                    <div className="res-headers-list">
                      {Object.entries(response.headers).map(([k, v]) => (
                        <div className="res-header-row" key={k}><span className="res-header-key">{k}</span><span className="res-header-val">{v}</span></div>
                      ))}
                    </div>
                  )}
                </>
              ) : !loading ? (
                <div className="res-placeholder">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.25">
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                  </svg>
                  <p>Send a request to see the response</p>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="no-req-selected">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.2">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            <p>Select a request or create a new one</p>
            <button className="create-first-btn" onClick={() => createRequest(project?.id ?? '')}>+ New Request</button>
          </div>
        )}
      </div>
    </div>
  );
}

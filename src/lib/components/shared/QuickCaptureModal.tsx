import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { activeProject } from '$lib/stores/workspace';
import { showToast } from '$lib/stores/notification';
import { useStore } from '$lib/react/useStore';
import './QuickCaptureModal.css';

export default function QuickCaptureModal({ onclose }: { onclose: () => void }) {
  const project = useStore(activeProject);

  const inputEl = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    inputEl.current?.focus();
  }, []);

  async function handleSubmit() {
    const text = value.trim();
    if (!text) {
      onclose();
      return;
    }
    if (saving) return;
    setSaving(true);

    if (!project) {
      showToast('No active project — thought not saved', 'warning');
      onclose();
      return;
    }

    const dir = `${project.root_path}/.soryq`;
    const inboxPath = `${project.root_path}/.soryq/inbox.md`;
    const now = new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const entry = `\n- ${text} *(${now})*`;

    try {
      try {
        await invoke('fs_create_dir', { path: dir });
      } catch {
        /* exists */
      }

      let existing = '';
      try {
        existing = await invoke<string>('fs_read_file', { path: inboxPath });
      } catch {
        existing = '# Inbox\n';
      }

      await invoke('fs_write_file', { path: inboxPath, content: existing + entry });
      showToast('Captured!', 'success');
    } catch {
      showToast('Failed to save — check console', 'error');
    }

    onclose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') onclose();
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onclose();
  }

  return (
    <div
      className="qc-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Quick Capture"
      tabIndex={-1}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="qc-card">
        <div className="qc-header">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          <span>Quick Capture</span>
        </div>

        <input
          className="qc-input"
          type="text"
          placeholder="Capture a thought…"
          ref={inputEl}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={saving}
        />

        <div className="qc-footer">
          <span className="qc-hint">Enter to save · Esc to dismiss</span>
          <span className="qc-dest">.soryq/inbox.md</span>
        </div>
      </div>
    </div>
  );
}

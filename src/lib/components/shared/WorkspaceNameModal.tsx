import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { newWorkspacePromptOpen, createNewWorkspace } from '$lib/stores/workspace';
import './WorkspaceNameModal.css';

export default function WorkspaceNameModal() {
  const [nameInput, setNameInput] = useState('');
  const inputEl = useRef<HTMLInputElement | null>(null);
  const submitted = useRef(false);

  useEffect(() => {
    inputEl.current?.focus();
  }, []);

  function withTransition(action: () => void) {
    const startViewTransition = (document as any).startViewTransition;
    if (startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      startViewTransition.call(document, () => {
        flushSync(action);
      });
    } else {
      action();
    }
  }

  function confirm() {
    if (submitted.current) return;
    submitted.current = true;
    withTransition(() => {
      createNewWorkspace(nameInput.trim() || undefined);
      newWorkspacePromptOpen.set(false);
      setNameInput('');
    });
  }

  function cancel() {
    if (submitted.current) return;
    submitted.current = true;
    withTransition(() => {
      newWorkspacePromptOpen.set(false);
      setNameInput('');
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      confirm();
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      cancel();
    }
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) cancel();
  }

  return (
    <div
      className="backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="New Workspace"
      tabIndex={-1}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="modal">
        <div className="modal-header">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span>New Workspace</span>
        </div>

        <input
          ref={inputEl}
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          className="name-input"
          type="text"
          placeholder="Workspace name…"
          onKeyDown={handleKeyDown}
        />

        <div className="modal-footer">
          <span className="hint">Enter to create · Esc to cancel</span>
        </div>
      </div>
    </div>
  );
}

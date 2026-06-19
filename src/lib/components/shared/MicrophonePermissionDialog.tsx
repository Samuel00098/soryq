import { usePermissionsStore, type PermissionKind } from '$lib/stores/zustand/permissions';
import { flushSync } from 'react-dom';
import './MicrophonePermissionDialog.css';

const LABELS: Record<PermissionKind, { title: string; description: string }> = {
  microphone: {
    title: 'wants to use your microphone',
    description:
      'Required for voice input in the prompt bar. Your audio is processed locally and never stored.',
  },
};

export default function MicrophonePermissionDialog({ onclose }: { onclose?: () => void }) {
  const request = usePermissionsStore((s) => s.pendingPermissionRequest);
  const resolvePermission = usePermissionsStore((s) => s.resolvePermission);
  const info = request ? LABELS[request.kind] ?? LABELS.microphone : LABELS.microphone;

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

  function allow() {
    withTransition(() => {
      resolvePermission(true);
      onclose?.();
    });
  }

  function deny() {
    withTransition(() => {
      resolvePermission(false);
      onclose?.();
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') deny();
    if (e.key === 'Enter') allow();
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) deny();
  }

  return (
    <div
      className="backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Microphone permission request"
      tabIndex={-1}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="dialog">
        <div className="icon-ring">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </div>

        <div className="body">
          <p className="app-name">Soryq</p>
          <h2 className="title">{info.title}</h2>
          <p className="description">{info.description}</p>
        </div>

        <div className="actions">
          <button className="btn-deny" onClick={deny}>
            Don't Allow
          </button>
          <button className="btn-allow" onClick={allow}>
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}

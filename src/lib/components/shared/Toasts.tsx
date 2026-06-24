import { useEffect, useState } from 'react';
import { useNotificationStore, type Toast } from '$lib/stores/zustand/notification';
import './Toasts.css';

const EXIT_MS = 180; // matches the original out:fly duration

interface RenderItem {
  toast: Toast;
  leaving: boolean;
}

function ToastIcon({ type }: { type: Toast['type'] }) {
  if (type === 'success') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (type === 'error') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    );
  }
  if (type === 'warning') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

export default function Toasts() {
  const storeToasts = useNotificationStore((s) => s.toasts);
  const dismissToast = useNotificationStore((s) => s.dismissToast);

  // Mirror the store so a toast removed from it can finish its exit animation
  // (the original version relied on out:fly for this). `leaving` items linger for
  // EXIT_MS, then drop out.
  const [items, setItems] = useState<RenderItem[]>(() =>
    storeToasts.map((toast) => ({ toast, leaving: false })),
  );

  useEffect(() => {
    const storeById = new Map(storeToasts.map((t) => [t.id, t]));

    setItems((prev) => {
      const next: RenderItem[] = [];
      const seen = new Set<string>();

      // Preserve existing order; mark toasts no longer in the store as leaving.
      for (const item of prev) {
        const current = storeById.get(item.toast.id);
        if (current) {
          next.push({ toast: current, leaving: false });
          seen.add(item.toast.id);
        } else if (!item.leaving) {
          next.push({ toast: item.toast, leaving: true });
          const id = item.toast.id;
          setTimeout(() => {
            setItems((cur) => cur.filter((c) => c.toast.id !== id));
          }, EXIT_MS);
        } else {
          next.push(item); // already leaving — keep until its timer removes it
        }
      }

      // Append toasts newly added to the store.
      for (const toast of storeToasts) {
        if (!seen.has(toast.id)) {
          next.push({ toast, leaving: false });
        }
      }

      return next;
    });
  }, [storeToasts]);

  return (
    <div className="toast-container">
      {items.map(({ toast, leaving }) => (
        <div key={toast.id} className={`toast ${toast.type}${leaving ? ' leaving' : ''}`} role="alert">
          <div className="toast-icon">
            <ToastIcon type={toast.type} />
          </div>
          <div className="toast-message">{toast.message}</div>
          {toast.action && (
            <button
              className="toast-action"
              onClick={() => {
                toast.action!.onClick();
                dismissToast(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button
            className="toast-close"
            onClick={() => dismissToast(toast.id)}
            aria-label="Dismiss notification"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

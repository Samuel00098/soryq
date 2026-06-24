import { useState } from 'react';
import { useUpdaterStore } from '$lib/stores/zustand/updater';
import { showToast } from '$lib/stores/notification';
import { openChangelogPage } from '$lib/services/changelog';
import './UpdateBanner.css';

export default function UpdateBanner() {
  const update = useUpdaterStore((s) => s.pendingUpdate);
  const downloading = useUpdaterStore((s) => s.updateDownloading);
  const progress = useUpdaterStore((s) => s.updateProgress);
  const installUpdate = useUpdaterStore((s) => s.installUpdate);

  const [expanded, setExpanded] = useState(false);

  async function viewChangelog() {
    try {
      await openChangelogPage();
    } catch (err) {
      console.error('Failed to open changelog:', err);
      showToast('Could not open the changelog', 'error');
    }
  }

  if (!update) return null;

  return (
    <>
      <div className="update-banner">
        <div className="update-main">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
          <span className="update-msg">
            Soryq <strong>{update.version}</strong> is available
          </span>
          <span className="update-trust">signed release</span>
          {update.body && (
            <button className="update-notes-btn" onClick={() => setExpanded((e) => !e)}>
              {expanded ? 'Hide' : "What's new"}
            </button>
          )}
          <button className="update-notes-btn" onClick={viewChangelog} title="View the full changelog">
            View Changelog
          </button>
        </div>

        <div className="update-actions">
          {downloading ? (
            <>
              <div className="update-progress">
                <div className="update-progress-bar" style={{ width: `${progress}%` }}></div>
              </div>
              <span className="update-pct">{progress}%</span>
            </>
          ) : (
            <button className="update-install-btn" onClick={installUpdate}>
              Install &amp; Restart
            </button>
          )}
        </div>
      </div>

      {expanded && update.body && <div className="update-notes">{update.body}</div>}
    </>
  );
}

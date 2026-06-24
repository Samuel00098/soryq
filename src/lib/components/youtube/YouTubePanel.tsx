import { useEffect, useRef, useState } from 'react';
import { useStore } from '$lib/react/useStore';
import { get } from '$lib/stores/storeCompat';
import {
  youtubeState,
  setApiKey,
  setMode,
  setQuery,
  searchVideos,
  playVideo,
  setPosition,
  goHome,
} from '$lib/stores/youtube';
import { loadYouTubeApi, type YTPlayer } from '$lib/utils/youtubeApi';
import './YouTubePanel.css';

export default function YouTubePanel() {
  const state = useStore(youtubeState);
  const [showSettings, setShowSettings] = useState(false);

  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);

  // While a video is playing, a fresh search drops its results into a dropdown
  // over the player so you can switch without leaving what you're watching.
  const [resultsOpen, setResultsOpen] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await searchVideos(state.query);
    if (get(youtubeState).current) setResultsOpen(true);
  }

  const currentVideoId = state.current?.videoId ?? null;
  const hasPlayer = Boolean(currentVideoId);

  // Build (and tear down) the IFrame API player. Keyed on the video so it only
  // rebuilds when the content actually changes — not on the per-second position
  // updates — which is what keeps playback smooth. On unmount (e.g. an
  // ambient-mode switch) we save the current time so the next mount resumes it.
  useEffect(() => {
    if (!currentVideoId) return;
    const host = playerHostRef.current;
    if (!host) return;

    let cancelled = false;
    let poll: number | null = null;
    // Captured once, at the moment this video mounts — the resume point.
    const startAt = Math.floor(get(youtubeState).position);

    void loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !playerHostRef.current) return;
        const mount = document.createElement('div');
        playerHostRef.current.appendChild(mount);

        playerRef.current = new YT.Player(mount, {
          host: 'https://www.youtube-nocookie.com',
          videoId: currentVideoId,
          playerVars: { autoplay: 1, rel: 0, modestbranding: 1, start: startAt },
        });

        // Sample the position while playing so we always have a fresh resume point.
        poll = window.setInterval(() => {
          const p = playerRef.current;
          if (!p) return;
          try {
            const t = p.getCurrentTime();
            if (typeof t === 'number' && t > 0) setPosition(t);
          } catch {
            /* player not ready yet */
          }
        }, 1000);
      })
      .catch((err) => {
        if (!cancelled) {
          youtubeState.update((s) => ({ ...s, status: String(err) }));
        }
      });

    return () => {
      cancelled = true;
      if (poll !== null) window.clearInterval(poll);
      const p = playerRef.current;
      if (p) {
        try {
          const t = p.getCurrentTime();
          if (typeof t === 'number' && t > 0) setPosition(t);
          p.destroy();
        } catch {
          /* already gone */
        }
      }
      playerRef.current = null;
      // Clear the host (empties the destroyed player's iframe); no untrusted
      // content involved — replaceChildren() with no args just removes children.
      playerHostRef.current?.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVideoId]);

  return (
    <section className="youtube-panel">
      <header className="yt-toolbar">
        <button
          className="yt-icon-btn"
          title="Home (clear)"
          aria-label="Back to blank home"
          onClick={() => goHome()}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3 11.5 12 4l9 7.5" />
            <path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />
          </svg>
        </button>
        <div className="yt-mode" role="tablist" aria-label="Search source">
          <button
            type="button"
            role="tab"
            aria-selected={state.mode === 'video'}
            className={`yt-mode-btn${state.mode === 'video' ? ' active' : ''}`}
            onClick={() => setMode('video')}
            title="Search YouTube videos"
          >
            Video
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={state.mode === 'music'}
            className={`yt-mode-btn${state.mode === 'music' ? ' active' : ''}`}
            onClick={() => setMode('music')}
            title="Search YouTube Music"
          >
            Music
          </button>
        </div>
        <form className="yt-search" onSubmit={onSubmit}>
          <svg className="yt-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={state.query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              state.mode === 'music'
                ? 'Search YouTube Music, or paste a link…'
                : 'Search YouTube, or paste a video link…'
            }
            aria-label={state.mode === 'music' ? 'Search YouTube Music' : 'Search YouTube'}
          />
          <button type="submit" className="yt-go" disabled={state.loading}>
            {state.loading ? '…' : 'Search'}
          </button>
        </form>
        {state.current && state.results.length > 0 && (
          <button
            className={`yt-icon-btn${resultsOpen ? ' active' : ''}`}
            title="Search results"
            aria-label="Toggle search results"
            onClick={() => setResultsOpen((v) => !v)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </button>
        )}
        <button
          className={`yt-icon-btn${showSettings ? ' active' : ''}`}
          title="API key settings"
          aria-label="API key settings"
          onClick={() => setShowSettings((v) => !v)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </header>

      {showSettings && (
        <div className="yt-settings">
          <label htmlFor="yt-api-key">YouTube Data API v3 key (optional)</label>
          <input
            id="yt-api-key"
            type="password"
            value={state.apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Paste key to enable the search results grid"
          />
          <p className="yt-hint">
            Search works without a key. Adding a YouTube Data API key just switches
            search to the official API (useful if keyless results ever stop working).
          </p>
        </div>
      )}

      <div className="yt-body">
        {/* Results dropdown over the player — only while a video is playing. */}
        {resultsOpen && state.current && state.results.length > 0 && (
          <>
            <div className="yt-results-backdrop" onClick={() => setResultsOpen(false)} />
            <div className="yt-results-dropdown">
              <div className="yt-results-head">
                <span>Search results</span>
                <button
                  className="yt-results-close"
                  onClick={() => setResultsOpen(false)}
                  aria-label="Close results"
                >
                  ✕
                </button>
              </div>
              <div className="yt-results-list scrollable">
                {state.results.map((r) => (
                  <button
                    key={r.videoId}
                    className={`yt-result-row${r.videoId === state.current?.videoId ? ' active' : ''}`}
                    onClick={() => {
                      playVideo(r);
                      setResultsOpen(false);
                    }}
                  >
                    <div className="yt-result-thumb">
                      {r.thumbnail ? <img src={r.thumbnail} alt="" loading="lazy" /> : <div className="yt-thumb-fallback" />}
                    </div>
                    <div className="yt-result-text">
                      <div className="yt-result-title" title={r.title}>{r.title}</div>
                      <div className="yt-result-channel">{r.channel}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* The player host is always mounted (just hidden when idle) so the YT
            IFrame API can manage its lifecycle from the effect above. */}
        <div className="yt-player" style={{ display: hasPlayer ? 'flex' : 'none' }}>
          {state.current && (
            <button className="yt-back" onClick={() => youtubeState.update((s) => ({ ...s, current: null }))}>
              ← Back to results
            </button>
          )}
          <div className="yt-player-frame" ref={playerHostRef} />
          {state.current?.title && <div className="yt-now-playing">{state.current.title}</div>}
        </div>

        {!state.current && state.results.length > 0 && (
          <div className="yt-grid scrollable">
            {state.results.map((r) => (
              <button key={r.videoId} className="yt-card" onClick={() => playVideo(r)}>
                <div className="yt-thumb">
                  {r.thumbnail ? <img src={r.thumbnail} alt="" loading="lazy" /> : <div className="yt-thumb-fallback" />}
                </div>
                <div className="yt-card-title" title={r.title}>{r.title}</div>
                <div className="yt-card-channel">{r.channel}</div>
              </button>
            ))}
          </div>
        )}

        {!hasPlayer && state.results.length === 0 && (
          <div className="yt-empty">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="2" y="5" width="20" height="14" rx="4" />
              <path d="m10 9 5 3-5 3z" />
            </svg>
            <p>Search for something or paste a YouTube link to start watching.</p>
          </div>
        )}

        {state.status && <div className="yt-status">{state.status}</div>}
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useStore } from '$lib/react/useStore';
import { get } from '$lib/stores/storeCompat';
import {
  youtubeState,
  setApiKey,
  setMode,
  setMusicFilter,
  setQuery,
  searchVideos,
  playVideo,
  setPosition,
  goHome,
} from '$lib/stores/youtube';
import { loadYouTubeApi, type YTPlayer } from '$lib/utils/youtubeApi';
import './YouTubePanel.css';

/** Format a second count as m:ss for the music transport bar. */
function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Square-ish high-res cover art for a track (cropped from hqdefault in CSS). */
function musicArt(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export default function YouTubePanel() {
  const state = useStore(youtubeState);
  const [showSettings, setShowSettings] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);

  // Music-mode transport state, sampled from the player while it plays so the
  // audio-only UI has a working play/pause button and seek bar.
  const [musicPlaying, setMusicPlaying] = useState(true);
  const [musicProgress, setMusicProgress] = useState(0);
  const [musicDuration, setMusicDuration] = useState(0);

  // Dynamic details of the currently playing track in a playlist/album.
  const [trackDetails, setTrackDetails] = useState<{
    videoId?: string;
    title?: string;
    channel?: string;
  } | null>(null);

  // While a video is playing, a fresh search drops its results into a dropdown
  // over the player so you can switch without leaving what you're watching.
  const [resultsOpen, setResultsOpen] = useState(false);

  // Measure container dimensions for responsiveness
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await searchVideos(state.query);
    if (get(youtubeState).current) setResultsOpen(true);
  }

  const currentVideoId = state.current?.videoId ?? null;
  const currentPlaylistId = state.current?.playlistId ?? null;
  const playbackKey =
    currentPlaylistId && currentVideoId
      ? `${currentPlaylistId}_${currentVideoId}`
      : currentPlaylistId || currentVideoId;
  const hasPlayer = Boolean(playbackKey);
  const hasPlaylist = Boolean(currentPlaylistId);

  // Build (and tear down) the IFrame API player. Keyed on the playbackKey (videoId or playlistId)
  // so it only rebuilds when the source playlist/video changes — not on the per-second position
  // updates — which is what keeps playback smooth. On unmount we save the current time so
  // the next mount resumes it.
  useEffect(() => {
    if (!playbackKey) return;
    const host = playerHostRef.current;
    if (!host) return;

    let cancelled = false;
    let poll: number | null = null;
    // Captured once, at the moment this video/playlist mounts — the resume point.
    const startAt = Math.floor(get(youtubeState).position);
    // Reset the music transport for the freshly-loaded track.
    setMusicProgress(0);
    setMusicDuration(0);
    setMusicPlaying(true);
    setTrackDetails(null);

    void loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !playerHostRef.current) return;
        const mount = document.createElement('div');
        playerHostRef.current.appendChild(mount);

        playerRef.current = new YT.Player(mount, {
          host: 'https://www.youtube-nocookie.com',
          videoId: currentVideoId || undefined,
          playerVars: {
            autoplay: 1,
            rel: 0,
            modestbranding: 1,
            start: currentPlaylistId ? undefined : startAt,
            listType: currentPlaylistId ? 'playlist' : undefined,
            list: currentPlaylistId || undefined,
          },
        });

        // Sample the position and track info while playing.
        poll = window.setInterval(() => {
          const p = playerRef.current;
          if (!p) return;
          try {
            const t = p.getCurrentTime();
            if (typeof t === 'number' && t > 0) {
              setPosition(t);
              setMusicProgress(t);
            }
            const d = p.getDuration();
            if (typeof d === 'number' && d > 0) setMusicDuration(d);
            const ps = p.getPlayerState();
            if (typeof ps === 'number') setMusicPlaying(ps === 1 || ps === 3);

            // Dynamically retrieve info of the active track (crucial for playlists/albums)
            const data = (p as any).getVideoData?.();
            if (data && data.video_id) {
              setTrackDetails({
                videoId: data.video_id,
                title: data.title || '',
                channel: data.author || '',
              });
            }
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
      playerHostRef.current?.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackKey]);

  const isMusic = state.mode === 'music';

  function toggleMusicPlay() {
    const p = playerRef.current;
    if (!p) return;
    try {
      if (musicPlaying) {
        p.pauseVideo();
        setMusicPlaying(false);
      } else {
        p.playVideo();
        setMusicPlaying(true);
      }
    } catch {
      /* player not ready yet */
    }
  }

  function onMusicSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value);
    setMusicProgress(v);
    const p = playerRef.current;
    if (!p) return;
    try {
      p.seekTo(v, true);
    } catch {
      /* player not ready yet */
    }
  }

  function playNext() {
    const p = playerRef.current;
    if (!p) return;
    try {
      (p as any).nextVideo?.();
    } catch {
      /* not ready / not a playlist */
    }
  }

  function playPrev() {
    const p = playerRef.current;
    if (!p) return;
    try {
      (p as any).previousVideo?.();
    } catch {
      /* not ready / not a playlist */
    }
  }

  const isNarrow = dimensions.width > 0 && dimensions.width < 500;
  const isShort = dimensions.height > 0 && dimensions.height < 450;
  const isMiniHeight = dimensions.height > 0 && dimensions.height < 250;

  const sizeClasses = [
    isNarrow ? 'yt-width-narrow' : '',
    isShort ? 'yt-height-short' : '',
    isMiniHeight ? 'yt-height-mini' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const activeTitle = trackDetails?.title || state.current?.title || '';
  const activeChannel = trackDetails?.channel || state.current?.channel || '';

  function getActiveArt() {
    if (trackDetails?.videoId) {
      return musicArt(trackDetails.videoId);
    }
    if (state.current?.thumbnail) {
      return state.current.thumbnail;
    }
    if (state.current?.videoId) {
      return musicArt(state.current.videoId);
    }
    return '';
  }

  return (
    <section ref={panelRef} className={`youtube-panel ${sizeClasses}`}>
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            <span className="yt-mode-text">Video</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={state.mode === 'music'}
            className={`yt-mode-btn${state.mode === 'music' ? ' active' : ''}`}
            onClick={() => setMode('music')}
            title="Search YouTube Music"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            <span className="yt-mode-text">Music</span>
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
                ? isNarrow
                  ? 'Search Music…'
                  : 'Search YouTube Music, or paste a link…'
                : isNarrow
                  ? 'Search Video…'
                  : 'Search YouTube, or paste a video link…'
            }
            aria-label={state.mode === 'music' ? 'Search YouTube Music' : 'Search YouTube'}
          />
          <button type="submit" className="yt-go" disabled={state.loading} aria-label="Search">
            {state.loading ? '…' : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="yt-go-icon">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <span className="yt-go-text">Search</span>
              </>
            )}
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
        {state.mode === 'music' && !state.current && (
          <div className="yt-music-filters">
            <button
              type="button"
              className={`yt-filter-pill${state.musicFilter === 'songs' ? ' active' : ''}`}
              onClick={() => setMusicFilter('songs')}
            >
              Songs
            </button>
            <button
              type="button"
              className={`yt-filter-pill${state.musicFilter === 'albums' ? ' active' : ''}`}
              onClick={() => setMusicFilter('albums')}
            >
              Albums
            </button>
            <button
              type="button"
              className={`yt-filter-pill${state.musicFilter === 'playlists' ? ' active' : ''}`}
              onClick={() => setMusicFilter('playlists')}
            >
              Playlists
            </button>
          </div>
        )}

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
                    key={r.playlistId || r.videoId}
                    className={`yt-result-row${
                      (r.playlistId && r.playlistId === state.current?.playlistId) ||
                      (r.videoId && r.videoId === state.current?.videoId)
                        ? ' active'
                        : ''
                    }`}
                    onClick={() => {
                      playVideo(r);
                      setResultsOpen(false);
                    }}
                  >
                    <div className="yt-result-thumb">
                      {r.thumbnail ? <img src={r.thumbnail} alt="" loading="lazy" /> : <div className="yt-thumb-fallback" />}
                      {r.type && r.type !== 'song' && r.type !== 'video' && (
                        <span className="yt-badge">{r.type}</span>
                      )}
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
            IFrame API can manage its lifecycle from the effect above. In music
            mode the host is pushed off-screen (it keeps the audio playing) and a
            dedicated music UI is shown instead — see .yt-player-music in the CSS. */}
        <div className={`yt-player${isMusic ? ' yt-player-music' : ''}`} style={{ display: hasPlayer ? 'flex' : 'none' }}>
          {state.current && (
            <button className="yt-back" onClick={() => youtubeState.update((s) => ({ ...s, current: null }))}>
              ← <span className="yt-back-text">Back to results</span>
            </button>
          )}

          {isMusic && state.current && (
            <div className="yt-music">
              <div className="yt-music-art">
                <img src={getActiveArt()} alt="" />
              </div>
              <div className="yt-music-details">
                <div className="yt-music-meta">
                  <div className="yt-music-title" title={activeTitle}>{activeTitle}</div>
                  {activeChannel && <div className="yt-music-artist">{activeChannel}</div>}
                </div>
                <div className="yt-music-controls">
                  <div className="yt-music-btns">
                    <button
                      type="button"
                      className="yt-music-prev"
                      onClick={playPrev}
                      disabled={!hasPlaylist}
                      title="Previous track"
                      aria-label="Previous track"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="yt-music-play"
                      onClick={toggleMusicPlay}
                      aria-label={musicPlaying ? 'Pause' : 'Play'}
                      title={musicPlaying ? 'Pause' : 'Play'}
                    >
                      {musicPlaying ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6" y="5" width="4" height="14" rx="1" />
                          <rect x="14" y="5" width="4" height="14" rx="1" />
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      className="yt-music-next"
                      onClick={playNext}
                      disabled={!hasPlaylist}
                      title="Next track"
                      aria-label="Next track"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 18l8.5-6L6 6zm9-12h2v12h-2z" />
                      </svg>
                    </button>
                  </div>
                  <div className="yt-music-slider">
                    <span className="yt-music-time">{fmtTime(musicProgress)}</span>
                    <input
                      className="yt-music-seek"
                      type="range"
                      min={0}
                      max={musicDuration || 0}
                      step={1}
                      value={Math.min(musicProgress, musicDuration || 0)}
                      onChange={onMusicSeek}
                      aria-label="Seek"
                    />
                    <span className="yt-music-time">{fmtTime(musicDuration)}</span>
                  </div>
                </div>
              </div>

              {state.albumLoading && (
                <div className="yt-album-tracklist-loading">
                  Loading album tracks...
                </div>
              )}
              {!state.albumLoading && state.albumTracks && state.albumTracks.length > 0 && (
                <div className="yt-album-tracklist scrollable">
                  <div className="yt-tracklist-header">
                    {state.current?.type === 'album' ? 'Album Tracks' : 'Playlist Songs'}
                  </div>
                  <div className="yt-tracklist-rows">
                    {state.albumTracks.map((track, index) => {
                      const isCurrent = trackDetails?.videoId === track.videoId;
                      return (
                        <button
                          key={track.videoId}
                          className={`yt-track-row${isCurrent ? ' active' : ''}`}
                          onClick={() => {
                            const p = playerRef.current;
                            if (p && (p as any).playVideoAt) {
                              (p as any).playVideoAt(index);
                            }
                          }}
                        >
                          <span className="yt-track-num">
                            {isCurrent ? (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            ) : (
                              index + 1
                            )}
                          </span>
                          <span className="yt-track-title" title={track.title}>{track.title}</span>
                          <span className="yt-track-duration">{track.channel}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="yt-player-frame" ref={playerHostRef} />

          {!isMusic && state.current?.title && <div className="yt-now-playing">{activeTitle}</div>}
        </div>

        {!state.current && state.results.length > 0 && (
          <div className="yt-grid scrollable">
            {state.results.map((r) => (
              <button key={r.playlistId || r.videoId} className="yt-card" onClick={() => playVideo(r)}>
                <div className="yt-thumb">
                  {r.thumbnail ? <img src={r.thumbnail} alt="" loading="lazy" /> : <div className="yt-thumb-fallback" />}
                  {r.type && r.type !== 'song' && r.type !== 'video' && (
                    <span className="yt-badge">{r.type}</span>
                  )}
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

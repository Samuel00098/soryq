// Minimal loader + typings for the YouTube IFrame Player API.
//
// We use the official API (rather than a bare <iframe>) for one reason: it's the
// only reliable way to read the player's current time and seek to it, which is
// what lets playback resume after the panel remounts on an ambient-mode switch.
// The player it creates is still a normal iframe embedded inside the panel.

export interface YTPlayer {
  getCurrentTime(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  destroy(): void;
}

export interface YTPlayerVars {
  autoplay?: 0 | 1;
  rel?: 0 | 1;
  start?: number;
  listType?: string;
  list?: string;
  modestbranding?: 0 | 1;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement | string,
    opts: {
      videoId?: string;
      host?: string;
      playerVars?: YTPlayerVars;
      events?: { onReady?: (e: { target: YTPlayer }) => void };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let loadPromise: Promise<YTNamespace> | null = null;

/** Load (once) and resolve the global `YT` namespace. */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<YTNamespace>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('YouTube API loaded but YT.Player is missing'));
    };

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load the YouTube IFrame API'));
    document.head.appendChild(script);
  });

  return loadPromise;
}

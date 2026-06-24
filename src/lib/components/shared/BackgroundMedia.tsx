import { useEffect, useRef, useState } from 'react';
import { useBackgroundStore } from '$lib/stores/zustand/background';
import { useSettingsStore } from '$lib/stores/zustand/settings';
import './BackgroundMedia.css';

export default function BackgroundMedia() {
  const media = useBackgroundStore((s) => s.backgroundMedia);
  const enabled = useSettingsStore((s) => s.backgroundImageEnabled);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncPreference = () => setPrefersReducedMotion(mediaQuery.matches);
    syncPreference();
    mediaQuery.addEventListener('change', syncPreference);
    return () => mediaQuery.removeEventListener('change', syncPreference);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const syncVisibility = () => setPageVisible(!document.hidden);
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => document.removeEventListener('visibilitychange', syncVisibility);
  }, []);

  const videoUrl = media && media.kind === 'video' ? media.url : null;
  const shouldRender = enabled && videoUrl !== null && !prefersReducedMotion;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!pageVisible || prefersReducedMotion) {
      video.pause();
      return;
    }

    video.play().catch(() => {
      // Autoplay can be rejected by the host webview; the wallpaper remains non-blocking.
    });
  }, [pageVisible, prefersReducedMotion, shouldRender, videoUrl]);

  if (!shouldRender || videoUrl === null) return null;

  return (
    // key forces a fresh element when the source changes (the key-based pattern).
    <video
      key={videoUrl}
      ref={videoRef}
      className="live-background-video"
      src={videoUrl}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      disablePictureInPicture
      aria-hidden="true"
      tabIndex={-1}
    ></video>
  );
}

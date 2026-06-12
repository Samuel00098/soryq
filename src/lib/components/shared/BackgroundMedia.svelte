<script lang="ts">
  import { backgroundMedia } from '$lib/stores/background';
  import { backgroundImageEnabled } from '$lib/stores/settings';

  let videoEl: HTMLVideoElement | undefined = $state();
  let prefersReducedMotion = $state(false);
  let pageVisible = $state(true);

  $effect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncPreference = () => {
      prefersReducedMotion = mediaQuery.matches;
    };

    syncPreference();
    mediaQuery.addEventListener('change', syncPreference);
    return () => mediaQuery.removeEventListener('change', syncPreference);
  });

  $effect(() => {
    if (typeof document === 'undefined') return;

    const syncVisibility = () => {
      pageVisible = !document.hidden;
    };

    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => document.removeEventListener('visibilitychange', syncVisibility);
  });

  $effect(() => {
    const video = videoEl;
    if (!video) return;

    if (!pageVisible || prefersReducedMotion) {
      video.pause();
      return;
    }

    video.play().catch(() => {
      // Autoplay can be rejected by the host webview; the wallpaper remains non-blocking.
    });
  });
</script>

{#if $backgroundImageEnabled && $backgroundMedia?.kind === 'video' && !prefersReducedMotion}
  {#key $backgroundMedia.url}
    <video
      bind:this={videoEl}
      class="live-background-video"
      src={$backgroundMedia.url}
      autoplay
      muted
      loop
      playsinline
      preload="metadata"
      disablepictureinpicture
      aria-hidden="true"
      tabindex="-1"
    ></video>
  {/key}
{/if}

<style>
  .live-background-video {
    position: fixed;
    inset: calc(-3 * var(--user-bg-blur, 0px));
    z-index: -2;
    width: calc(100vw + 6 * var(--user-bg-blur, 0px));
    height: calc(100vh + 6 * var(--user-bg-blur, 0px));
    object-fit: cover;
    object-position: center center;
    opacity: var(--user-bg-opacity, 1);
    filter: blur(var(--user-bg-blur, 0px));
    pointer-events: none;
    user-select: none;
    contain: layout paint size;
    transition:
      opacity 280ms cubic-bezier(0.4, 0, 0.2, 1),
      filter 280ms cubic-bezier(0.4, 0, 0.2, 1);
    will-change: opacity, filter;
    transform: translate3d(0, 0, 0);
    backface-visibility: hidden;
  }
</style>

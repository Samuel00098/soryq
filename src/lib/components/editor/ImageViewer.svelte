<script lang="ts">
  let { src, path, mimeType = null, size = null }: {
    src: string;
    path: string;
    mimeType?: string | null;
    size?: number | null;
  } = $props();

  let naturalWidth = $state<number | null>(null);
  let naturalHeight = $state<number | null>(null);

  function handleImageLoad(event: Event) {
    const img = event.currentTarget as HTMLImageElement | null;
    if (!img) return;
    naturalWidth = img.naturalWidth;
    naturalHeight = img.naturalHeight;
  }

  function formatBytes(value: number | null): string {
    if (!value || value < 0) return '';
    if (value < 1024) return `${value} B`;
    const units = ['KB', 'MB', 'GB'];
    let sizeValue = value / 1024;
    let unitIndex = 0;
    while (sizeValue >= 1024 && unitIndex < units.length - 1) {
      sizeValue /= 1024;
      unitIndex += 1;
    }
    return `${sizeValue >= 10 ? sizeValue.toFixed(0) : sizeValue.toFixed(1)} ${units[unitIndex]}`;
  }

  function fileName(filePath: string): string {
    return filePath.split(/[\\\/]/).pop() || filePath;
  }
</script>

<div class="image-viewer">
  <div class="image-meta-bar">
    <span class="meta-pill meta-name">{fileName(path)}</span>
    {#if mimeType}
      <span class="meta-pill">{mimeType.replace('image/', '').toUpperCase()}</span>
    {/if}
    {#if naturalWidth && naturalHeight}
      <span class="meta-pill">{naturalWidth} x {naturalHeight}</span>
    {/if}
    {#if size}
      <span class="meta-pill">{formatBytes(size)}</span>
    {/if}
  </div>

  <div class="image-stage">
    <div class="image-frame">
      <img src={src} alt={fileName(path)} onload={handleImageLoad} draggable="false" />
    </div>
  </div>
</div>

<style>
  .image-viewer {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background:
      linear-gradient(45deg, rgba(255,255,255,0.03) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.03) 75%),
      linear-gradient(45deg, rgba(255,255,255,0.03) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.03) 75%);
    background-position: 0 0, 12px 12px;
    background-size: 24px 24px;
  }

  .image-meta-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.42);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }

  .meta-pill {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 0 9px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--bg-secondary) 74%, transparent);
    border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
  }

  .meta-name {
    color: var(--text-primary);
  }

  .image-stage {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: grid;
    place-items: center;
    padding: 20px;
  }

  .image-frame {
    max-width: min(100%, 1400px);
    border-radius: 16px;
    padding: 14px;
    background: rgba(var(--bg-primary-rgb, 24, 24, 30), 0.72);
    border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
    box-shadow:
      0 18px 40px rgba(0, 0, 0, 0.24),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }

  .image-frame img {
    display: block;
    max-width: min(100%, 1200px);
    max-height: calc(100vh - 220px);
    width: auto;
    height: auto;
    object-fit: contain;
    border-radius: 10px;
    user-select: none;
    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.28);
    background: rgba(255,255,255,0.02);
  }
</style>

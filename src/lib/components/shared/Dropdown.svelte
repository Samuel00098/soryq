<script module lang="ts">
  // Premium custom dropdown matching the app's picker language (see
  // FloatingPromptBar target-picker): frosted popover, rounded items, accent
  // active state. Replaces native <select> so menus feel consistent.
  export type DropdownOption = {
    value: string;
    label: string;
    sublabel?: string;
    color?: string;
    disabled?: boolean;
  };
</script>

<script lang="ts">
  let {
    options,
    value = $bindable(),
    onChange,
    placeholder = 'Select…',
    ariaLabel = 'Select an option',
    disabled = false,
  }: {
    options: DropdownOption[];
    value: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    ariaLabel?: string;
    disabled?: boolean;
  } = $props();

  let open = $state(false);
  let dropUp = $state(false);
  let rootEl = $state<HTMLDivElement | null>(null);

  let selected = $derived(options.find((o) => o.value === value) ?? null);

  // Menu max-height (keep in sync with .dd-menu max-height below).
  const MENU_MAX = 260;

  /** Decide whether to open upward: when there isn't room below but there is above. */
  function updatePlacement() {
    if (!rootEl) return;
    const r = rootEl.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const above = r.top;
    dropUp = below < Math.min(MENU_MAX, 200) && above > below;
  }

  function toggle() {
    if (disabled) return;
    if (!open) updatePlacement();
    open = !open;
  }

  function choose(option: DropdownOption) {
    if (option.disabled) return;
    value = option.value;
    onChange?.(option.value);
    open = false;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      open = false;
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && !open) {
      e.preventDefault();
      updatePlacement();
      open = true;
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { updatePlacement(); open = true; return; }
      const enabled = options.filter((o) => !o.disabled);
      if (enabled.length === 0) return;
      const idx = enabled.findIndex((o) => o.value === value);
      const next = e.key === 'ArrowDown'
        ? enabled[Math.min(enabled.length - 1, idx + 1)]
        : enabled[Math.max(0, idx - 1)];
      if (next) { value = next.value; onChange?.(next.value); }
    }
  }

  $effect(() => {
    if (!open) return;
    const handlePointer = (e: MouseEvent) => {
      if (rootEl && !rootEl.contains(e.target as Node)) open = false;
    };
    window.addEventListener('mousedown', handlePointer);
    return () => window.removeEventListener('mousedown', handlePointer);
  });
</script>

<div class="dropdown" bind:this={rootEl}>
  <button
    type="button"
    class="dd-trigger"
    class:open
    {disabled}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={ariaLabel}
    onclick={toggle}
    onkeydown={onKeydown}
  >
    {#if selected?.color}
      <span class="dd-dot" style="background: {selected.color};"></span>
    {/if}
    <span class="dd-value" class:placeholder={!selected}>{selected?.label ?? placeholder}</span>
    <svg class="dd-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  </button>

  {#if open}
    <div class="dd-menu" class:drop-up={dropUp} role="listbox" aria-label={ariaLabel}>
      {#each options as option (option.value)}
        <button
          type="button"
          class="dd-item"
          class:active={option.value === value}
          disabled={option.disabled}
          role="option"
          aria-selected={option.value === value}
          onclick={() => choose(option)}
        >
          {#if option.color}
            <span class="dd-dot" style="background: {option.color};"></span>
          {/if}
          <span class="dd-item-label">{option.label}</span>
          {#if option.sublabel}
            <span class="dd-item-sub">{option.sublabel}</span>
          {/if}
          {#if option.value === value}
            <svg class="dd-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .dropdown {
    position: relative;
    min-width: 0;
  }

  .dd-trigger {
    width: 100%;
    height: 30px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.5);
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--text-secondary);
    font-size: 11.5px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s, color 0.15s;
  }
  .dd-trigger:hover:not(:disabled) {
    border-color: var(--border-focus);
    color: var(--text-primary);
  }
  .dd-trigger.open {
    border-color: var(--accent);
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.7);
  }
  .dd-trigger:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .dd-value {
    flex: 1;
    min-width: 0;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 550;
    color: var(--text-primary);
  }
  .dd-value.placeholder {
    color: var(--text-muted);
    font-weight: 500;
  }

  .dd-chevron {
    flex-shrink: 0;
    opacity: 0.55;
    transition: transform 0.18s ease, opacity 0.15s;
  }
  .dd-trigger.open .dd-chevron {
    transform: rotate(180deg);
    opacity: 0.9;
  }

  .dd-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dd-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    transform-origin: top;
    background: color-mix(in srgb, var(--bg-secondary) 96%, transparent);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border));
    border-radius: 12px;
    padding: 5px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.26);
    z-index: 40;
    max-height: 260px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
    animation: dd-pop 0.13s ease;
  }
  .dd-menu.drop-up {
    top: auto;
    bottom: calc(100% + 6px);
    transform-origin: bottom;
    animation: dd-pop-up 0.13s ease;
  }

  @keyframes dd-pop {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes dd-pop-up {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .dd-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 9px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .dd-item:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .dd-item.active {
    background: color-mix(in srgb, var(--accent) 14%, var(--bg-primary));
    color: var(--text-primary);
  }
  .dd-item:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .dd-item-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .dd-item-sub {
    font-size: 10px;
    color: var(--text-muted);
    font-family: var(--font-mono, monospace);
    flex-shrink: 0;
  }
  .dd-check {
    color: var(--accent);
    flex-shrink: 0;
  }
</style>

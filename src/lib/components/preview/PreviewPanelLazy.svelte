<!--
  Lazy boundary for PreviewPanel — see EditorPanelLazy for the rationale. Loaded
  on demand so its code stays out of the startup bundle; rendered in place of
  PreviewPanel so call sites stay `<PreviewPanel />`.
-->
<script lang="ts">
  import type { Component } from 'svelte';
  import { onMount } from 'svelte';

  let Panel = $state<Component | null>(null);
  onMount(async () => {
    Panel = (await import('./PreviewPanel.svelte')).default as unknown as Component;
  });
</script>

{#if Panel}
  <Panel />
{/if}

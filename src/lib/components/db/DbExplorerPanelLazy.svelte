<!--
  Lazy boundary for DbExplorerPanel — see EditorPanelLazy for the rationale.
  Loaded on demand; rendered in place of DbExplorerPanel so call sites stay
  unchanged.
-->
<script lang="ts">
  import type { Component } from 'svelte';
  import { onMount } from 'svelte';

  let Panel = $state<Component | null>(null);
  onMount(async () => {
    Panel = (await import('./DbExplorerPanel.svelte')).default as unknown as Component;
  });
</script>

{#if Panel}
  <Panel />
{/if}

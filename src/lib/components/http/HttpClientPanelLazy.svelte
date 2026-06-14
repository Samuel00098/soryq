<!--
  Lazy boundary for HttpClientPanel — see EditorPanelLazy for the rationale.
  Loaded on demand; rendered in place of HttpClientPanel so call sites stay
  unchanged.
-->
<script lang="ts">
  import type { Component } from 'svelte';
  import { onMount } from 'svelte';

  let Panel = $state<Component | null>(null);
  onMount(async () => {
    Panel = (await import('./HttpClientPanel.svelte')).default as unknown as Component;
  });
</script>

{#if Panel}
  <Panel />
{/if}

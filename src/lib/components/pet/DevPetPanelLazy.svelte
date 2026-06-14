<!--
  Lazy boundary for DevPetPanel — see EditorPanelLazy for the rationale. Loaded
  on demand; rendered in place of DevPetPanel so call sites stay unchanged.
-->
<script lang="ts">
  import type { Component } from 'svelte';
  import { onMount } from 'svelte';

  let Panel = $state<Component | null>(null);
  onMount(async () => {
    Panel = (await import('./DevPetPanel.svelte')).default as unknown as Component;
  });
</script>

{#if Panel}
  <Panel />
{/if}

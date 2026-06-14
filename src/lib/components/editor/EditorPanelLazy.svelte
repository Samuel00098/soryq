<!--
  Lazy boundary for EditorPanel. The editor pulls in CodeMirror plus ~20 language
  packs, the LSP client and ghost-text completion — none of which are needed at
  first paint (the shell + terminal show first). Loading it on demand keeps that
  weight out of the startup bundle. Rendered in place of EditorPanel so every
  call site stays `<EditorPanel />` with no other changes.
-->
<script lang="ts">
  import type { Component } from 'svelte';
  import { onMount } from 'svelte';

  let Panel = $state<Component | null>(null);
  onMount(async () => {
    Panel = (await import('./EditorPanel.svelte')).default as unknown as Component;
  });
</script>

{#if Panel}
  <Panel />
{/if}

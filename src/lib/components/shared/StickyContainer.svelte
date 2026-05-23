<script lang="ts">
  interface Props {
    stickyTop?: boolean;
    stickyBottom?: boolean;
    class?: string;
    topContent?: import('svelte').Snippet;
    bottomContent?: import('svelte').Snippet;
    children?: import('svelte').Snippet;
  }

  let { 
    stickyTop = false, 
    stickyBottom = false, 
    class: className = '',
    topContent,
    bottomContent,
    children 
  }: Props = $props();
</script>

<div class="sticky-container {className}">
  {#if stickyTop && topContent}
    <div class="sticky-wrapper sticky-top">
      {@render topContent()}
    </div>
  {/if}
  
  <div class="sticky-content">
    {@render children?.()}
  </div>
  
  {#if stickyBottom && bottomContent}
    <div class="sticky-wrapper sticky-bottom">
      {@render bottomContent()}
    </div>
  {/if}
</div>

<style>
  .sticky-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .sticky-wrapper {
    flex-shrink: 0;
  }

  .sticky-top {
    position: sticky;
    top: 0;
    z-index: 50;
    background: var(--bg-secondary);
  }

  .sticky-bottom {
    position: sticky;
    bottom: 0;
    z-index: 49;
    background: var(--bg-secondary);
  }

  .sticky-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
  }
</style>


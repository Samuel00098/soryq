<script lang="ts">
  import { marked } from 'marked';

  let { content = '' }: { content: string } = $props();

  let html = $derived.by(() => {
    try {
      // Configure marked option to allow GFM (GitHub Flavored Markdown)
      return marked.parse(content || '', {
        gfm: true,
        breaks: true,
      }) as string;
    } catch (err) {
      console.error('Failed to parse markdown:', err);
      return `<p style="color: var(--error)">Error rendering markdown: ${err}</p>`;
    }
  });
</script>

<div class="markdown-container">
  <article class="markdown-body">
    {@html html}
  </article>
</div>

<style>
  .markdown-container {
    width: 100%;
    height: 100%;
    overflow-y: auto;
    background: var(--bg-primary);
    color: var(--text-primary);
    padding: 2.5rem 2rem;
    display: flex;
    justify-content: center;
    scroll-behavior: smooth;
  }

  .markdown-body {
    width: 100%;
    max-width: 800px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14.5px;
    line-height: 1.62;
  }

  /* Headings */
  .markdown-body :global(h1),
  .markdown-body :global(h2),
  .markdown-body :global(h3),
  .markdown-body :global(h4),
  .markdown-body :global(h5),
  .markdown-body :global(h6) {
    margin-top: 2rem;
    margin-bottom: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.25;
  }

  .markdown-body :global(h1) {
    font-size: 2.2rem;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.6rem;
    margin-top: 0;
  }

  .markdown-body :global(h2) {
    font-size: 1.6rem;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.4rem;
  }

  .markdown-body :global(h3) {
    font-size: 1.3rem;
  }

  .markdown-body :global(h4) {
    font-size: 1.15rem;
  }

  /* Content Elements */
  .markdown-body :global(p) {
    margin-top: 0;
    margin-bottom: 1.2rem;
    color: var(--text-secondary);
  }

  .markdown-body :global(a) {
    color: var(--accent-hover);
    text-decoration: none;
    transition: color 0.15s;
  }

  .markdown-body :global(a:hover) {
    text-decoration: underline;
    color: var(--accent);
  }

  .markdown-body :global(ul),
  .markdown-body :global(ol) {
    margin-top: 0;
    margin-bottom: 1.2rem;
    padding-left: 2rem;
    color: var(--text-secondary);
  }

  .markdown-body :global(li) {
    margin-top: 0.3rem;
  }

  .markdown-body :global(blockquote) {
    margin: 1.8rem 0;
    padding: 0.6rem 1.2rem;
    color: var(--text-secondary);
    background: var(--bg-secondary);
    border-left: 4px solid var(--accent);
    border-radius: 0 6px 6px 0;
    font-style: italic;
  }

  .markdown-body :global(blockquote p) {
    margin: 0;
  }

  /* Code blocks */
  .markdown-body :global(pre) {
    margin-top: 1.2rem;
    margin-bottom: 1.2rem;
    padding: 1.1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow-x: auto;
  }

  .markdown-body :global(code) {
    font-family: var(--editor-font-family, 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace);
    font-size: 88%;
    background: var(--bg-secondary);
    padding: 0.2rem 0.45rem;
    border-radius: 4px;
    color: var(--text-primary);
  }

  .markdown-body :global(pre code) {
    background: transparent;
    padding: 0;
    font-size: 90%;
    color: inherit;
    border-radius: 0;
  }

  /* Tables */
  .markdown-body :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin-top: 1.2rem;
    margin-bottom: 1.2rem;
  }

  .markdown-body :global(th),
  .markdown-body :global(td) {
    border: 1px solid var(--border);
    padding: 0.7rem 1.1rem;
    text-align: left;
  }

  .markdown-body :global(th) {
    background: var(--bg-secondary);
    font-weight: 600;
    color: var(--text-primary);
  }

  .markdown-body :global(td) {
    color: var(--text-secondary);
  }

  .markdown-body :global(tr:nth-child(even)) {
    background: rgba(255, 255, 255, 0.015);
  }

  /* Other elements */
  .markdown-body :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: 8px;
    margin: 1.8rem 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .markdown-body :global(hr) {
    height: 1px;
    background: var(--border);
    border: none;
    margin: 2.2rem 0;
  }
</style>

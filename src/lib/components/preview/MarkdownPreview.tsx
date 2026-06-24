import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import './MarkdownPreview.css';

export default function MarkdownPreview({ content = '' }: { content?: string }) {
  const html = useMemo(() => {
    try {
      const raw = marked.parse(content || '', {
        gfm: true,
        breaks: true,
      }) as string;
      return DOMPurify.sanitize(raw);
    } catch (err) {
      console.error('Failed to parse markdown:', err);
      return `<p style="color: var(--error)">Error rendering markdown</p>`;
    }
  }, [content]);

  return (
    <div className="markdown-container">
      <article className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

import type { ReactNode } from 'react';
import './StickyContainer.css';

interface Props {
  stickyTop?: boolean;
  stickyBottom?: boolean;
  className?: string;
  /** `topContent`/`bottomContent` snippets become React nodes. */
  topContent?: ReactNode;
  bottomContent?: ReactNode;
  children?: ReactNode;
}

export default function StickyContainer({
  stickyTop = false,
  stickyBottom = false,
  className = '',
  topContent,
  bottomContent,
  children,
}: Props) {
  return (
    <div className={`sticky-container ${className}`}>
      {stickyTop && topContent && <div className="sticky-wrapper sticky-top">{topContent}</div>}

      <div className="sticky-content">{children}</div>

      {stickyBottom && bottomContent && (
        <div className="sticky-wrapper sticky-bottom">{bottomContent}</div>
      )}
    </div>
  );
}

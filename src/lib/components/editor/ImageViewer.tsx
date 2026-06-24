import { useState } from 'react';
import './ImageViewer.css';

interface Props {
  src: string;
  path: string;
  mimeType?: string | null;
  size?: number | null;
}

function formatBytes(value: number | null): string {
  if (!value || value < 0) return '';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let sizeValue = value / 1024;
  let unitIndex = 0;
  while (sizeValue >= 1024 && unitIndex < units.length - 1) {
    sizeValue /= 1024;
    unitIndex += 1;
  }
  return `${sizeValue >= 10 ? sizeValue.toFixed(0) : sizeValue.toFixed(1)} ${units[unitIndex]}`;
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

export default function ImageViewer({ src, path, mimeType = null, size = null }: Props) {
  const [naturalWidth, setNaturalWidth] = useState<number | null>(null);
  const [naturalHeight, setNaturalHeight] = useState<number | null>(null);

  function handleImageLoad(event: React.SyntheticEvent<HTMLImageElement>) {
    const img = event.currentTarget;
    setNaturalWidth(img.naturalWidth);
    setNaturalHeight(img.naturalHeight);
  }

  return (
    <div className="image-viewer">
      <div className="image-meta-bar">
        <span className="meta-pill meta-name">{fileName(path)}</span>
        {mimeType && <span className="meta-pill">{mimeType.replace('image/', '').toUpperCase()}</span>}
        {naturalWidth && naturalHeight && (
          <span className="meta-pill">
            {naturalWidth} x {naturalHeight}
          </span>
        )}
        {size && <span className="meta-pill">{formatBytes(size)}</span>}
      </div>

      <div className="image-stage">
        <div className="image-frame">
          <img src={src} alt={fileName(path)} onLoad={handleImageLoad} draggable={false} />
        </div>
      </div>
    </div>
  );
}

import { useRef } from 'react';
import { get } from '$lib/stores/storeCompat';
import FileIcon from './FileIcon.tsx';
import type { FileNode as FileNodeType } from '$lib/types/explorer';
import {
  toggleNode,
  selectedPaths,
  selectSingle,
  toggleSelection,
  selectRangeTo,
  showContextMenu,
  renamingPath,
  renamingValue,
  confirmRename,
  cancelRename,
  creatingPath,
  creatingType,
  creatingValue,
  confirmCreate,
  cancelCreate,
} from '$lib/stores/explorer';
import { useStore } from '$lib/react/useStore';
import './FileNode.css';

const DRAG_THRESHOLD = 6;

interface PendingDrag {
  path: string;
  startX: number;
  startY: number;
  active: boolean;
}

export default function FileNode({ node }: { node: FileNodeType }) {
  const selected = useStore(selectedPaths);
  const renaming = useStore(renamingPath);
  const renameValue = useStore(renamingValue);
  const creating = useStore(creatingPath);
  const createType = useStore(creatingType);
  const createValue = useStore(creatingValue);

  const pendingDrag = useRef<PendingDrag | null>(null);
  const suppressClick = useRef(false);

  async function handleClick(e: React.MouseEvent | React.KeyboardEvent) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    // Ctrl/Cmd toggles a single item; Shift extends a range. Neither opens or
    // expands the node — they only adjust the selection (standard explorer UX).
    if (e.ctrlKey || e.metaKey) {
      toggleSelection(node.entry.path);
      return;
    }
    if (e.shiftKey) {
      selectRangeTo(node.entry.path);
      return;
    }
    // Plain click: collapse the selection to this one item, then open/expand it.
    selectSingle(node.entry.path);
    await toggleNode(node);
  }

  function handleKeydown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick(e);
    }
  }

  function handleContextMenu(e: React.MouseEvent) {
    // Right-clicking an item outside the current selection resets the selection
    // to just that item, so the menu's Delete acts on what the user pointed at.
    if (!get(selectedPaths).has(node.entry.path)) {
      selectSingle(node.entry.path);
    }
    showContextMenu(e.nativeEvent, node.entry.path, node.entry.is_dir);
  }

  function cleanupPointerDrag() {
    window.removeEventListener('mousemove', handleWindowMouseMove);
    window.removeEventListener('mouseup', handleWindowMouseUp);
    pendingDrag.current = null;
  }

  function handleWindowMouseMove(event: MouseEvent) {
    const drag = pendingDrag.current;
    if (!drag) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    const movedEnough = Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD;

    if (!drag.active && !movedEnough) {
      return;
    }

    if (!drag.active) {
      drag.active = true;
      suppressClick.current = true;
      window.dispatchEvent(
        new CustomEvent('soryq-explorer-drag-start', { detail: { path: drag.path } }),
      );
    }

    window.dispatchEvent(
      new CustomEvent('soryq-explorer-drag-move', {
        detail: { path: drag.path, clientX: event.clientX, clientY: event.clientY },
      }),
    );
  }

  function handleWindowMouseUp(event: MouseEvent) {
    const drag = pendingDrag.current;
    if (!drag) return;
    cleanupPointerDrag();

    if (!drag.active) return;

    event.preventDefault();
    window.dispatchEvent(
      new CustomEvent('soryq-explorer-drag-end', {
        detail: { path: drag.path, clientX: event.clientX, clientY: event.clientY },
      }),
    );
    requestAnimationFrame(() => {
      suppressClick.current = false;
    });
  }

  function handleMouseDown(event: React.MouseEvent) {
    if (event.button !== 0) return;
    pendingDrag.current = {
      path: node.entry.path,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
  }

  const renameInput = (
    <input
      className="rename-input"
      type="text"
      value={renameValue}
      onChange={(e) => renamingValue.set(e.target.value)}
      autoFocus
      onClick={(e) => e.stopPropagation()}
      onBlur={cancelRename}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          confirmRename();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cancelRename();
        }
      }}
    />
  );

  if (node.entry.is_dir) {
    return (
      <>
        <div
          className={`file-node dir${selected.has(node.entry.path) ? ' selected' : ''}${node.expanded ? ' expanded' : ''}`}
          style={{ paddingLeft: node.depth * 16 + 8 }}
          onClick={handleClick}
          onKeyDown={handleKeydown}
          onContextMenu={handleContextMenu}
          role="treeitem"
          aria-expanded={node.expanded}
          aria-selected={selected.has(node.entry.path)}
          tabIndex={0}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`chevron${node.expanded ? ' rotated' : ''}`}
          >
            <polyline points="9,18 15,12 9,6" />
          </svg>
          <FileIcon name={node.entry.name} isDir={true} />
          {renaming === node.entry.path ? renameInput : <span className="node-name">{node.entry.name}</span>}
          {node.loading && <span className="loading-spinner"></span>}
        </div>
        {creating === node.entry.path && (
          <div className="create-input" style={{ paddingLeft: (node.depth + 1) * 16 + 8 }}>
            <FileIcon name={createValue} isDir={createType === 'dir'} />
            <input
              type="text"
              placeholder={createType === 'file' ? 'filename.ts' : 'folder-name'}
              value={createValue}
              onChange={(e) => creatingValue.set(e.target.value)}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onBlur={cancelCreate}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  confirmCreate();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  cancelCreate();
                }
              }}
            />
          </div>
        )}
        {node.expanded &&
          node.children &&
          node.children.map((child) => <FileNode key={child.entry.path} node={child} />)}
      </>
    );
  }

  return (
    <div
      className={`file-node file${selected.has(node.entry.path) ? ' selected' : ''}`}
      style={{ paddingLeft: node.depth * 16 + 8 }}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeydown}
      onContextMenu={handleContextMenu}
      role="treeitem"
      aria-selected={selected.has(node.entry.path)}
      tabIndex={0}
    >
      <span className="chevron-placeholder"></span>
      <FileIcon name={node.entry.name} isDir={false} />
      {renaming === node.entry.path ? renameInput : <span className="node-name">{node.entry.name}</span>}
    </div>
  );
}

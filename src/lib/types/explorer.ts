export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: string;
}

export interface FileNode {
  entry: FileEntry;
  children: FileNode[] | null;
  expanded: boolean;
  loading: boolean;
  depth: number;
}

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  path: string;
  isDir: boolean;
}

export type FileOperation = 'create_file' | 'create_dir' | 'rename' | 'delete' | 'copy';

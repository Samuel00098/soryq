export type EditorFileKind = 'text' | 'image';

export interface EditorFile {
  path: string;
  content: string;
  originalContent: string;
  isDirty: boolean;
  language: string;
  kind: EditorFileKind;
  imageSrc?: string | null;
  mimeType?: string | null;
  size?: number | null;
}

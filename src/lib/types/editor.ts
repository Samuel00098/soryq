export interface EditorFile {
  path: string;
  content: string;
  originalContent: string;
  isDirty: boolean;
  language: string;
}

export type PanelType = 'terminal' | 'editor' | 'explorer' | 'preview' | 'settings';

export type ActiveView = 'editor' | 'terminal' | 'preview' | 'settings' | 'review';

export type SidebarTab = 'files' | 'git';

export interface LayoutState {
  sidebarVisible: boolean;
  sidebarWidth: number;
  activeView: ActiveView;
  editorSplitPreview: boolean; // show preview panel alongside editor
  sidebarTab: SidebarTab;
  editorVisible: boolean;
  previewVisible: boolean;
  reviewVisible: boolean;
}

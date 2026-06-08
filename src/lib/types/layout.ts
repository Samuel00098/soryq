export type PanelType = 'terminal' | 'editor' | 'explorer' | 'preview' | 'settings';

export type ActiveView = 'editor' | 'terminal' | 'preview' | 'settings' | 'review' | 'http' | 'tasks' | 'orchestrator' | 'db' | 'toolbox';

export type SidebarTab = 'files' | 'git' | 'snapshots' | 'history';

export interface LayoutState {
  sidebarVisible: boolean;
  sidebarWidth: number;
  activeView: ActiveView;
  lastAuxView: ActiveView; // remembers last open right-panel tab for restoration
  editorSplitPreview: boolean; // show preview panel alongside editor
  sidebarTab: SidebarTab;
  editorVisible: boolean;
  previewVisible: boolean;
  reviewVisible: boolean;
  httpVisible: boolean;
  tasksVisible: boolean;
  orchestratorVisible: boolean;
  dbVisible: boolean;
  toolboxVisible: boolean;
  auxPanelWidth: number;
  auxEditorHeight: number; // percentage split between editor and preview panes
}

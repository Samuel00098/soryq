export type PanelType = 'terminal' | 'editor' | 'explorer' | 'preview' | 'settings';

export type ActiveView = 'editor' | 'terminal' | 'preview' | 'settings' | 'review' | 'http' | 'tasks' | 'orchestrator' | 'db' | 'containers' | 'toolbox' | 'pet' | 'youtube' | 'android' | 'ios';

export type SidebarTab = 'files' | 'search' | 'git' | 'snapshots' | 'history' | 'snippets';

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
  containersVisible: boolean;
  toolboxVisible: boolean;
  petVisible: boolean;
  youtubeVisible: boolean;
  androidVisible: boolean;
  iosVisible: boolean;
  auxPanelWidth: number;
  auxEditorHeight: number; // percentage split between editor and preview panes
  rightDrawerWidth: number; // width of the right utility drawer (Toolbox/HTTP/DB/Containers)
}


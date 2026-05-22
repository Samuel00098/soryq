export interface Project {
  id: string;
  name: string;
  root_path: string;
  state: ProjectState;
}

export interface ProjectState {
  open_files: string[];
  active_file: string | null;
  last_modified: string;
}

export interface RecentProject {
  id: string;
  name: string;
  root_path: string;
  last_opened: string;
}

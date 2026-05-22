export interface Theme {
  id: string;
  name: string;
  type: 'dark' | 'light';
  colors: Record<string, string>;
  syntax: Record<string, string>;
}

export interface ThemeInfo {
  id: string;
  name: string;
  type: 'dark' | 'light';
}

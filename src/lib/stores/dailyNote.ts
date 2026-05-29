import { invoke } from '@tauri-apps/api/core';
import { openFile } from '$lib/stores/editor';

function getTodayString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLong(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function getDailyTemplate(date: string): string {
  return `# ${formatDateLong(date)}\n\n## Focus\n\n\n## Notes\n\n\n## Done\n\n`;
}

function alreadyOpenedKey(projectId: string, date: string): string {
  return `soryq_daily_opened_${projectId}_${date}`;
}

export function getDailyNotePath(rootPath: string, date = getTodayString()): string {
  return `${rootPath}/.soryq/daily/${date}.md`;
}

export async function openDailyNote(
  project: { id: string; root_path: string },
  force = false
): Promise<void> {
  const today = getTodayString();
  const key = alreadyOpenedKey(project.id, today);

  if (!force && typeof localStorage !== 'undefined' && localStorage.getItem(key)) return;

  const dir = `${project.root_path}/.soryq/daily`;
  const filePath = getDailyNotePath(project.root_path, today);

  // Ensure directory exists
  try { await invoke('fs_create_dir', { path: dir }); } catch { /* already exists */ }

  // Create file only if it doesn't exist yet
  let fileExists = false;
  try {
    await invoke('fs_get_file_info', { path: filePath });
    fileExists = true;
  } catch { /* not found */ }

  if (!fileExists) {
    await invoke('fs_write_file', { path: filePath, content: getDailyTemplate(today) });
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(key, '1');
  }

  await openFile(filePath);
}

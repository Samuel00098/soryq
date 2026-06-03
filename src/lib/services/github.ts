import { invoke } from '@tauri-apps/api/core';

export interface CreateRepoResult {
  html_url: string;
  full_name: string;
  pushed: boolean;
}

/** True if a GitHub personal access token is saved in the OS keychain. */
export async function githubTokenExists(): Promise<boolean> {
  try {
    return await invoke<boolean>('github_token_exists');
  } catch {
    return false;
  }
}

/** Save the GitHub token to the keychain (pass an empty string to clear it). */
export async function saveGithubToken(token: string): Promise<void> {
  await invoke('github_token_set', { token });
}

export async function deleteGithubToken(): Promise<void> {
  await invoke('github_token_delete');
}

/**
 * Create a new repository on the user's GitHub account, set it as origin for the
 * active project, and push the initial commit.
 */
export async function createGithubRepo(
  projectId: string,
  name: string,
  description: string,
  isPrivate: boolean
): Promise<CreateRepoResult> {
  return await invoke<CreateRepoResult>('workspace_github_create_repo', {
    projectId,
    name,
    description: description || null,
    private: isPrivate,
  });
}

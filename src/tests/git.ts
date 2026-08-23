import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export interface GitMetadata { headSha: string; branch: string | null }

export function readGitMetadata(repoPath: string): GitMetadata {
  const repository = resolve(repoPath);
  const dotGit = join(repository, '.git');
  if (!existsSync(dotGit)) return { headSha: 'unknown', branch: null };
  const gitDirectory = statSync(dotGit).isDirectory()
    ? dotGit
    : resolveGitFile(repository, readFileSync(dotGit, 'utf8').trim());
  const head = readFileSync(join(gitDirectory, 'HEAD'), 'utf8').trim();
  if (!head.startsWith('ref: ')) return { headSha: head || 'unknown', branch: null };
  const ref = head.slice(5);
  const branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
  return { headSha: readRef(gitDirectory, ref) ?? 'unknown', branch };
}

function resolveGitFile(repository: string, content: string): string {
  if (!content.startsWith('gitdir:')) throw new Error(`invalid .git file in ${repository}`);
  return resolve(repository, content.slice('gitdir:'.length).trim());
}

function readRef(gitDirectory: string, ref: string): string | undefined {
  const direct = join(gitDirectory, ref);
  if (existsSync(direct)) return readFileSync(direct, 'utf8').trim();
  const commonDirectory = resolveCommonDirectory(gitDirectory);
  const commonRef = join(commonDirectory, ref);
  if (existsSync(commonRef)) return readFileSync(commonRef, 'utf8').trim();
  const packed = join(commonDirectory, 'packed-refs');
  if (!existsSync(packed)) return undefined;
  const suffix = ` ${ref}`;
  return readFileSync(packed, 'utf8').split(/\r?\n/).find((line) => line.endsWith(suffix))?.split(' ')[0];
}

function resolveCommonDirectory(gitDirectory: string): string {
  const path = join(gitDirectory, 'commondir');
  if (!existsSync(path)) return gitDirectory;
  const value = readFileSync(path, 'utf8').trim();
  return isAbsolute(value) ? value : resolve(dirname(path), value);
}

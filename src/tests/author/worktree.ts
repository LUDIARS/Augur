import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export class WorktreeError extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = 'WorktreeError';
  }
}

export async function withDetachedWorktree<T>(
  repoPath: string,
  sha: string,
  operation: (worktreePath: string) => Promise<T>,
): Promise<T> {
  const repository = resolve(repoPath);
  const directory = mkdtempSync(join(tmpdir(), 'augur-before-'));
  let added = false;
  try {
    await git(repository, ['worktree', 'add', '--detach', directory, sha]);
    added = true;
    return await operation(directory);
  } finally {
    if (added) {
      try {
        await git(repository, ['worktree', 'remove', '--force', directory]);
      } catch {
        rmSync(directory, { recursive: true, force: true });
        await git(repository, ['worktree', 'prune']);
      }
    } else {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

async function git(repoPath: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolveDone, reject) => {
    const child = spawn('git', ['-C', repoPath, ...args], { shell: false, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });
    child.once('error', (error) => reject(new WorktreeError(`git failed to start: ${messageOf(error)}`)));
    child.once('close', (code) => {
      if (code === 0) resolveDone();
      else reject(new WorktreeError(`git ${args.join(' ')} exited ${code ?? 'by signal'}: ${stderr.slice(-2000)}`));
    });
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

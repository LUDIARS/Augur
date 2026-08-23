import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Bus, BusInput, BusOutput } from './types.ts';

type SpawnProcess = typeof spawn;

export class LocalBus implements Bus {
  readonly name: string;
  private readonly spawnProcess: SpawnProcess;

  constructor(name = 'local', spawnProcess: SpawnProcess = spawn) {
    this.name = name;
    this.spawnProcess = spawnProcess;
  }

  async exec(input: BusInput): Promise<BusOutput> {
    const [command, ...args] = input.argv;
    if (command === undefined || command === '') throw new Error('bus argv must not be empty');
    const env = Object.fromEntries(Object.entries(input.env).filter(([key]) => !key.startsWith('AUGUR_')));

    return await new Promise((resolve) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.spawnProcess(command, args, {
          cwd: input.cwd,
          env,
          shell: false,
          windowsHide: true,
          detached: process.platform !== 'win32',
        }) as ChildProcessWithoutNullStreams;
      } catch (error) {
        resolve({ exitCode: null, stdout: '', stderr: messageOf(error), timedOut: false });
        return;
      }

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      child.stdout?.on('data', (chunk: Buffer | string) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });
      child.once('error', (error) => { stderr += `${stderr ? '\n' : ''}${messageOf(error)}`; });
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, input.timeoutMs);
      child.once('close', (exitCode) => {
        clearTimeout(timer);
        resolve({ exitCode, stdout, stderr, timedOut });
      });
    });
  }
}

function killTree(child: ChildProcessWithoutNullStreams): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { shell: false, windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import type { Bus, BusInput, BusOutput } from './types.ts';
import { LocalBus } from './local.ts';

export function posixQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function expandWrapper(
  command: readonly string[],
  input: { argv: readonly string[]; cwd: string },
): string[] {
  const cmd = input.argv.map(posixQuote).join(' ');
  const cwdPosix = posixQuote(toPosixPath(input.cwd));
  return command.map((part) => part
    .replaceAll('{cmd}', cmd)
    .replaceAll('{cwd}', input.cwd)
    .replaceAll('{cwd_posix}', cwdPosix));
}

export class WrapperBus implements Bus {
  readonly name: string;
  private readonly command: readonly string[];
  private readonly executor: Bus;

  constructor(
    name: string,
    command: readonly string[],
    executor: Bus = new LocalBus(name),
  ) {
    this.name = name;
    this.command = command;
    this.executor = executor;
  }

  async exec(input: BusInput): Promise<BusOutput> {
    return await this.executor.exec({ ...input, argv: expandWrapper(this.command, input) });
  }
}

function toPosixPath(value: string): string {
  return value
    .replace(/^([A-Za-z]):/, (_match, drive: string) => `/mnt/${drive.toLowerCase()}`)
    .replaceAll('\\', '/');
}

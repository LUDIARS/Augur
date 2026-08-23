export interface BusOutput {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface BusInput {
  cwd: string;
  argv: string[];
  env: Record<string, string>;
  timeoutMs: number;
}

export interface Bus {
  name: string;
  exec(input: BusInput): Promise<BusOutput>;
}

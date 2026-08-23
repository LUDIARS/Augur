import type { BusConfig } from '../tests/config.ts';
import { LocalBus } from './local.ts';
import type { Bus } from './types.ts';
import { WrapperBus } from './wrapper.ts';

const ESSENTIAL_ENV = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'SystemRoot', 'PATHEXT', 'TEMP', 'TMP'];

export function createBus(name: string, config: BusConfig): Bus {
  return config.type === 'local'
    ? new LocalBus(name)
    : new WrapperBus(name, config.command);
}

export function allowedEnvironment(allowList: readonly string[], source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const allowed = new Set([...ESSENTIAL_ENV, ...allowList]);
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && allowed.has(key) && !key.startsWith('AUGUR_')) output[key] = value;
  }
  return output;
}

export type { Bus, BusInput, BusOutput } from './types.ts';

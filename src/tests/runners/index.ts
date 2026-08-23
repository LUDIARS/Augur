import type { RunnerId } from '../types.ts';
import { commandRunner } from './command.ts';
import { presetRunner } from './presets.ts';
import type { Runner } from './types.ts';
import { vitestRunner } from './vitest.ts';

const RUNNERS: Record<RunnerId, Runner> = {
  vitest: vitestRunner,
  command: commandRunner,
  cargo: presetRunner('cargo'),
  gtest: presetRunner('gtest'),
  unity: presetRunner('unity'),
};

export function getRunner(id: RunnerId): Runner {
  return RUNNERS[id];
}

export type { Invocation, Runner } from './types.ts';

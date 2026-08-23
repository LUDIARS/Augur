import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { busConfigSchema, type BusConfig } from '../tests/config.ts';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

const configFileSchema = z.object({
  port: z.number().int().positive(),
  logLevel: z.enum(LOG_LEVELS),
  buses: z.record(busConfigSchema).default({ local: { type: 'local', env: [] } }),
  repositories: z.record(z.string()).default({}),
  runCache: z.object({
    retentionDays: z.number().nonnegative().default(30),
    maxRunsPerRepository: z.number().int().positive().default(200),
  }).default({}),
  dataDir: z.string().min(1).optional(),
  authoring: z.object({ model: z.string().min(1) }).default({ model: 'claude-sonnet-4-5' }),
}).strict();

type ConfigFile = z.infer<typeof configFileSchema>;
export interface AugurConfig extends Omit<ConfigFile, 'dataDir'> {
  augurFolder: string;
  dataDir: string;
}

const CONFIG_FILE = 'augur.config.json';

export function augurFolder(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function loadConfig(root = augurFolder()): AugurConfig {
  const folder = resolve(root);
  const raw: unknown = JSON.parse(readFileSync(join(folder, CONFIG_FILE), 'utf8'));
  const fileConfig = configFileSchema.parse(raw);
  const configuredDataDir = process.env.AUGUR_DATA_DIR || fileConfig.dataDir || '.augur-data';
  return {
    port: portFromEnv(fileConfig.port),
    logLevel: logLevelFromEnv(fileConfig.logLevel),
    buses: fileConfig.buses,
    repositories: Object.fromEntries(Object.entries(fileConfig.repositories).map(([name, path]) => [
      name,
      isAbsolute(path) ? resolve(path) : resolve(folder, path),
    ])),
    runCache: fileConfig.runCache,
    authoring: fileConfig.authoring,
    augurFolder: folder,
    dataDir: isAbsolute(configuredDataDir) ? resolve(configuredDataDir) : resolve(folder, configuredDataDir),
  };
}

export function resolveBusConfig(
  config: AugurConfig,
  name: string,
  repositoryBuses: Readonly<Record<string, BusConfig>> = {},
): BusConfig {
  const bus = repositoryBuses[name] ?? config.buses[name];
  if (bus === undefined) throw new Error(`unknown bus: ${name}`);
  return bus;
}

function portFromEnv(fileValue: number): number {
  const raw = process.env.AUGUR_PORT;
  if (raw === undefined || raw === '') return fileValue;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`AUGUR_PORT must be a valid port number, got "${raw}"`);
  }
  return port;
}

function logLevelFromEnv(fileValue: ConfigFile['logLevel']): ConfigFile['logLevel'] {
  const raw = process.env.AUGUR_LOG_LEVEL;
  if (raw === undefined || raw === '') return fileValue;
  const parsed = z.enum(LOG_LEVELS).safeParse(raw);
  if (!parsed.success) {
    throw new Error(`AUGUR_LOG_LEVEL must be one of ${LOG_LEVELS.join('/')}, got "${raw}"`);
  }
  return parsed.data;
}

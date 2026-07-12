import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

const configFileSchema = z.object({
  port: z.number().int().positive(),
  logLevel: z.enum(LOG_LEVELS),
});

export type AugurConfig = z.infer<typeof configFileSchema>;

// 統合設定の既定値はリポ管理下の augur.config.json (HARNESS §1)。
// port の正本は Excubitor catalog (Excubitor/catalog/services.yaml) であり、
// ここでの値は写し。Excubitor 起動時は AUGUR_PORT が注入され env が優先される。
const CONFIG_FILE = "augur.config.json";

export function loadConfig(): AugurConfig {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const raw: unknown = JSON.parse(readFileSync(join(repoRoot, CONFIG_FILE), "utf8"));
  const fileConfig = configFileSchema.parse(raw);
  return {
    port: portFromEnv(fileConfig.port),
    logLevel: logLevelFromEnv(fileConfig.logLevel),
  };
}

function portFromEnv(fileValue: number): number {
  const raw = process.env.AUGUR_PORT;
  if (raw === undefined || raw === "") return fileValue;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`AUGUR_PORT must be a valid port number, got "${raw}"`);
  }
  return port;
}

function logLevelFromEnv(fileValue: AugurConfig["logLevel"]): AugurConfig["logLevel"] {
  const raw = process.env.AUGUR_LOG_LEVEL;
  if (raw === undefined || raw === "") return fileValue;
  const parsed = z.enum(LOG_LEVELS).safeParse(raw);
  if (!parsed.success) {
    throw new Error(`AUGUR_LOG_LEVEL must be one of ${LOG_LEVELS.join("/")}, got "${raw}"`);
  }
  return parsed.data;
}

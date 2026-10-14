import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

/**
 * リポジトリの外に置く対象リポの一覧。Augur 自身のリポ (augur.config.json) に対象の名前を書かずに
 * 使えるようにする (対象ごとにリポを変更しない)。既定は dataDir (git 管理外) の repositories.json、
 * AUGUR_REPOSITORIES_FILE で場所を変えられる。ファイルが無ければ何も足さない。
 */
const LOCAL_REPOSITORIES_FILE = 'repositories.json';
const localRepositoriesSchema = z.record(z.string().min(1));

export function localRepositoriesPath(dataDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.AUGUR_REPOSITORIES_FILE;
  if (configured) return isAbsolute(configured) ? resolve(configured) : resolve(dataDir, configured);
  return join(dataDir, LOCAL_REPOSITORIES_FILE);
}

/** ファイルの相対パスはファイルのあるフォルダ基準で解決する。 */
export function loadLocalRepositories(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`local repositories file is not valid JSON: ${(error as Error).message}`);
  }
  const parsed = localRepositoriesSchema.safeParse(raw);
  if (!parsed.success) throw new Error('local repositories file must map "owner/name" to a path');
  const base = resolve(path, '..');
  return Object.fromEntries(Object.entries(parsed.data).map(([name, repoPath]) => [
    name,
    isAbsolute(repoPath) ? resolve(repoPath) : resolve(base, repoPath),
  ]));
}

/** 同じ名前が両方にあれば黙って上書きせず止める。 */
export function mergeRepositories(
  fromConfig: Readonly<Record<string, string>>,
  fromLocal: Readonly<Record<string, string>>,
): Record<string, string> {
  const duplicates = Object.keys(fromLocal).filter((name) => name in fromConfig);
  if (duplicates.length) {
    throw new Error(`repositories defined in both augur.config.json and the local file: ${duplicates.join(', ')}`);
  }
  return { ...fromConfig, ...fromLocal };
}

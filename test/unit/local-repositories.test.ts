import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadLocalRepositories,
  localRepositoriesPath,
  mergeRepositories,
} from '../../src/config/local-repositories.ts';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'augur-local-repos-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('local repositories file', () => {
  it('defaults to repositories.json in the data dir and honours AUGUR_REPOSITORIES_FILE', () => {
    const dataDir = resolve('/data/augur');
    expect(localRepositoriesPath(dataDir, {})).toBe(join(dataDir, 'repositories.json'));
    expect(localRepositoriesPath(dataDir, { AUGUR_REPOSITORIES_FILE: 'targets.json' })).toBe(join(dataDir, 'targets.json'));
    const absolute = resolve('/elsewhere/targets.json');
    expect(localRepositoriesPath(dataDir, { AUGUR_REPOSITORIES_FILE: absolute })).toBe(absolute);
  });

  it('adds nothing when the file does not exist', () => {
    expect(loadLocalRepositories(join(tempDir(), 'repositories.json'))).toEqual({});
  });

  it('resolves relative paths against the file location', () => {
    const dir = tempDir();
    const file = join(dir, 'repositories.json');
    writeFileSync(file, JSON.stringify({ 'Example/Game': '../game', 'Example/Tool': resolve('/abs/tool') }));
    expect(loadLocalRepositories(file)).toEqual({
      'Example/Game': resolve(dir, '../game'),
      'Example/Tool': resolve('/abs/tool'),
    });
  });

  it('fails fast on malformed content instead of ignoring it', () => {
    const dir = tempDir();
    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{ not json');
    expect(() => loadLocalRepositories(broken)).toThrow(/not valid JSON/);
    const wrongShape = join(dir, 'shape.json');
    writeFileSync(wrongShape, JSON.stringify({ 'Example/Game': 1 }));
    expect(() => loadLocalRepositories(wrongShape)).toThrow(/owner\/name/);
  });

  it('merges with augur.config.json and refuses a name defined in both', () => {
    expect(mergeRepositories({ 'Example/Self': '/a' }, { 'Example/Game': '/b' }))
      .toEqual({ 'Example/Self': '/a', 'Example/Game': '/b' });
    expect(() => mergeRepositories({ 'Example/Self': '/a' }, { 'Example/Self': '/b' }))
      .toThrow(/both augur\.config\.json and the local file: Example\/Self/);
  });
});

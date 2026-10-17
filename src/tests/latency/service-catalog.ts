import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Reads Excubitor catalog fragments (`<repo>/excubitor.catalog.yaml`, the only
// port source per Excubitor catalog/FRAGMENTS.md). Ports are never hard-coded
// or read from service-local config. The parser understands only the fragment
// shape Augur needs: `services:` list items and their top-level `code` / `port`.

export const FRAGMENT_FILE = 'excubitor.catalog.yaml';

export interface CatalogService {
  code: string;
  port?: number;
}

export type BaseUrlResolution = { baseUrl: string; code: string } | { error: string };

export function parseCatalogFragment(text: string): CatalogService[] {
  const services: CatalogService[] = [];
  let inServices = false;
  let itemIndent: number | undefined;
  let current: CatalogService | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').replace(/^#.*$/, '');
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      inServices = /^services\s*:\s*$/.test(line);
      itemIndent = undefined;
      continue;
    }
    if (!inServices) continue;
    const item = /^(\s*)-\s+(.*)$/.exec(line);
    if (item !== null && (itemIndent === undefined || item[1]!.length === itemIndent)) {
      itemIndent = item[1]!.length;
      current = { code: '' };
      services.push(current);
      assignField(current, item[2]!);
      continue;
    }
    if (current !== undefined && itemIndent !== undefined && indent === itemIndent + 2) assignField(current, line.trim());
  }
  return services.filter((service) => service.code !== '');
}

export function readRepoServices(repoPath: string): CatalogService[] {
  const file = join(resolve(repoPath), FRAGMENT_FILE);
  if (!existsSync(file)) return [];
  return parseCatalogFragment(readFileSync(file, 'utf8'));
}

/** `ARS_ROOT`, or the directory that holds the Augur checkout (its siblings are the other services). */
export function defaultArsRoot(): string {
  return resolve(process.env.ARS_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..'));
}

/**
 * Resolves a service's loopback base URL by scanning `<arsRoot>/<child>/excubitor.catalog.yaml`
 * one level deep, like Excubitor. A code declared by more than one fragment is
 * rejected (fail-closed) rather than resolved first-wins.
 */
export function resolveServiceBaseUrl(code: string, arsRoot = defaultArsRoot()): BaseUrlResolution {
  const hits: Array<{ fragment: string; service: CatalogService }> = [];
  let children: string[];
  try {
    children = readdirSync(arsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    return { error: `Excubitor catalog root ${arsRoot} is unreadable: ${error instanceof Error ? error.message : String(error)}` };
  }
  for (const child of children) {
    const fragment = join(arsRoot, child, FRAGMENT_FILE);
    if (!existsSync(fragment)) continue;
    let services: CatalogService[];
    try {
      services = parseCatalogFragment(readFileSync(fragment, 'utf8'));
    } catch {
      continue;
    }
    for (const service of services) if (service.code === code) hits.push({ fragment, service });
  }
  if (hits.length === 0) return { error: `no Excubitor catalog fragment under ${arsRoot} declares service code "${code}"` };
  if (hits.length > 1) return { error: `service code "${code}" is declared by ${hits.length} fragments (${hits.map((hit) => hit.fragment).join(', ')}); refusing to pick one` };
  return baseUrlFor(hits[0]!.service, hits[0]!.fragment);
}

export function baseUrlFor(service: CatalogService, origin = FRAGMENT_FILE): BaseUrlResolution {
  if (service.port === undefined) return { error: `service "${service.code}" in ${origin} declares no port` };
  // Augur measures from the same host; services bind loopback (see the fragments' health URLs).
  return { baseUrl: `http://127.0.0.1:${service.port}`, code: service.code };
}

function assignField(service: CatalogService, text: string): void {
  const field = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(text);
  if (field === null) return;
  const value = unquote(field[2]!.trim());
  if (field[1] === 'code') service.code = value;
  if (field[1] === 'port') {
    const port = Number(value);
    if (Number.isInteger(port) && port > 0 && port < 65536) service.port = port;
  }
}

function unquote(value: string): string {
  return /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;
}

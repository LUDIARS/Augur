import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { EntryPointGraph } from '../anatomia.ts';

// HTTP routes from Anatomia's entry-point graph (`class: http-route`). The
// graph's summary rows carry the handler symbol but not the verb or path, so
// the shape is recovered from Anatomia's own reason text when present, and
// otherwise from the handler's source (the same registration shapes Anatomia's
// http-route detector matches). A route whose shape cannot be recovered is
// skipped with that reason, never guessed.

export interface HttpRoute {
  anchor: string;
  symbol: string;
  file: string;
  line: number;
  method?: string;
  path?: string;
}

export interface RouteSkip {
  route: HttpRoute;
  reason: string;
}

export interface RouteSelection {
  probes: Array<HttpRoute & { method: string; path: string }>;
  skipped: RouteSkip[];
}

const HTTP_VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'ALL'];
const REASON_SHAPE = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|ALL)\s+(\S*)\s+→/;
const NEXT_ROUTE_FILE = /(?:^|\/)app\/(.*)\/route\.[jt]sx?$/;
const NEXT_API_FILE = /(?:^|\/)pages\/(api\/.+)\.[jt]sx?$/;

export function httpRoutesFrom(graph: EntryPointGraph, readSource: (file: string) => string | undefined): HttpRoute[] {
  return graph.entries
    .filter((entry) => entry.classes.includes('http-route'))
    .map((entry): HttpRoute => {
      const base = { anchor: entry.symbol.anchor, symbol: entry.symbol.name, file: normalizePath(entry.symbol.path), line: entry.symbol.line };
      const shape = shapeFromReasons(entry.reasons ?? []) ?? shapeFromSource(base, readSource(base.file));
      return shape === undefined ? base : { ...base, ...shape };
    })
    .sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.symbol.localeCompare(right.symbol));
}

export function repoSourceReader(repoPath: string): (file: string) => string | undefined {
  const root = resolve(repoPath);
  return (file) => {
    const path = join(root, file);
    if (!path.startsWith(root) || !existsSync(path)) return undefined;
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }
  };
}

/** Only argument-free GET routes are measured; everything else is skipped with its reason. */
export function selectProbes(routes: readonly HttpRoute[]): RouteSelection {
  const probes: RouteSelection['probes'] = [];
  const skipped: RouteSkip[] = [];
  for (const route of routes) {
    if (route.method === undefined || route.path === undefined) {
      skipped.push({ route, reason: `route method/path could not be recovered for ${route.symbol} (${route.file}:${route.line})` });
    } else if (route.method !== 'GET' && route.method !== 'ALL') {
      skipped.push({ route, reason: `${route.method} route; only GET routes are measured` });
    } else if (!route.path.startsWith('/') || /[:*{[]/.test(route.path)) {
      skipped.push({ route, reason: `path ${route.path} takes arguments` });
    } else {
      probes.push({ ...route, method: 'GET', path: route.path });
    }
  }
  return { probes: dedupe(probes), skipped };
}

function shapeFromReasons(reasons: readonly string[]): { method: string; path: string } | undefined {
  for (const reason of reasons) {
    const match = REASON_SHAPE.exec(reason);
    if (match !== null) return { method: match[1]!, path: match[2]! };
  }
  return undefined;
}

function shapeFromSource(route: Omit<HttpRoute, 'method' | 'path'>, source: string | undefined): { method: string; path?: string } | undefined {
  const nextRoute = NEXT_ROUTE_FILE.exec(route.file);
  if (nextRoute !== null && HTTP_VERBS.includes(route.symbol)) {
    return { method: route.symbol, path: `/${nextRoute[1]!.split('/').filter((segment) => !/^\(.*\)$/.test(segment)).join('/')}` };
  }
  const nextApi = NEXT_API_FILE.exec(route.file);
  if (nextApi !== null) return { method: 'ALL', path: `/${nextApi[1]!.replace(/\/index$/, '')}` };
  if (source === undefined) return undefined;
  const call = new RegExp(
    String.raw`\b(?:app|router|server|api)\s*\.\s*(get|post|put|patch|delete|options|head|all)\s*\(\s*[\`'"]([^\`'"]*)[\`'"]\s*,\s*${escapeRegExp(route.symbol)}\s*[,)]`,
  );
  const match = call.exec(source);
  return match === null ? undefined : { method: match[1]!.toUpperCase(), path: match[2]! };
}

function dedupe(probes: RouteSelection['probes']): RouteSelection['probes'] {
  const seen = new Set<string>();
  return probes.filter((probe) => {
    if (seen.has(probe.path)) return false;
    seen.add(probe.path);
    return true;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

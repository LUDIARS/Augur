import { z } from 'zod';

// Client for the Elegantia antipattern catalog (GET /api/antipatterns). The
// base URL comes from the Excubitor catalog (service code `elegantia`); this
// module never guesses a port. Every failure is returned as a value so the
// plan records it instead of silently planning as if Elegantia had no items.

const augurBudgetSchema = z.object({
  metric: z.string().min(1),
  threshold: z.number(),
  unit: z.string().min(1),
  percentile: z.number().optional(),
  scope: z.string().optional(),
}).passthrough();

const antipatternSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  augur: augurBudgetSchema.nullable().optional(),
}).passthrough();

const antipatternsResponseSchema = z.object({ items: z.array(antipatternSchema) }).passthrough();

export type ElegantiaAntipattern = z.infer<typeof antipatternSchema>;

export type ElegantiaSource =
  | { status: 'ok'; baseUrl: string; items: ElegantiaAntipattern[] }
  | { status: 'unresolved' | 'unreachable' | 'invalid'; detail: string; baseUrl?: string };

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const ANTIPATTERNS_PATH = '/api/antipatterns';
const DEFAULT_TIMEOUT_MS = 3000;

export async function fetchAntipatterns(
  baseUrl: { baseUrl: string } | { error: string },
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ElegantiaSource> {
  if ('error' in baseUrl) return { status: 'unresolved', detail: baseUrl.error };
  const url = `${baseUrl.baseUrl.replace(/\/+$/, '')}${ANTIPATTERNS_PATH}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(url, { signal: controller.signal });
  } catch (error) {
    return { status: 'unreachable', baseUrl: baseUrl.baseUrl, detail: `GET ${url} failed: ${messageOf(error)}` };
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) return { status: 'unreachable', baseUrl: baseUrl.baseUrl, detail: `GET ${url} returned HTTP ${response.status}` };
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return { status: 'invalid', baseUrl: baseUrl.baseUrl, detail: `GET ${url} returned invalid JSON: ${messageOf(error)}` };
  }
  const parsed = antipatternsResponseSchema.safeParse(body);
  if (!parsed.success) return { status: 'invalid', baseUrl: baseUrl.baseUrl, detail: `GET ${url} broke the antipattern contract: ${parsed.error.message}` };
  return { status: 'ok', baseUrl: baseUrl.baseUrl, items: [...parsed.data.items].sort((left, right) => left.id.localeCompare(right.id)) };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

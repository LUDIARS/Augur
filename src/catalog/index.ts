import type { ExperienceQuality, ProjectDomain } from '../schema/index.ts';
import { commonEntries } from './common.ts';
import { gameEntries } from './game.ts';
import type { CatalogEntry } from './types.ts';
import { webEntries } from './web.ts';

export type { CatalogDomain, CatalogEntry, CatalogKeyResult, CatalogTestPattern } from './types.ts';

export const allEntries: CatalogEntry[] = [...commonEntries, ...webEntries, ...gameEntries];

const byQuality = new Map(allEntries.map((entry) => [entry.quality, entry]));

export function entryForQuality(quality: ExperienceQuality): CatalogEntry | undefined {
  return byQuality.get(quality as Exclude<ExperienceQuality, 'custom'>);
}

// Domain filtering per spec/data/experience-goal-catalog.md: common always
// applies; web and game sections contribute default proposals only when the
// project domain matches. Explicit caller references bypass this filter.
export function domainAllowsProposals(entry: CatalogEntry, domain: ProjectDomain | undefined): boolean {
  if (entry.domain === 'common') return true;
  return entry.domain === domain;
}

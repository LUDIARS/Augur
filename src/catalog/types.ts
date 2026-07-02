import type { ExperienceQuality, ExperienceTarget, TestKind } from '../schema/index.ts';

// Executable mirror of spec/data/experience-goal-catalog.md.
// Consistency tests assert this data matches the spec document.

export type CatalogDomain = 'common' | 'web' | 'game';

export type CatalogKeyResult = {
  id: string; // "KR-C01a"
  target: ExperienceTarget;
  note: string; // human framing of the budget, e.g. "per interactive request"
};

export type CatalogTestPattern = {
  id: string; // "TP-C01-1"
  kind: TestKind;
  title: string;
  draft: string; // Given/When/Then template
  verifiesKeyResults: string[]; // KR ids, the --verified-by--> relation
};

export type CatalogEntry = {
  id: string; // "EG-C01"
  quality: Exclude<ExperienceQuality, 'custom'>;
  domain: CatalogDomain;
  feel: string;
  objective: string;
  keyResults: CatalogKeyResult[];
  patterns: CatalogTestPattern[];
  typicalExemptions: string[];
};

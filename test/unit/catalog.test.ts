import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allEntries } from '../../src/catalog/index.ts';
import { ruleRegistry } from '../../src/engine/rules/index.ts';
import { experienceQualitySchema, objectiveKindSchema } from '../../src/schema/index.ts';

// Consistency tests guarding the executable mirror of
// spec/data/experience-goal-catalog.md (spec/implementation-design.md).

describe('catalog consistency', () => {
  it('covers every quality union member except custom, exactly once', () => {
    const qualities = experienceQualitySchema.options.filter((quality) => quality !== 'custom');
    const covered = allEntries.map((entry) => entry.quality);
    expect([...covered].sort()).toEqual([...qualities].sort());
    expect(new Set(covered).size).toBe(covered.length);
  });

  it('uses ids that appear in the spec document', () => {
    const spec = readFileSync(new URL('../../spec/data/experience-goal-catalog.md', import.meta.url), 'utf8');
    for (const entry of allEntries) {
      expect(spec, `missing ${entry.id}`).toContain(entry.id);
      for (const keyResult of entry.keyResults) {
        expect(spec, `missing ${keyResult.id}`).toContain(keyResult.id);
      }
      for (const pattern of entry.patterns) {
        expect(spec, `missing ${pattern.id}`).toContain(pattern.id);
      }
    }
  });

  it('links every test pattern to key results that exist on its entry', () => {
    for (const entry of allEntries) {
      const keyResultIds = new Set(entry.keyResults.map((keyResult) => keyResult.id));
      for (const pattern of entry.patterns) {
        expect(pattern.verifiesKeyResults.length).toBeGreaterThan(0);
        for (const id of pattern.verifiesKeyResults) {
          expect(keyResultIds.has(id), `${pattern.id} references unknown ${id}`).toBe(true);
        }
      }
    }
  });

  // Note: the spec intentionally leaves some key results without a dedicated
  // test pattern (their enforcement is budget comparison, not a TP), so
  // there is no "every KR has a pattern" assertion here.
});

describe('rule registry', () => {
  it('is total over objective kinds', () => {
    for (const kind of objectiveKindSchema.options) {
      expect(ruleRegistry[kind], `missing rule module for ${kind}`).toBeDefined();
      expect(ruleRegistry[kind].kind).toBe(kind);
    }
  });
});

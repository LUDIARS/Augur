import type { ObjectiveKind } from '../../schema/index.ts';
import type { RuleModule } from '../types.ts';
import { bugFixRule } from './bugFix.ts';
import { newFeatureRule } from './newFeature.ts';
import { performanceRule } from './performance.ts';
import { refactorRule } from './refactor.ts';
import { regressionRule } from './regression.ts';
import { securityRule } from './security.ts';
import { stabilityRule } from './stability.ts';
import { unknownRule } from './unknown.ts';

// Every objective kind maps to exactly one module; a unit test asserts the
// registry is total (spec/implementation-design.md, "Rule modules").
export const ruleRegistry: Record<ObjectiveKind, RuleModule> = {
  new_feature: newFeatureRule,
  bug_fix: bugFixRule,
  regression: regressionRule,
  refactor: refactorRule,
  performance: performanceRule,
  stability: stabilityRule,
  security: securityRule,
  unknown: unknownRule,
};

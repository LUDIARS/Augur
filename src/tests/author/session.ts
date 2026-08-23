import { authorResultSchema, type AuthorResult, type TestPlan } from '../types.ts';

export function sessionAuthor(plan: TestPlan): AuthorResult {
  return authorResultSchema.parse({
    planId: plan.planId,
    author: 'session',
    briefs: plan.targets.map((target) => ({ key: target.key, file: target.file, brief: target.brief })),
    authored: [],
    failed: [],
    dropped: [],
  });
}

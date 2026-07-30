# Review Plan CLI

## Purpose

`augur review-plan` answers one question for a code-review system: **which
checks does this specific change need?** It is the control-planner contract
Revisor calls at the start of every local pull-request review, so a
documentation edit stops paying for a vulnerability pass and a full test suite
while a change that touches executable code keeps everything.

Augur already owns purpose-driven test planning. This subcommand exposes that
judgement to a caller that owns the execution, rather than having the caller
reimplement it.

Augur decides nothing about safety. The caller enforces a floor the plan cannot
cross; see [Safety floor](#safety-floor).

## Command

```text
augur review-plan --json
```

The request arrives on **stdin** as one JSON document. The plan is written to
**stdout** as one JSON document. `--json` is accepted and is the only supported
output shape; it is required by the caller and may be omitted when a human runs
the command by hand.

No flags gather local signals: the caller has already produced the change
profile from a fixed SHA in a disposable worktree, and re-deriving it would risk
disagreeing with the review that is about to run.

## Request

```json
{
  "version": 1,
  "repository": "LUDIARS/Revisor",
  "pullRequest": { "number": 8, "title": null },
  "changeProfile": {
    "kinds": ["docs"],
    "counts": { "docs": 3 },
    "changedFiles": 3,
    "changedLines": 84,
    "docsOnly": true,
    "touchesSpec": true,
    "runtimeSurfaces": []
  },
  "stages": [
    { "id": "leakage_scan", "run": true, "reason": "情報流出検査は必須です" },
    { "id": "security_review", "run": false, "reason": "実行コードを含みません" }
  ],
  "testCases": [
    { "name": "unit", "kinds": null, "runtime": false, "always": false },
    { "name": "docs-lint", "kinds": ["docs"], "runtime": false, "always": false }
  ],
  "stageIds": ["leakage_scan", "registered_tests", "anatomia_code_analysis",
               "anatomia_domain_review", "spec_requirements", "security_review",
               "reviewer_autofix"]
}
```

| Field | Meaning |
| --- | --- |
| `version` | Contract version. Reject an unknown major version rather than guessing. |
| `changeProfile.kinds` | Change kinds present: `code`, `docs`, `test`, `config`, `infra`, `asset`, `generated`. |
| `changeProfile.runtimeSurfaces` | Surfaces a unit test cannot stand in for: `migration`, `entrypoint`, `ui`, `infra`. |
| `stages` | The caller's deterministic plan, with its reasoning. This is the floor to adjust, not a blank slate. |
| `testCases` | Registered cases and their declared coverage. `kinds: null` means the case declared none. |
| `stageIds` | Every valid stage id. Ids outside this list are invalid. |

Diffs, file paths, and file contents are **not** in the request and must never
be asked for: the caller keeps them local, and a planner does not need them to
decide which checks a change kind deserves.

## Response

```json
{
  "stages": [
    { "id": "anatomia_code_analysis", "run": false, "reason": "実行コードを含まない変更です" },
    { "id": "security_review", "run": false, "reason": "文章のみの変更で攻撃面が動きません" }
  ],
  "testCases": ["docs-lint", "check"]
}
```

- `stages` — only the stages to change. An omitted stage keeps the caller's
  decision. `reason` is shown to a human and should say why *this change*, not
  why the rule exists.
- `testCases` — the full set of registered case names to run. Omit the field to
  keep the caller's selection. Unknown names are ignored by the caller.

Both fields are advisory. The caller applies them through its safety floor.

## Safety floor

Enforced by the caller (`Revisor: src/review-plan.mjs`), stated here so the
planner does not waste effort proposing what will be refused:

- The information-leakage scan, the domain review, the spec-requirement check and
  the opposite-provider review **always run**. A request to skip them is
  recorded as refused.
- A change containing executable content (`code`, `infra`, `config`, `test`)
  **keeps its test coverage**. The planner may add cases, never remove them.
- Only `anatomia_code_analysis`, `security_review`, and — on a change with no
  executable content — `registered_tests` may be turned off.
- Every stage the planner turns off raises the caller's merge-risk score, so a
  cheaper review is not presented as an equally safe one.

## Exit codes

- `0` — a plan was written to stdout.
- `1` — usage or validation error (bad stdin, unknown `version`); message on
  stderr.
- `2` — unexpected internal error.

**Any non-zero exit, unparseable output, or timeout leaves the caller's
deterministic plan in force.** A broken planner must never be able to stop a
review, so failing loudly on stderr and exiting non-zero is the correct
behaviour when in doubt — never a partial plan.

## Mapping onto the engine

`review-plan` builds a `CreatePlanRequest` from the change profile and calls
`createPlan`, the same entry point `augur plan` uses:

- `objective.kind` — inferred from the change profile (`docs`-only →
  `unknown` with a documentation description; a change with `migration` or
  `entrypoint` surfaces → `stability`; otherwise the caller-neutral default).
- `project.testRunners` / `change.changedFiles` — not available and not needed;
  the profile's counts and kinds carry the same decision weight here.
- The plan's suggestions and risks are reduced to stage decisions: a suggestion
  that names no executable target is evidence that code analysis and the
  vulnerability pass buy nothing for this change.

The reduction lives in `src/cli/reviewPlan.ts`. **The engine gains no knowledge
of review stages** — that would put a caller's vocabulary inside the planner.

## Constraints

- No network, no test execution, no repository mutation, no source reading.
- stdout carries the JSON document and nothing else.
- Deterministic: the same request produces the same plan, so a re-review does
  not silently change which checks ran.

## Related Specs

- [CLI](./cli.md)
- [Daemon-less CLI](../plan/daemonless-cli.md)
- [Planning Engine](../feature/planning-engine.md)
- [Focused Testing](../feature/focused-testing.md)
- Revisor: `spec/feature/review-plan.md` — the caller's side of this contract

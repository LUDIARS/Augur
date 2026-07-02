# Experience Goal Catalog

This catalog is the canonical vocabulary of experience qualities. Each entry is written in OKR style — an Objective stating the feel, Key Results stating default measurable budgets — followed by test case patterns and explicit relations.

How the catalog maps to the [Core Data Schema](./core-schema.md):

- Each entry's id (`EG-xx`) corresponds to one `ExperienceGoal.quality` value.
- Each Key Result (`KR-xx`) is a default `ExperienceTarget` that Augur proposes when the caller supplies the quality without explicit targets. Proposed budgets are always labeled per [Experience-Driven Constraints](../feature/experience-driven-constraints.md).
- Each Test Pattern (`TP-xx`) is a template Augur instantiates as a `TestSuggestion`, carrying the resolved budget in the suggestion's `budget` field. Execution always belongs to external runners.
- "Typical exemptions" list scopes where the strict budget usually does not apply — the raw material for caller-supplied or LLM-proposed `ExperienceExemption`s.

Relation vocabulary used throughout:

```text
EG --realized-by--> KR    (a feel becomes a measurable budget)
KR --verified-by--> TP    (a budget becomes an enforceable test)
EG --usually-exempts--> scope
```

---

## EG-01 `responsiveness` — Responsiveness (即応性)

Feel: "feels instant", "reacts the moment I touch it", "no lag when typing".

**Objective:** every user input is answered before the user perceives a wait.

Key Results:

- KR-01a: `api_latency` p95 ≤ 100ms per interactive request.
- KR-01b: `time_to_feedback` ≤ 100ms from input to first visible reaction.
- KR-01c: `task_completion` ≤ 1000ms for a single user-perceived task.

Typical exemptions: authentication (login, registration), checkout/payment, report generation, batch exports.

Test case patterns:

- **TP-01-1 Latency guardrail** (kind: `performance`) — Given the target endpoint under a fixed load profile, when N requests are measured externally, then p95 latency must be within the budget.
- **TP-01-2 Input-to-reaction** (kind: `e2e`) — Given the page is idle, when the user types into the target input, then the first visible DOM change must occur within the budget.
- **TP-01-3 Hot-path regression pin** (kind: `regression`) — Given a recorded baseline p95 for the hot path, when the current build is measured, then latency must not regress beyond the agreed tolerance.

Relations:

```text
EG-01 --realized-by--> KR-01a, KR-01b, KR-01c
KR-01a --verified-by--> TP-01-1, TP-01-3
KR-01b --verified-by--> TP-01-2
EG-01 --usually-exempts--> auth, checkout, report generation
```

---

## EG-02 `smoothness` — Smoothness (なめらかさ)

Feel: "scrolling is buttery", "animations don't stutter", "no jank".

**Objective:** motion on screen never visibly hitches.

Key Results:

- KR-02a: `frame_time` ≤ 16.7ms sustained during interaction (60fps).
- KR-02b: `long_task_count` = 0 tasks over 50ms on the main thread during interaction.
- KR-02c: `dropped_frame_ratio` < 1% during scripted scroll or animation.

Typical exemptions: initial data import screens, developer/admin tooling views.

Test case patterns:

- **TP-02-1 Scroll trace guardrail** (kind: `performance`) — Given a scripted scroll over representative content, when a frame trace is recorded externally, then the dropped-frame ratio must stay within the budget.
- **TP-02-2 Long-task audit** (kind: `integration`) — Given the key interaction is triggered, when main-thread tasks are traced, then no task may exceed 50ms.

Relations:

```text
EG-02 --realized-by--> KR-02a, KR-02b, KR-02c
KR-02c --verified-by--> TP-02-1
KR-02b --verified-by--> TP-02-2
```

---

## EG-03 `feedback` — Feedback (操作への応答)

Feel: "I know it heard me", "the button reacts when pressed", "no silent clicks".

**Objective:** every user action is visibly acknowledged, even when the result takes longer.

Key Results:

- KR-03a: `time_to_feedback` ≤ 100ms for a visible pending or acknowledgement state.
- KR-03b: `unacknowledged_action_count` = 0 — every async mutation path has an in-flight UI state.

Typical exemptions: background sync, prefetching, telemetry — actions the user did not explicitly perform.

Test case patterns:

- **TP-03-1 Acknowledgement timing** (kind: `e2e`) — Given a mutating action (submit, delete), when the user triggers it, then a pending indicator must appear within the budget even under throttled network.
- **TP-03-2 In-flight state contract** (kind: `contract`) — Given the UI state machine, when any mutation is dispatched, then a corresponding in-flight state must exist and be rendered.

Relations:

```text
EG-03 --realized-by--> KR-03a, KR-03b
KR-03a --verified-by--> TP-03-1
KR-03b --verified-by--> TP-03-2
```

---

## EG-04 `stability_feel` — Stability Feel (安定感)

Feel: "never crashes", "nothing jumps around", "it doesn't lose my input".

**Objective:** the product never betrays the user's trust mid-task.

Key Results:

- KR-04a: `crash_count` = 0 across the critical flows.
- KR-04b: `unhandled_error_rate` ≤ 0.1% of sessions.
- KR-04c: `layout_shift` (CLS) ≤ 0.1 on interactive pages.

Typical exemptions: experimental feature-flagged surfaces explicitly marked beta.

Test case patterns:

- **TP-04-1 Critical-flow soak** (kind: `flaky`) — Given the critical flow, when it is repeated N times consecutively by the external runner, then zero runs may fail or crash.
- **TP-04-2 Error-boundary coverage** (kind: `integration`) — Given a component throws, when rendering continues, then the failure is contained and user input elsewhere is preserved.
- **TP-04-3 Layout-shift guardrail** (kind: `e2e`) — Given the page loads with realistic data, when CLS is measured externally, then it must stay within the budget.

Relations:

```text
EG-04 --realized-by--> KR-04a, KR-04b, KR-04c
KR-04a --verified-by--> TP-04-1
KR-04b --verified-by--> TP-04-2
KR-04c --verified-by--> TP-04-3
```

---

## EG-05 `consistency` — Consistency (一貫性)

Feel: "always takes about the same time", "predictable", "no random slow days".

**Objective:** the same action feels the same every time.

Key Results:

- KR-05a: latency spread `p99 ≤ 3 × p50` for the same interaction.
- KR-05b: `cross_run_variance` — repeated identical requests stay within an agreed variance band.

Typical exemptions: first-call-after-deploy warmup, cold caches explicitly communicated to the user.

Test case patterns:

- **TP-05-1 Spread guardrail** (kind: `performance`) — Given a latency distribution collected externally over N requests, when percentiles are computed, then p99 must stay within the multiplier budget of p50.
- **TP-05-2 Repeat-identity check** (kind: `integration`) — Given the same request issued repeatedly, when responses are compared, then results and timing class must be stable.

Relations:

```text
EG-05 --realized-by--> KR-05a, KR-05b
KR-05a --verified-by--> TP-05-1
KR-05b --verified-by--> TP-05-2
```

---

## EG-06 `startup_readiness` — Startup Readiness (立ち上がりの速さ)

Feel: "opens ready to use", "no long splash screen", "usable immediately".

**Objective:** the product is usable the moment the user arrives.

Key Results:

- KR-06a: `time_to_interactive` ≤ 2000ms cold start.
- KR-06b: `first_meaningful_content` ≤ 1000ms.
- KR-06c: `bundle_size` within the agreed budget (proxy metric guarding KR-06a).

Typical exemptions: first-run setup wizards, initial sync after install.

Test case patterns:

- **TP-06-1 Cold-start measurement** (kind: `performance`) — Given a cleared cache environment, when the app is launched by the external runner, then time-to-interactive must be within the budget.
- **TP-06-2 Bundle budget** (kind: `contract`) — Given a production build, when asset sizes are computed, then each entry bundle must stay within its size budget.

Relations:

```text
EG-06 --realized-by--> KR-06a, KR-06b, KR-06c
KR-06a --verified-by--> TP-06-1
KR-06c --verified-by--> TP-06-2
EG-06 --usually-exempts--> first-run setup, initial sync
```

---

## EG-07 `progress_transparency` — Progress Transparency (待たせ方の上手さ)

Feel: "I can see it's working", "no dead silence", "I know how long it will take".

**Objective:** when the product must be slow, the user is never left guessing.

Key Results:

- KR-07a: any operation expected to exceed 1000ms shows progress within 500ms.
- KR-07b: operations expected to exceed 10s show determinate progress or an estimate.
- KR-07c: `silent_timeout_count` = 0 — every timeout path surfaces a message with a next step.

Typical exemptions: sub-second operations (covered by EG-01 instead).

Test case patterns:

- **TP-07-1 Slow-path indicator** (kind: `e2e`) — Given network throttled to simulate the slow case, when the long operation starts, then a progress indicator must appear within 500ms.
- **TP-07-2 Timeout messaging** (kind: `integration`) — Given the upstream dependency times out, when the failure surfaces, then the user sees an explanation and a retry affordance, never a silent hang.

Relations:

```text
EG-07 --realized-by--> KR-07a, KR-07b, KR-07c
KR-07a --verified-by--> TP-07-1
KR-07c --verified-by--> TP-07-2
EG-07 --usually-exempts--> sub-second operations (handled by EG-01)
```

---

## EG-08 `recoverability` — Recoverability (やり直せる安心感)

Feel: "mistakes are cheap", "I can undo", "an error doesn't wipe my work".

**Objective:** no single mistake or transient failure costs the user their work.

Key Results:

- KR-08a: destructive actions are undoable or explicitly confirmed — `unguarded_destructive_actions` = 0.
- KR-08b: `input_loss_on_error` = 0 — form state survives a failed submit.
- KR-08c: a retry after one transient failure succeeds without re-entry.

Typical exemptions: explicitly irreversible domain actions (e.g., sending an email) where confirmation, not undo, is the guarantee.

Test case patterns:

- **TP-08-1 Failed-submit preservation** (kind: `e2e`) — Given a filled form, when the first submit fails with a server error, then all entered values remain and a second submit succeeds.
- **TP-08-2 Undo contract** (kind: `contract`) — Given each destructive action in the API surface, when enumerated, then each must map to an undo operation or a confirmation step.

Relations:

```text
EG-08 --realized-by--> KR-08a, KR-08b, KR-08c
KR-08b --verified-by--> TP-08-1
KR-08a --verified-by--> TP-08-2
```

---

## EG-09 `continuity` — Continuity (続きから使える)

Feel: "picks up where I left off", "reload doesn't reset me", "offline didn't eat my edits".

**Objective:** interruption never resets the user's context.

Key Results:

- KR-09a: reload restores task state — `state_loss_on_reload` = 0 for in-progress work.
- KR-09b: edits made while offline are queued and applied on reconnect.
- KR-09c: session expiry mid-task preserves work through re-authentication.

Typical exemptions: intentionally ephemeral surfaces (incognito-style modes, one-time previews).

Test case patterns:

- **TP-09-1 Reload persistence** (kind: `e2e`) — Given in-progress work, when the page reloads, then the user returns to the same state within one interaction.
- **TP-09-2 Offline queue** (kind: `integration`) — Given the network drops mid-edit, when connectivity returns, then queued changes apply exactly once.

Relations:

```text
EG-09 --realized-by--> KR-09a, KR-09b, KR-09c
KR-09a --verified-by--> TP-09-1
KR-09b --verified-by--> TP-09-2
```

---

## EG-10 `freshness` — Freshness (情報の新しさ)

Feel: "what I see is up to date", "no stale results", "my change shows up immediately".

**Objective:** the screen never shows the user a lie about current state.

Key Results:

- KR-10a: `staleness_after_mutation` ≤ 1000ms — a user's own change is visible within the budget.
- KR-10b: cache invalidation fires on every mutation that affects displayed data.
- KR-10c: cleared or reset inputs never leave residual results (see the stale-search example in the [HTTP API](../interface/http-api.md)).

Typical exemptions: analytics dashboards with a declared refresh interval, eventually-consistent views that display their own timestamp.

Test case patterns:

- **TP-10-1 Read-your-own-write** (kind: `integration`) — Given the user mutates data, when the affected view re-renders, then the new value is visible within the budget.
- **TP-10-2 Stale-reset regression** (kind: `regression`) — Given results are displayed, when the query or filter is cleared, then displayed results reset instead of persisting.
- **TP-10-3 Invalidation contract** (kind: `contract`) — Given each mutation in the API surface, when enumerated, then each must declare which cached views it invalidates.

Relations:

```text
EG-10 --realized-by--> KR-10a, KR-10b, KR-10c
KR-10a --verified-by--> TP-10-1
KR-10c --verified-by--> TP-10-2
KR-10b --verified-by--> TP-10-3
EG-10 --usually-exempts--> dashboards with declared refresh intervals
```

---

## Using the Catalog

- Default budgets here are starting points, not verdicts. Callers override them with explicit `ExperienceTarget`s, and exemptions narrow where they apply.
- When Augur instantiates a `TP-xx` pattern, the suggestion's `rationale` must cite the `EG → KR → TP` relation that produced it, and its `evidenceIds` must reference the originating `experience_goal` evidence.
- New qualities enter the catalog by adding an `EG-xx` entry **and** extending the `ExperienceGoal.quality` union in the [Core Data Schema](./core-schema.md) in the same change.

## Related Specs

- [Core Data Schema](./core-schema.md)
- [Experience-Driven Constraints](../feature/experience-driven-constraints.md)
- [Purpose-Driven Test Plan](../feature/purpose-driven-test-plan.md)
- [Service Test Strategy](../test/service-test-strategy.md)

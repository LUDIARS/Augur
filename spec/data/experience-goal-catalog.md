# Experience Goal Catalog

This catalog is the canonical vocabulary of experience qualities. Each entry is written in OKR style — an Objective stating the feel, Key Results stating default measurable budgets — followed by test case patterns and explicit relations.

How the catalog maps to the [Core Data Schema](./core-schema.md):

- Each entry's id (`EG-Cxx` / `EG-Wxx` / `EG-Gxx`) corresponds to one `ExperienceGoal.quality` value.
- Each Key Result (`KR-xx`) is a default `ExperienceTarget` that Augur proposes when the caller supplies the quality without explicit targets. Proposed budgets are always labeled per [Experience-Driven Constraints](../feature/experience-driven-constraints.md).
- Each Test Pattern (`TP-xx`) is a template Augur instantiates as a `TestSuggestion`, carrying the resolved budget in the suggestion's `budget` field. Execution always belongs to external runners.
- "Typical exemptions" list scopes where the strict budget usually does not apply — the raw material for caller-supplied or LLM-proposed `ExperienceExemption`s.

Relation vocabulary used throughout:

```text
EG --realized-by--> KR    (a feel becomes a measurable budget)
KR --verified-by--> TP    (a budget becomes an enforceable test)
EG --usually-exempts--> scope
```

## Domains

Goals are grouped into three domains:

- **Common (`EG-Cxx`)** — apply to any interactive product, web or game alike.
- **Web (`EG-Wxx`)** — specific to browser-delivered products.
- **Game (`EG-Gxx`)** — specific to games, including networked play.

`ProjectContext.domain` selects which sections contribute **default proposals**: the common section always applies; the web and game sections apply when the domain matches. A caller may still request any quality explicitly regardless of domain.

Common goals apply to games with game-flavored scopes: `startup_readiness` covers boot-to-title, `progress_transparency` covers matchmaking wait, `continuity` covers save/resume. Domain sections exist for qualities that have no meaningful counterpart in the other domain.

---

# Common Goals

## EG-C01 `responsiveness` — Responsiveness (即応性)

Feel: "feels instant", "reacts the moment I touch it", "no lag when typing".

**Objective:** every user input is answered before the user perceives a wait.

Key Results:

- KR-C01a: `api_latency` p95 ≤ 100ms per interactive request.
- KR-C01b: `time_to_feedback` ≤ 100ms from input to first visible reaction.
- KR-C01c: `task_completion` ≤ 1000ms for a single user-perceived task.

Typical exemptions: authentication (login, registration), checkout/payment, report generation, batch exports.

Test case patterns:

- **TP-C01-1 Latency guardrail** (kind: `performance`) — Given the target endpoint under a fixed load profile, when N requests are measured externally, then p95 latency must be within the budget.
- **TP-C01-2 Input-to-reaction** (kind: `e2e`) — Given the page is idle, when the user types into the target input, then the first visible DOM change must occur within the budget.
- **TP-C01-3 Hot-path regression pin** (kind: `regression`) — Given a recorded baseline p95 for the hot path, when the current build is measured, then latency must not regress beyond the agreed tolerance.

Relations:

```text
EG-C01 --realized-by--> KR-C01a, KR-C01b, KR-C01c
KR-C01a --verified-by--> TP-C01-1, TP-C01-3
KR-C01b --verified-by--> TP-C01-2
EG-C01 --usually-exempts--> auth, checkout, report generation
```

## EG-C02 `smoothness` — Smoothness (なめらかさ)

Feel: "scrolling is buttery", "animations don't stutter", "no jank".

**Objective:** motion on screen never visibly hitches.

Key Results:

- KR-C02a: `frame_time` ≤ 16.7ms sustained during interaction (60fps).
- KR-C02b: `long_task_count` = 0 tasks over 50ms on the main thread during interaction.
- KR-C02c: `dropped_frame_ratio` < 1% during scripted scroll or animation.

Typical exemptions: initial data import screens, developer/admin tooling views.

Test case patterns:

- **TP-C02-1 Scroll trace guardrail** (kind: `performance`) — Given a scripted scroll over representative content, when a frame trace is recorded externally, then the dropped-frame ratio must stay within the budget.
- **TP-C02-2 Long-task audit** (kind: `integration`) — Given the key interaction is triggered, when main-thread tasks are traced, then no task may exceed 50ms.

Relations:

```text
EG-C02 --realized-by--> KR-C02a, KR-C02b, KR-C02c
KR-C02c --verified-by--> TP-C02-1
KR-C02b --verified-by--> TP-C02-2
```

For gameplay-grade frame delivery in games (streaming hitches, shader compilation), see EG-G02 `frame_pacing`.

## EG-C03 `feedback` — Feedback (操作への応答)

Feel: "I know it heard me", "the button reacts when pressed", "no silent clicks".

**Objective:** every user action is visibly acknowledged, even when the result takes longer.

Key Results:

- KR-C03a: `time_to_feedback` ≤ 100ms for a visible pending or acknowledgement state.
- KR-C03b: `unacknowledged_action_count` = 0 — every async mutation path has an in-flight UI state.

Typical exemptions: background sync, prefetching, telemetry — actions the user did not explicitly perform.

Test case patterns:

- **TP-C03-1 Acknowledgement timing** (kind: `e2e`) — Given a mutating action (submit, delete), when the user triggers it, then a pending indicator must appear within the budget even under throttled network.
- **TP-C03-2 In-flight state contract** (kind: `contract`) — Given the UI state machine, when any mutation is dispatched, then a corresponding in-flight state must exist and be rendered.

Relations:

```text
EG-C03 --realized-by--> KR-C03a, KR-C03b
KR-C03a --verified-by--> TP-C03-1
KR-C03b --verified-by--> TP-C03-2
```

## EG-C04 `stability_feel` — Stability Feel (安定感)

Feel: "never crashes", "nothing jumps around", "it doesn't lose my input".

**Objective:** the product never betrays the user's trust mid-task.

Key Results:

- KR-C04a: `crash_count` = 0 across the critical flows.
- KR-C04b: `unhandled_error_rate` ≤ 0.1% of sessions.
- KR-C04c: `layout_shift` (CLS) ≤ 0.1 on interactive pages.

Typical exemptions: experimental feature-flagged surfaces explicitly marked beta.

Test case patterns:

- **TP-C04-1 Critical-flow soak** (kind: `flaky`) — Given the critical flow, when it is repeated N times consecutively by the external runner, then zero runs may fail or crash.
- **TP-C04-2 Error-boundary coverage** (kind: `integration`) — Given a component throws, when rendering continues, then the failure is contained and user input elsewhere is preserved.
- **TP-C04-3 Layout-shift guardrail** (kind: `e2e`) — Given the page loads with realistic data, when CLS is measured externally, then it must stay within the budget.

Relations:

```text
EG-C04 --realized-by--> KR-C04a, KR-C04b, KR-C04c
KR-C04a --verified-by--> TP-C04-1
KR-C04b --verified-by--> TP-C04-2
KR-C04c --verified-by--> TP-C04-3
```

## EG-C05 `consistency` — Consistency (一貫性)

Feel: "always takes about the same time", "predictable", "no random slow days".

**Objective:** the same action feels the same every time.

Key Results:

- KR-C05a: latency spread `p99 ≤ 3 × p50` for the same interaction.
- KR-C05b: `cross_run_variance` — repeated identical requests stay within an agreed variance band.

Typical exemptions: first-call-after-deploy warmup, cold caches explicitly communicated to the user.

Test case patterns:

- **TP-C05-1 Spread guardrail** (kind: `performance`) — Given a latency distribution collected externally over N requests, when percentiles are computed, then p99 must stay within the multiplier budget of p50.
- **TP-C05-2 Repeat-identity check** (kind: `integration`) — Given the same request issued repeatedly, when responses are compared, then results and timing class must be stable.

Relations:

```text
EG-C05 --realized-by--> KR-C05a, KR-C05b
KR-C05a --verified-by--> TP-C05-1
KR-C05b --verified-by--> TP-C05-2
```

## EG-C06 `startup_readiness` — Startup Readiness (立ち上がりの速さ)

Feel: "opens ready to use", "no long splash screen", "usable immediately".

**Objective:** the product is usable the moment the user arrives.

Key Results:

- KR-C06a: `time_to_interactive` ≤ 2000ms cold start.
- KR-C06b: `first_meaningful_content` ≤ 1000ms.
- KR-C06c: `bundle_size` within the agreed budget (proxy metric guarding KR-C06a).

Typical exemptions: first-run setup wizards, initial sync after install. For games: first boot with shader pre-compilation or initial asset download, when progress is displayed.

Test case patterns:

- **TP-C06-1 Cold-start measurement** (kind: `performance`) — Given a cleared cache environment, when the app is launched by the external runner, then time-to-interactive must be within the budget.
- **TP-C06-2 Bundle budget** (kind: `contract`) — Given a production build, when asset sizes are computed, then each entry bundle must stay within its size budget.

Relations:

```text
EG-C06 --realized-by--> KR-C06a, KR-C06b, KR-C06c
KR-C06a --verified-by--> TP-C06-1
KR-C06c --verified-by--> TP-C06-2
EG-C06 --usually-exempts--> first-run setup, initial sync
```

## EG-C07 `progress_transparency` — Progress Transparency (待たせ方の上手さ)

Feel: "I can see it's working", "no dead silence", "I know how long it will take".

**Objective:** when the product must be slow, the user is never left guessing.

Key Results:

- KR-C07a: any operation expected to exceed 1000ms shows progress within 500ms.
- KR-C07b: operations expected to exceed 10s show determinate progress or an estimate.
- KR-C07c: `silent_timeout_count` = 0 — every timeout path surfaces a message with a next step.

Typical exemptions: sub-second operations (covered by EG-C01 instead).

Test case patterns:

- **TP-C07-1 Slow-path indicator** (kind: `e2e`) — Given network throttled to simulate the slow case, when the long operation starts, then a progress indicator must appear within 500ms.
- **TP-C07-2 Timeout messaging** (kind: `integration`) — Given the upstream dependency times out, when the failure surfaces, then the user sees an explanation and a retry affordance, never a silent hang.

Relations:

```text
EG-C07 --realized-by--> KR-C07a, KR-C07b, KR-C07c
KR-C07a --verified-by--> TP-C07-1
KR-C07c --verified-by--> TP-C07-2
EG-C07 --usually-exempts--> sub-second operations (handled by EG-C01)
```

In games this goal covers matchmaking wait, loading screens, and server queue displays.

## EG-C08 `recoverability` — Recoverability (やり直せる安心感)

Feel: "mistakes are cheap", "I can undo", "an error doesn't wipe my work".

**Objective:** no single mistake or transient failure costs the user their work.

Key Results:

- KR-C08a: destructive actions are undoable or explicitly confirmed — `unguarded_destructive_actions` = 0.
- KR-C08b: `input_loss_on_error` = 0 — form state survives a failed submit.
- KR-C08c: a retry after one transient failure succeeds without re-entry.

Typical exemptions: explicitly irreversible domain actions (e.g., sending an email; consuming a one-time game item) where confirmation, not undo, is the guarantee.

Test case patterns:

- **TP-C08-1 Failed-submit preservation** (kind: `e2e`) — Given a filled form, when the first submit fails with a server error, then all entered values remain and a second submit succeeds.
- **TP-C08-2 Undo contract** (kind: `contract`) — Given each destructive action in the API surface, when enumerated, then each must map to an undo operation or a confirmation step.

Relations:

```text
EG-C08 --realized-by--> KR-C08a, KR-C08b, KR-C08c
KR-C08b --verified-by--> TP-C08-1
KR-C08a --verified-by--> TP-C08-2
```

## EG-C09 `continuity` — Continuity (続きから使える)

Feel: "picks up where I left off", "reload doesn't reset me", "offline didn't eat my edits".

**Objective:** interruption never resets the user's context.

Key Results:

- KR-C09a: reload or relaunch restores task state — `state_loss_on_reload` = 0 for in-progress work.
- KR-C09b: edits made while offline are queued and applied on reconnect.
- KR-C09c: session expiry mid-task preserves work through re-authentication.

Typical exemptions: intentionally ephemeral surfaces (incognito-style modes, one-time previews).

Test case patterns:

- **TP-C09-1 Reload persistence** (kind: `e2e`) — Given in-progress work, when the page or app reloads, then the user returns to the same state within one interaction.
- **TP-C09-2 Offline queue** (kind: `integration`) — Given the network drops mid-edit, when connectivity returns, then queued changes apply exactly once.

Relations:

```text
EG-C09 --realized-by--> KR-C09a, KR-C09b, KR-C09c
KR-C09a --verified-by--> TP-C09-1
KR-C09b --verified-by--> TP-C09-2
```

In games this goal covers save integrity and resume-from-suspend. Rejoining a live networked match is EG-G05 `disruption_tolerance`.

---

# Web Goals

## EG-W01 `freshness` — Freshness (情報の新しさ)

Feel: "what I see is up to date", "no stale results", "my change shows up immediately".

**Objective:** the screen never shows the user a lie about current state.

Key Results:

- KR-W01a: `staleness_after_mutation` ≤ 1000ms — a user's own change is visible within the budget.
- KR-W01b: cache invalidation fires on every mutation that affects displayed data.
- KR-W01c: cleared or reset inputs never leave residual results (see the stale-search example in the [HTTP API](../interface/http-api.md)).

Typical exemptions: analytics dashboards with a declared refresh interval, eventually-consistent views that display their own timestamp.

Test case patterns:

- **TP-W01-1 Read-your-own-write** (kind: `integration`) — Given the user mutates data, when the affected view re-renders, then the new value is visible within the budget.
- **TP-W01-2 Stale-reset regression** (kind: `regression`) — Given results are displayed, when the query or filter is cleared, then displayed results reset instead of persisting.
- **TP-W01-3 Invalidation contract** (kind: `contract`) — Given each mutation in the API surface, when enumerated, then each must declare which cached views it invalidates.

Relations:

```text
EG-W01 --realized-by--> KR-W01a, KR-W01b, KR-W01c
KR-W01a --verified-by--> TP-W01-1
KR-W01c --verified-by--> TP-W01-2
KR-W01b --verified-by--> TP-W01-3
EG-W01 --usually-exempts--> dashboards with declared refresh intervals
```

## EG-W02 `seamless_navigation` — Seamless Navigation (遷移の途切れなさ)

Feel: "pages change without a lurch", "the back button just works", "links land where they say".

**Objective:** moving through the site never breaks flow or context.

Key Results:

- KR-W02a: `route_transition` ≤ 300ms to the next view, or a skeleton/placeholder within 100ms.
- KR-W02b: `history_breakage_count` = 0 — back/forward restores the prior view and scroll position.
- KR-W02c: deep links land on the addressed content with the state needed to render it.

Typical exemptions: cross-origin exits, downloads, explicitly full-reload flows (e.g., after deploy migration).

Test case patterns:

- **TP-W02-1 Transition timing** (kind: `e2e`) — Given the app is loaded, when navigating between key routes, then the next view (or its skeleton) must render within the budget.
- **TP-W02-2 History contract** (kind: `e2e`) — Given a navigation sequence, when the user presses back, then the previous view and scroll position are restored.
- **TP-W02-3 Deep-link check** (kind: `integration`) — Given each representative deep link opened cold, when the page renders, then the addressed content is present.

Relations:

```text
EG-W02 --realized-by--> KR-W02a, KR-W02b, KR-W02c
KR-W02a --verified-by--> TP-W02-1
KR-W02b --verified-by--> TP-W02-2
KR-W02c --verified-by--> TP-W02-3
```

---

# Game Goals

Game goals cover both local play and networked play. Measurements come from external harnesses — instrumented builds, input replay, headless clients, and network emulation (latency, jitter, packet loss injection) — run by external runners. Augur only plans against their outputs.

Common goals still apply to games with game scopes: boot-to-title is EG-C06, matchmaking wait display is EG-C07, save integrity is EG-C09.

## EG-G01 `control_latency` — Control Latency (操作遅延)

Feel: "the character moves the instant I press", "controls feel tight", "no floaty inputs".

**Objective:** input becomes visible action within frames, not within perceptible delay.

Key Results:

- KR-G01a: `input_to_display` ≤ 50ms (≈3 frames at 60fps) for core actions in local play.
- KR-G01b: `input_drop_count` = 0 — inputs within the buffer window are never lost, including during frame spikes.

Typical exemptions: menus and inventory screens, cutscenes, turn-based phases.

Test case patterns:

- **TP-G01-1 Input-to-photon measurement** (kind: `performance`) — Given an instrumented build with input and present timestamps, when a scripted core action fires, then the measured input-to-display latency must be within the budget.
- **TP-G01-2 Input buffer integrity** (kind: `integration`) — Given a scripted input sequence at frame boundaries and under induced frame spikes, when the sequence completes, then every buffered input must have registered exactly once.

Relations:

```text
EG-G01 --realized-by--> KR-G01a, KR-G01b
KR-G01a --verified-by--> TP-G01-1
KR-G01b --verified-by--> TP-G01-2
EG-G01 --usually-exempts--> menus, cutscenes, turn-based phases
```

## EG-G02 `frame_pacing` — Frame Pacing (フレーム安定)

Feel: "no hitches mid-fight", "no stutter when a new area loads", "steady, not just fast".

**Objective:** frame delivery stays even under gameplay load; the worst frames stay invisible.

Key Results:

- KR-G02a: `frame_time` p99 ≤ the frame budget (16.7ms at 60fps, 33.3ms at 30fps) during representative gameplay.
- KR-G02b: `hitch_count` = 0 frames over 100ms during gameplay, including asset streaming and shader compilation.

Typical exemptions: loading screens and level transitions that display progress (covered by EG-C07).

Test case patterns:

- **TP-G02-1 Gameplay trace guardrail** (kind: `performance`) — Given a recorded gameplay segment replayed on an instrumented build, when the frame trace is analyzed, then p99 frame time and hitch count must stay within budget.
- **TP-G02-2 Streaming hitch audit** (kind: `integration`) — Given a scripted traversal crossing asset-streaming boundaries, when frames are traced, then no hitch may exceed the budget.

Relations:

```text
EG-G02 --realized-by--> KR-G02a, KR-G02b
KR-G02a --verified-by--> TP-G02-1
KR-G02b --verified-by--> TP-G02-2
EG-G02 --usually-exempts--> loading screens with progress display
```

## EG-G03 `netplay_responsiveness` — Netplay Responsiveness (ネット対戦の応答性)

Feel: "online feels like offline", "my shots register", "no waiting for the server to believe me".

**Objective:** networked actions feel locally executed within the supported connection envelope.

Key Results:

- KR-G03a: `perceived_action_latency` ≤ 100ms at the supported RTT ceiling (e.g., 150ms) via prediction and lag compensation.
- KR-G03b: `tick_processing` — player actions are processed within one server tick, and tick duration p99 stays within the tick interval at target load.

Typical exemptions: lobby, chat, inventory management, shop — out-of-match interactions where EG-C01 budgets apply instead.

Test case patterns:

- **TP-G03-1 Emulated-RTT action test** (kind: `e2e`) — Given two headless clients connected through network emulation at the supported RTT ceiling, when a scripted action fires, then the acting client's perceived action latency must be within the budget.
- **TP-G03-2 Tick budget guardrail** (kind: `performance`) — Given the server under representative match load, when tick durations are measured externally, then p99 tick duration must fit the tick interval.

Relations:

```text
EG-G03 --realized-by--> KR-G03a, KR-G03b
KR-G03a --verified-by--> TP-G03-1
KR-G03b --verified-by--> TP-G03-2
EG-G03 --usually-exempts--> lobby, chat, inventory, shop
```

## EG-G04 `sync_integrity` — Sync Integrity (同期の正しさ)

Feel: "we all see the same game", "no rubber-banding", "no phantom hits".

**Objective:** all peers agree on the game state, and corrections stay imperceptible.

Key Results:

- KR-G04a: `desync_count` = 0 across a full match, verified by periodic state checksums.
- KR-G04b: `rollback_depth` ≤ 3 frames at the supported RTT ceiling — corrections stay invisible.
- KR-G04c: `authority_divergence` — client-predicted position error against server authority stays within the agreed threshold outside correction windows.

Typical exemptions: spectator and replay views with a declared delay.

Test case patterns:

- **TP-G04-1 Deterministic replay check** (kind: `regression`) — Given the same input script run on two simulation instances, when state checksums are compared every N frames, then all checksums must match.
- **TP-G04-2 Rollback depth audit** (kind: `integration`) — Given emulated jitter at the supported RTT ceiling, when a scripted exchange runs, then no correction may exceed the budgeted rollback depth.
- **TP-G04-3 Authority divergence guardrail** (kind: `integration`) — Given a scripted movement pattern under emulated latency, when client and server positions are sampled, then divergence must stay within the threshold.

Relations:

```text
EG-G04 --realized-by--> KR-G04a, KR-G04b, KR-G04c
KR-G04a --verified-by--> TP-G04-1
KR-G04b --verified-by--> TP-G04-2
KR-G04c --verified-by--> TP-G04-3
EG-G04 --usually-exempts--> spectator/replay views with declared delay
```

## EG-G05 `disruption_tolerance` — Disruption Tolerance (回線劣化・切断への耐性)

Feel: "a bad connection bends the game, it doesn't break it", "I got back into my match".

**Objective:** real-world network conditions degrade the experience gracefully, never catastrophically.

Key Results:

- KR-G05a: `degraded_playability` — the game remains playable (inputs accepted, state advances, no crash or desync) at packet loss ≤ 5% and jitter ≤ 30ms.
- KR-G05b: `reconnect_to_match` ≤ 10s after a transient disconnect, with match state restored.
- KR-G05c: `disconnect_grace` — no forfeit or progress loss within the declared grace window.

Typical exemptions: sustained outages beyond the declared grace window; tournament modes with stricter declared rules.

Test case patterns:

- **TP-G05-1 Degraded-network soak** (kind: `flaky`) — Given a scripted match under emulated loss and jitter at the budget boundary, when the match runs to completion N times, then zero runs may crash, desync, or become unplayable.
- **TP-G05-2 Rejoin flow** (kind: `e2e`) — Given a client whose connection is killed mid-match, when it reconnects within the grace window, then it rejoins the same match with state restored within the budget.

Relations:

```text
EG-G05 --realized-by--> KR-G05a, KR-G05b, KR-G05c
KR-G05a --verified-by--> TP-G05-1
KR-G05b, KR-G05c --verified-by--> TP-G05-2
```

---

## Using the Catalog

- Default budgets here are starting points, not verdicts. Callers override them with explicit `ExperienceTarget`s, and exemptions narrow where they apply.
- `ProjectContext.domain` filters which sections produce default proposals; explicit caller references to any quality always work, regardless of domain.
- When Augur instantiates a `TP-xx` pattern, the suggestion's `rationale` must cite the `EG → KR → TP` relation that produced it, and its `evidenceIds` must reference the originating `experience_goal` evidence.
- New qualities enter the catalog by adding an entry to the appropriate domain section **and** extending the `ExperienceGoal.quality` union in the [Core Data Schema](./core-schema.md) in the same change.

## Related Specs

- [Core Data Schema](./core-schema.md)
- [Experience-Driven Constraints](../feature/experience-driven-constraints.md)
- [Purpose-Driven Test Plan](../feature/purpose-driven-test-plan.md)
- [Service Test Strategy](../test/service-test-strategy.md)

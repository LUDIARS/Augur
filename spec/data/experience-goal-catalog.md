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

In games, resume-from-suspend belongs here; save durability and cloud-sync safety are EG-G10 `progression_integrity`. Rejoining a live networked match is EG-G05 `disruption_tolerance`.

## EG-C10 `effortlessness` — Effortlessness (操作の少なさ)

Feel: "it takes two taps", "no needless questions", "the form fills itself".

**Objective:** core tasks cost the minimum number of decisions and actions.

Key Results:

- KR-C10a: `steps_to_complete` ≤ the agreed budget of discrete user actions per core task.
- KR-C10b: `redundant_input_count` = 0 — data the product already knows is never asked for twice.
- KR-C10c: required-field count per form within budget; everything optional is deferred or defaulted.

Typical exemptions: legally mandated confirmations (payment, account deletion), security checkpoints.

Test case patterns:

- **TP-C10-1 Step-count contract** (kind: `e2e`) — Given the core task scripted end to end, when discrete user actions (clicks, taps, keystrokes-as-fields) are counted, then the total must not exceed the budget.
- **TP-C10-2 Re-entry audit** (kind: `integration`) — Given a returning user who completed the flow before, when they start it again, then previously provided data must be pre-filled.

Relations:

```text
EG-C10 --realized-by--> KR-C10a, KR-C10b, KR-C10c
KR-C10a --verified-by--> TP-C10-1
KR-C10b --verified-by--> TP-C10-2
EG-C10 --usually-exempts--> mandated confirmations, security checkpoints
```

## EG-C11 `accessibility` — Accessibility (誰でも使える)

Feel: "works with just a keyboard", "readable without squinting", "the screen reader says something sensible".

**Objective:** the product is usable without a mouse, perfect vision, or ideal conditions.

Key Results:

- KR-C11a: `keyboard_reachability` — every interactive element is reachable and operable by keyboard, with visible focus.
- KR-C11b: `contrast_violations` = 0 at WCAG AA on key screens.
- KR-C11c: `unlabeled_control_count` = 0 — every control exposes an accessible name.

Typical exemptions: purely decorative visuals; canvas-rendered game scenes, where the equivalent guarantee is platform accessibility options (remapping, subtitles, colorblind modes).

Test case patterns:

- **TP-C11-1 Keyboard-only traversal** (kind: `e2e`) — Given the core task, when it is driven using only the keyboard, then it must complete, with visible focus at every step.
- **TP-C11-2 Static accessibility audit** (kind: `integration`) — Given key screens rendered with realistic data, when an accessibility scanner runs, then zero AA violations may remain.
- **TP-C11-3 Label contract** (kind: `contract`) — Given all interactive controls enumerated, when accessible names are checked, then none may be missing.

Relations:

```text
EG-C11 --realized-by--> KR-C11a, KR-C11b, KR-C11c
KR-C11a --verified-by--> TP-C11-1
KR-C11b --verified-by--> TP-C11-2
KR-C11c --verified-by--> TP-C11-3
```

## EG-C12 `resource_frugality` — Resource Frugality (軽さ)

Feel: "doesn't heat my phone", "doesn't eat memory", "the fan stays quiet".

**Objective:** the product respects the user's device.

Key Results:

- KR-C12a: `memory_footprint` within budget at steady state, with no unbounded growth over a long session.
- KR-C12b: `idle_cpu` ≤ 1% while the user is not interacting.
- KR-C12c: `energy_impact` within the platform budget for a standard session.

Typical exemptions: explicit heavy modes the user opts into (export, rendering, benchmarking).

Test case patterns:

- **TP-C12-1 Leak soak** (kind: `flaky`) — Given a repeating usage scenario driven N times, when memory is sampled after each cycle, then it must return to the baseline band every time.
- **TP-C12-2 Idle drain guardrail** (kind: `performance`) — Given the app left idle for T minutes, when CPU usage and wakeups are measured externally, then both must stay within budget.

Relations:

```text
EG-C12 --realized-by--> KR-C12a, KR-C12b, KR-C12c
KR-C12a --verified-by--> TP-C12-1
KR-C12b --verified-by--> TP-C12-2
EG-C12 --usually-exempts--> opt-in heavy modes
```

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

## EG-W03 `cross_browser_consistency` — Cross-Browser Consistency (どの環境でも同じ)

Feel: "works the same in Safari", "mobile isn't a downgrade", "no 'please use Chrome'".

**Objective:** the experience holds across the supported browser and device matrix.

Key Results:

- KR-W03a: `matrix_pass_rate` = 100% of critical flows on every supported browser/device profile.
- KR-W03b: `visual_divergence` within tolerance across browsers for key screens.
- KR-W03c: interaction parity — every pointer interaction has a touch equivalent with the same outcome.

Typical exemptions: browsers below the supported baseline; declared progressive-enhancement gaps.

Test case patterns:

- **TP-W03-1 Matrix flow run** (kind: `e2e`) — Given the critical flows, when they run on each supported browser/device profile, then all must pass on all profiles.
- **TP-W03-2 Visual regression sweep** (kind: `regression`) — Given key screens captured per browser, when screenshots are diffed against baselines, then divergence must stay within tolerance.
- **TP-W03-3 Touch parity check** (kind: `e2e`) — Given each pointer interaction, when driven via touch emulation, then the outcome must match the pointer outcome.

Relations:

```text
EG-W03 --realized-by--> KR-W03a, KR-W03b, KR-W03c
KR-W03a --verified-by--> TP-W03-1
KR-W03b --verified-by--> TP-W03-2
KR-W03c --verified-by--> TP-W03-3
EG-W03 --usually-exempts--> browsers below the supported baseline
```

## EG-W04 `shareability` — Shareability (そのまま共有できる)

Feel: "I can just send the link", "the link opens exactly what I was seeing".

**Objective:** what the user sees can be handed to someone else as a URL.

Key Results:

- KR-W04a: `url_state_roundtrip` — visible state (filters, selection, position) is encoded in the URL and restores on open.
- KR-W04b: `share_preview` — shared links render correct title, description, and image metadata.
- KR-W04c: opening a shared link without access lands on a useful request path, never a dead end.

Typical exemptions: private or ephemeral views by design (drafts, admin panels, incognito-style modes).

Test case patterns:

- **TP-W04-1 Round-trip test** (kind: `e2e`) — Given manipulated view state, when its URL is opened in a fresh session, then the identical view must render.
- **TP-W04-2 Preview metadata contract** (kind: `contract`) — Given representative shareable URLs, when share metadata is fetched, then required tags must be present and accurate.
- **TP-W04-3 No-access landing** (kind: `e2e`) — Given a shared link opened by an unauthorized user, when the page renders, then a request-access path must be shown.

Relations:

```text
EG-W04 --realized-by--> KR-W04a, KR-W04b, KR-W04c
KR-W04a --verified-by--> TP-W04-1
KR-W04b --verified-by--> TP-W04-2
KR-W04c --verified-by--> TP-W04-3
EG-W04 --usually-exempts--> drafts, admin panels
```

---

# Game Goals

Game goals cover both local play and networked play. Measurements come from external harnesses — instrumented builds, input replay, headless clients, network emulation (latency, jitter, packet loss injection), and screenshot/video capture with frame analysis — run by external runners. Augur only plans against their outputs.

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

## EG-G06 `matchmaking_flow` — Matchmaking Flow (マッチングの快適さ)

Feel: "I get into a match fast", "opponents feel about my level", "a formed match actually starts".

**Objective:** getting into a fair match is fast and predictable.

Key Results:

- KR-G06a: `queue_time` p90 ≤ the regional budget at the reference player population.
- KR-G06b: `skill_delta` between matched players within the ranked-mode threshold.
- KR-G06c: `match_abort_rate` ≤ budget — formed matches start instead of dissolving.

Typical exemptions: off-peak hours below the declared reference population; placement matches for new or unranked players.

Test case patterns:

- **TP-G06-1 Simulated-pool matchmaking** (kind: `integration`) — Given a synthetic player population with a realistic skill distribution, when matchmaking runs, then p90 queue time and per-match skill delta must stay within budget.
- **TP-G06-2 Match formation soak** (kind: `flaky`) — Given N matchmaking cycles driven by headless clients, when results are tallied, then the abort rate must stay within budget.

Relations:

```text
EG-G06 --realized-by--> KR-G06a, KR-G06b, KR-G06c
KR-G06a, KR-G06b --verified-by--> TP-G06-1
KR-G06c --verified-by--> TP-G06-2
EG-G06 --usually-exempts--> off-peak population, placement matches
```

Queue-wait display and estimates are EG-C07 `progress_transparency` applied to the matchmaking scope.

## EG-G07 `load_seamlessness` — Load Seamlessness (ロードの隠蔽)

Feel: "the world just continues", "fast travel is fast", "no long black screen mid-game".

**Objective:** in-game transitions never eject the player from the experience.

Key Results:

- KR-G07a: `scene_load` p95 ≤ budget (e.g., 5s) for area transitions and fast travel.
- KR-G07b: `input_lockout` ≤ budget during masked transitions — the game acknowledges input even while loading.
- KR-G07c: `visible_pop_in` within the declared tolerance during in-world streaming.

Typical exemptions: initial boot and first area load (EG-C06), platform-mandated screens.

Test case patterns:

- **TP-G07-1 Transition timing sweep** (kind: `performance`) — Given every major transition scripted (area changes, fast travel, respawn), when load times are measured externally, then p95 must stay within budget.
- **TP-G07-2 Masked-transition input check** (kind: `e2e`) — Given inputs sent during a masked transition, when the transition completes, then each input must have been acknowledged within the lockout budget.

Relations:

```text
EG-G07 --realized-by--> KR-G07a, KR-G07b, KR-G07c
KR-G07a --verified-by--> TP-G07-1
KR-G07b --verified-by--> TP-G07-2
EG-G07 --usually-exempts--> initial boot (EG-C06), platform-mandated screens
```

## EG-G08 `audio_visual_sync` — Audio-Visual Sync (音と映像のズレのなさ)

Feel: "hits sound when they land", "no lip-sync drift", "the beat matches my button press".

**Objective:** what the player hears matches what they see, frame-close.

Key Results:

- KR-G08a: `av_offset` ≤ 45ms between a visual event and its sound.
- KR-G08b: `audio_dropout_count` = 0 during representative gameplay.
- KR-G08c: in rhythm or timing-critical modes, input-to-audio feedback fits the mode's declared judgment window.

Typical exemptions: intentionally delayed audio (distance attenuation, echo) declared by design.

Test case patterns:

- **TP-G08-1 Event-sync capture** (kind: `integration`) — Given an instrumented build emitting timestamps for impact frames and sound onsets, when N scripted events fire, then every offset must stay within budget.
- **TP-G08-2 Dropout soak** (kind: `flaky`) — Given full-session audio captured during scripted gameplay, when analyzed, then zero dropouts or glitches may appear.

Relations:

```text
EG-G08 --realized-by--> KR-G08a, KR-G08b, KR-G08c
KR-G08a --verified-by--> TP-G08-1
KR-G08b --verified-by--> TP-G08-2
EG-G08 --usually-exempts--> designed audio delay (distance, echo)
```

## EG-G09 `fairness_feel` — Fairness Feel (公平感)

Feel: "I died because I was outplayed, not because of the network", "no peeker's advantage", "hits count the same for everyone".

**Objective:** network conditions and implementation details never grant one player an unearned edge.

Key Results:

- KR-G09a: `hit_registration_agreement` ≥ threshold — client-perceived hits are confirmed by the server within tolerance, symmetrically for both players.
- KR-G09b: `peeker_advantage` ≤ the budgeted milliseconds at the supported RTT asymmetry.
- KR-G09c: `authority_validation` — every gameplay-critical action is validated server-side; client-only trust count = 0.

Typical exemptions: casual or custom modes with declared relaxed rules.

Test case patterns:

- **TP-G09-1 Asymmetric-RTT duel** (kind: `integration`) — Given two scripted clients under asymmetric emulated latency, when standard duels run in both directions, then hit agreement and peeker advantage must stay within budget for both sides.
- **TP-G09-2 Authority contract** (kind: `contract`) — Given all gameplay-critical actions enumerated, when server handling is checked, then each must have server-side validation.
- **TP-G09-3 Out-of-envelope rejection** (kind: `security`) — Given a modified client submitting impossible movement or actions, when the server processes them, then it must reject them and keep shared state consistent.

Relations:

```text
EG-G09 --realized-by--> KR-G09a, KR-G09b, KR-G09c
KR-G09a, KR-G09b --verified-by--> TP-G09-1
KR-G09c --verified-by--> TP-G09-2, TP-G09-3
EG-G09 --usually-exempts--> casual/custom modes with declared rules
```

## EG-G10 `progression_integrity` — Progression Integrity (進行データの安全)

Feel: "my save is sacred", "a crash costs me minutes, not hours", "cloud sync never eats progress".

**Objective:** player progress survives crashes, power loss, and sync conflicts.

Key Results:

- KR-G10a: `save_atomicity` — interrupting a save never corrupts it; the last good save always loads.
- KR-G10b: `progress_loss_window` ≤ the declared autosave interval after any crash.
- KR-G10c: `sync_conflict_resolution` — cloud conflicts resolve by the declared policy, never silently discarding newer meaningful progress.

Typical exemptions: hardcore or permadeath modes where loss is the declared design.

Test case patterns:

- **TP-G10-1 Kill-during-save** (kind: `integration`) — Given the process terminated mid-save repeatedly at randomized offsets, when the game relaunches, then a valid save must load every time.
- **TP-G10-2 Crash loss bound** (kind: `e2e`) — Given scripted play followed by a forced crash, when the game relaunches, then lost progress must fit within the autosave window.
- **TP-G10-3 Conflict matrix** (kind: `integration`) — Given constructed divergent local and cloud saves for each conflict class, when sync runs, then resolution must follow the declared policy in every case.

Relations:

```text
EG-G10 --realized-by--> KR-G10a, KR-G10b, KR-G10c
KR-G10a --verified-by--> TP-G10-1
KR-G10b --verified-by--> TP-G10-2
KR-G10c --verified-by--> TP-G10-3
EG-G10 --usually-exempts--> hardcore/permadeath modes
```

## EG-G11 `visual_fidelity` — Visual Fidelity (描画の正しさ)

Feel: "the game looks the way it should", "no missing textures, no flicker", "the HUD reads clearly on every screen".

**Objective:** rendered output stays visually correct across changes, verified from captured frames rather than eyeballs.

Measurements come from an external capture harness (scripted screenshot and video capture) and frame analyzers (perceptual diff, artifact detectors, OCR), per [Media-Based Testing](../feature/media-based-testing.md). Augur only plans against their numeric outputs.

Key Results:

- KR-G11a: `golden_image_diff` ≤ 2% perceptual difference against approved reference captures, per curated shot.
- KR-G11b: `render_artifact_count` = 0 — placeholder textures, z-fighting flicker, NaN-colored pixels, or full-screen corruption in captured segments.
- KR-G11c: `hud_legibility_failures` = 0 — declared HUD and subtitle elements present and legible at every supported resolution and aspect ratio.

Typical exemptions: photo mode with user-applied filters, declared stochastic VFX regions (particles, procedural weather), loading screens.

Test case patterns:

- **TP-G11-1 Golden-image sweep** (kind: `regression`) — Given a scripted camera tour re-rendered on the candidate build, when each capture is compared perceptually against its approved golden reference, then no shot may diff beyond the budget without an explicit baseline update.
- **TP-G11-2 Artifact detector pass** (kind: `integration`) — Given video recorded from scripted gameplay segments, when every frame runs through the artifact detectors (placeholder-texture palette, flicker, NaN-color), then zero artifacts may be reported.
- **TP-G11-3 HUD legibility scan** (kind: `e2e`) — Given screenshots captured at each supported resolution and aspect ratio, when declared HUD elements are located and text is OCR-verified, then every element must be present and legible.

Relations:

```text
EG-G11 --realized-by--> KR-G11a, KR-G11b, KR-G11c
KR-G11a --verified-by--> TP-G11-1
KR-G11b --verified-by--> TP-G11-2
KR-G11c --verified-by--> TP-G11-3
EG-G11 --usually-exempts--> photo mode, stochastic VFX, loading screens
```

## EG-G12 `content_rating_compliance` — Content Rating Compliance (レーティング適合)

Feel: "the game never shows more than its rating promised", "violence, blood, and gore stay within the declared tier", "the CERO B version never renders CERO D content".

**Objective:** captured frames never exceed the declared content rating tier (CERO, ESRB, PEGI, IARC) for any descriptor.

The declared rating tier and its descriptor limits (violence, blood amount and color, dismemberment, sexual content, language) are configured in the external frame classifier, not in Augur; the caller states the target tier (e.g. "CERO B") in the goal description. Classification counts arrive as `media_analysis` signals per [Media-Based Testing](../feature/media-based-testing.md). Automated classification is a pre-submission guardrail — the rating body's own review remains the final authority, so flagged frames are confirmed by human review before counting as violations.

Key Results:

- KR-G12a: `rating_violation_count` = 0 — frames classified above the declared tier for any descriptor, confirmed by human review.
- KR-G12b: `prohibited_expression_count` = 0 — expressions the rating body bans outright at every tier (e.g. CERO prohibited-expression clauses).
- KR-G12c: `regional_variant_mismatch_count` = 0 — regional SKU expression settings (blood color, gore toggle) visibly applied in captured output.

Typical exemptions: internal debug builds never shipped, platform-managed overlays outside the rendered output.

Test case patterns:

- **TP-G12-1 Rated-content frame audit** (kind: `e2e`) — Given video captured from scripted playthrough segments covering every rating-relevant scene, when each frame is classified against the declared descriptor limits, then zero frames may exceed the declared rating tier.
- **TP-G12-2 Flagged-scene rating regression** (kind: `regression`) — Given the corpus of previously flagged scenes, when each scene is re-captured and re-classified after a content change, then no classification may exceed its accepted baseline.
- **TP-G12-3 Regional variant capture check** (kind: `integration`) — Given each regional build variant, when identical scenes are captured on every variant, then each variant-specific expression setting must be visibly applied in its output.

Relations:

```text
EG-G12 --realized-by--> KR-G12a, KR-G12b, KR-G12c
KR-G12a --verified-by--> TP-G12-1, TP-G12-2
KR-G12b --verified-by--> TP-G12-1
KR-G12c --verified-by--> TP-G12-3
EG-G12 --usually-exempts--> internal debug builds, platform overlays
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

# Media-Based Testing

This spec defines how Augur plans tests whose evidence is captured screenshots and video: graphics evaluation (does the game render correctly?) and content rating compliance (does what is rendered stay within the declared rating tier — CERO, ESRB, PEGI, IARC — for violence, blood, and similar descriptors?).

The division of labor follows Augur's core principle: **Augur never captures, stores, or analyzes media itself.** An external capture harness produces the screenshots and video; external analyzers turn frames into numbers; the caller feeds those numbers to Augur as signals. Augur resolves the caller's goals into budgets, compares the numbers against them, and plans the guardrail tests that external runners enforce.

## The Pipeline Augur Plans Against

```text
game build --(scripted play)--> capture harness --(frames)--> analyzers --(numbers)--> caller --(CreatePlanRequest)--> Augur
```

1. **Capture harness** — replays scripted play (camera tours, combat scenarios, cutscenes) on the candidate build and records screenshots and video. Determinism matters: the same script should produce comparable frames across builds, so diffs measure the change, not the noise.
2. **Analyzers** — one tool per question, each reducing frames to numeric results:
   - *Perceptual diff* against approved golden references (graphics regression).
   - *Artifact detectors* for placeholder textures, z-fighting flicker, NaN-colored pixels, full-screen corruption.
   - *OCR / element locators* for HUD and subtitle legibility.
   - *Content classifiers* (typically vision-model based) that flag frames against the declared rating tier's descriptor limits — violence intensity, blood amount and color, dismemberment, sexual content.
3. **Augur** — receives the counts and percentages as `media_analysis` runtime signals, resolves `visual_fidelity` and `content_rating_compliance` goals into budgets ([Experience Goal Catalog](../data/experience-goal-catalog.md) EG-G11 and EG-G12), reports violations as evidence, and emits the guardrail test suggestions.

## The Media Signal Contract

Analyzer outputs arrive as `RuntimeSignal`s with `type: "media_analysis"` ([Core Data Schema](../data/core-schema.md)):

- `name` — the metric, matching the `ExperienceTarget.metric` it is compared against (`golden_image_diff`, `render_artifact_count`, `rating_violation_count`, ...).
- `value` / `unit` — the numeric result (`%` for diffs, `count` for flagged frames or artifacts).
- `scope` — the scene, segment, or shot the capture covers ("boss arena finisher", "chapter 3 cutscene"). Scopes drive exemption matching, so name them the way exemptions will refer to them.
- `source` — the harness and analyzer that produced the number, with versions ("capture-rig 1.4 / gore-classifier 0.9"). Classifier verdicts are only as good as the model; the source makes results auditable.

Example — a CERO B title whose new finisher move was flagged:

```json
{
  "type": "media_analysis",
  "name": "rating_violation_count",
  "value": 3,
  "unit": "count",
  "scope": "boss arena finisher",
  "source": "capture-rig 1.4 / gore-classifier 0.9, reviewed by content team"
}
```

## Behaviors

1. **Goal resolution.** A `visual_fidelity` or `content_rating_compliance` goal without explicit targets resolves to the catalog defaults (KR-G11a–c, KR-G12a–c), labeled as proposals, per [Experience-Driven Constraints](./experience-driven-constraints.md). Explicit caller targets — for example a stricter `golden_image_diff ≤ 0.5%` for a pixel-art title — pass through unchanged.
2. **Violation detection.** A `media_analysis` signal whose value exceeds the matching budget becomes `budget_violation` evidence and raises the matching guardrail's priority, exactly as latency signals do. A confirmed `rating_violation_count` above zero against a caller-set target yields a `critical` guardrail.
3. **Guardrail suggestions.** Each resolved budget instantiates its catalog test pattern (TP-G11-x, TP-G12-x) as a `TestSuggestion` carrying the budget, with the `EG → KR → TP` relation in the rationale. Execution — capturing, diffing, classifying — belongs to external runners.
4. **Exemptions.** Scopes where strict budgets do not apply (photo mode with user filters, declared stochastic VFX, internal debug builds) work through the standard exemption mechanism: caller-supplied exemptions waive or relax; LLM-proposed exemptions only downgrade, never remove.

## Rating Tiers Are Configuration, Not Engine Logic

Augur does not embed any rating body's rulebook. The caller declares the target tier in the goal description ("CERO B for the JP SKU"); the external classifier is configured with that tier's descriptor limits; Augur enforces the shape of the result — confirmed violations must be zero, prohibited expressions must be zero, regional variants must visibly apply. This keeps the engine deterministic and rating-body-agnostic: a CERO title and a PEGI title differ in classifier configuration, not in Augur behavior.

Two consequences worth stating:

- **Automated classification is a pre-submission guardrail, not certification.** The rating body's own review is the final authority. Flagged frames pass through human review before they count as violations — the classifier ranks and routes, people confirm.
- **Prohibited expressions are absolute.** Some expressions are banned at every tier (CERO's prohibited-expression clauses); KR-G12b tracks them separately from tier violations so a relaxed tier exemption can never accidentally waive them.

## Graphics Evaluation Without Golden Noise

Golden-image testing fails in practice when baselines churn. The catalog patterns bake in the countermeasures:

- Diffs are *perceptual* (structural similarity), not byte-exact, with the budget expressed as a percentage — anti-aliasing jitter and codec noise stay below it.
- Stochastic regions (particles, procedural weather) are declared as exemption scopes rather than masked ad hoc, so the waiver is visible in the plan.
- Baseline updates are explicit: TP-G11-1 fails on any over-budget diff *without an approved baseline update*, making "the art changed on purpose" an auditable event instead of a silent re-record.

## Non-Goals

- Augur never receives, stores, or processes image or video bytes; requests carry only numeric analyzer results and references in `source`/`scope`.
- Augur does not implement or select classifiers, and does not judge content itself — including via the Phase 4 LLM boundary, which handles prose and exemption proposals only.
- Augur does not certify compliance; it plans the tests that make submission surprises unlikely.

## Related Specs

- [Experience Goal Catalog](../data/experience-goal-catalog.md) — EG-G11 `visual_fidelity`, EG-G12 `content_rating_compliance`
- [Core Data Schema](../data/core-schema.md) — `RuntimeSignal.type: "media_analysis"`
- [Experience-Driven Constraints](./experience-driven-constraints.md) — budget resolution, exemptions, violation semantics
- [Planning Engine](./planning-engine.md) — the pipeline that consumes the signals

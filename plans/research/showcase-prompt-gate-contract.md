# Showcase prompt and gate contract

Status: proposal, 2026-09-30. Read-only inspection; no resource mutations, assets or live controls.

## Reuse before authoring

| Resource inspected                                                              | Action after visual/motion proof | Reason                                                                                                                                               |
| ------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `showcase_pipeline` v2                                                          | Extend in place                  | One muse pass currently precedes story/treatment/motion/technique/render/review; add targeted studies and a motion-proof boundary before production. |
| `design_muse` v0                                                                | Reuse repeatedly                 | Each pass reads the same creative-spec revision, focuses on one uncertainty, and carries observed reference properties into the next handoff.        |
| `showcase_asset_study` v5                                                       | Extend in place                  | Stage-aware and replaceable already; replace embedded historical production rulings with caller-owned current authorization and proof prerequisites. |
| `showcase_story`, `showcase_treatment`, `showcase_motion`, `showcase_review` v1 | Extend handoffs                  | Already own silent beats, color script, timing, actual playback/provenance review. Require revision-bound evidence and explicit dependencies.        |
| `showcase-asset-continuity`                                                     | Retain honest advisory role      | Live inspect reports advisory guidance, explicitly no automatic taste check.                                                                         |
| Proven artifact checks                                                          | Create narrowly only if absent   | Executable manifest/decode/replacement checks; no second creative catalog or orchestration service.                                                  |

Reusable prompts consume caller-owned creative-spec/reference/ruling revisions. Cast, proportions, wardrobe, cel/ink and colors are configurable project criteria. Record accepted standards and failed controls before resource authoring.

## Dependency and asset order

| Stage / canonical surface                             | Required inputs                                 | Output and dependency                                                                                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brief + focused `design_muse` passes                  | Current decisions, inspected references         | Shared creative-spec revision; separate outfit/hair, companion identity and world/ink studies may proceed in parallel.                                                    |
| `showcase_story` + `showcase_treatment`               | Spec + identity studies                         | Story beats → beat-addressed color/light script. Palette experiments may run earlier; final colors depend on scene hierarchy and cast coexistence.                        |
| `showcase_asset_study`                                | Selected study/spec revisions                   | Human silhouette/wardrobe/hair sheet; companion sheets; material/line test tile. Root integrates them in one trio/world composition before assets are locked.             |
| `showcase_motion` + `tech_recommendation`             | Integrated sheets, beats, color script          | Small acting/scaffolding test contract → compared implementation approach. Final rig/asset production follows technique proof.                                            |
| Asset preparation + motion proof                      | Chosen technique, semantic slot/anchor contract | Replaceable source assets; independently moving actors and prop/contact test; actual playback review. Failed acting returns to construction or motion, not export polish. |
| Extend pipeline → full production → `showcase_review` | Accepted revision-bound motion proof            | Film, reproducible build/export receipts, actual provider trace where claimed, replacement/rebuild evidence, walkthrough of how resources guided the work.                |

Graph: shared spec → parallel studies → integration; story → color script; integration + color script → motion/technique proof → resource update/live controls → production. Client delegation uses disjoint ownership. Workflow IR edges linearize one run; `maxFanOut` is not a worker scheduler.

## Review and enforcement

Review records contain `spec_revision`, `artifact_revision`, `artifact_path`, `artifact_hash`, inspected frame/time/view, criterion id, observation, reviewer identity/authority/scope, verdict, and corrective stage. Project verdicts: ACCEPT/REVISE/UNRESOLVED; map eligible completed reviews to runtime PASS/FAIL. Missing/stale evidence cannot pass. Owner or delegated root determines artistic acceptance; an approval file does not prove inspection.

| Example project criterion                                              | Artistic evidence / correction                                                | Separate deterministic check                                                                                         |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Draped wardrobe and rebellious hair preserve compact facial identity   | Viewed silhouette, face and action poses; revise construction on failure      | Required sheet views exist, hashes match selected asset revision.                                                    |
| Cel value grouping and purposeful heavier shaded contours explain form | Viewed lit/shaded/occlusion poses and turn; revise material/line construction | Referenced test frames and lighting/spec revisions exist; no numeric art score.                                      |
| Trio remains legible through color progression and independent acting  | Viewed full test, contact/release and transition frames; revise color/motion  | Full decode, authored dimensions/fps/duration, complete frame output, same-contract asset swap and rebuild receipts. |

`inline_guidance` is a reminder. Self review is client judgment; judge mode renders a context-isolated client-subagent envelope, not automatic visual inspection or objective artistic truth. Judge routing is documented for chain-step reviews, not standalone prompt gates. `shell_verify` checks exit code under operator command/directory controls; `script_tool` resolves a registered tool and requires structured `{passed, reason}`. Encoding success cannot approve art. Blocking progression enforces submitted review/check results; it does not authenticate human taste. Bypasses remain visibly unverified.

Mascot recognition is art identity. Symbolic actions are conceptual; recorded provider activity requires captured trace evidence.

## Current invocation sketch and later proof

Current parameter shapes; not executed:

```js
prompt_engine({
  command: ">>design_muse",
  inputs: {
    challenge:
      "Outfit/hair study; read caller creative-spec and reference revisions",
    constraints: "Bounded study; preserve current scope and review authority",
    mode: "brainstorm",
    moodboard: "<existing reference artifact>",
  },
});
prompt_engine({
  command: ">>showcase_asset_study",
  inputs: {
    brief: "<selected study and explicit test scope>",
    references: "<inspected source pointers>",
    frames: "<existing comparison paths>",
    output_root: "<caller-owned study directory>",
    context: "<current revision and ruling>",
  },
});
```

After proof: inspect → validate → preview/update with expected-version receipt → inspect. Bind gates to stable node ids. Preserve `motion_contract: step5_result` pending live verification: source currently publishes 1-based ordinal +1 (`text-refs/index.ts:139`, `chains/manager.ts:1921`, `node-order.ts:101`), so motion ordinal 4 produces that alias. Prefer verified semantic outputs. Isolated SDK controls on both transports: accepted artifacts advance; missing/stale/corrupt artifacts fail; PASS cannot override failing checks; only targeted nodes hold; final verdict completes once. Demonstrate asset replacement and rebuilt playback. Controls were not run here.

Evidence: live canonical inspect receipts above; [workflow/schema](../../docs/reference/mcp-tools.md#workflow-submission), [gate modes](../../docs/guides/gates.md), [judge boundary](../../docs/guides/judge-mode.md); inspected tests: `server/tests/e2e/review-per-node.e2e.test.ts`, `server/tests/e2e/shell-verify-step-hold.e2e.test.ts`, `server/tests/integration/gates/gate-judge-pipeline-wiring.test.ts`, `server/tests/integration/gates/script-tool-gate-criteria.test.ts`. Source inspection is not a current test-run result.

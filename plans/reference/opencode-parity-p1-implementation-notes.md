---
title: "Implementation Notes — opencode-parity-p1"
plan: opencode-parity-p1-close-client-gaps-2026-08-21.md
date: 2026-08-21
status: reference
tags: [opencode, parity, implementation-notes]
---

# Implementation Notes — opencode-parity-p1

Governing plan: `plans/opencode-parity-p1-close-client-gaps-2026-08-21.md`

## Open Question Rulings

- **OQ-1 RULED 2026-08-21** (precedes Tier 3): Hard block from day one — consistency with the upstream gate-enforce deny pattern beats a cautious warn-only release; the block fails OPEN on missing/unreadable contract artifacts so stale installs keep working. Plan §Open Questions flipped with pointer here.
- **OQ-2 RULED 2026-08-21** (precedes Tier 2): Artifact install location = `hooks/lib/_generated/` beside the Python twin (`resolution_verbs.py`). Rationale: single-directory contract; the plugin already resolves the claude-prompts package root, and co-location keeps .py/.json in one shipped directory. Alternative (package-root exports entry) rejected — adds a second discovery path for no benefit. Plan §Open Questions flipped to RULED with pointer here.

## Deviations

- **DEV-T1-1** 2026-08-21: Plan row 1.1's Verify assumed dev-workflow export would contain `tools/` — measured: dev-workflow source has only `docs/` (no tools/), so verification substituted docs/ presence (5 files) as the observable for `assets:true`; `scripts`/`references` share the identical capability branch (service.ts:2512/:2584) flipped in the same edit. Also registered `prompt:development/dev-workflow` under opencode user scope in skills-sync.yaml — required to make the flip observable at all (only strategicImplement was registered, which has no docs/tools in source); kept because exporting the core workflow skill to OpenCode is desired end-state anyway.
- **DEV-T1-2** 2026-08-21: Row 1.2's lazy-regex approach (match to first endif) shredded dev-workflow's nested chains — outer `{% if phase %}` matched the INNER `{% if work_type %}`'s endif, leaving 11 raw tags in the export. Superseded the plan's regex approach with a depth-tracking tag-walking parser (`compileTemplateChains`) that resolves nesting and compiles only the selected branch recursively. This fixed a defect the plan did not know about: the OLD compiler had the same nesting bug on every client. Detector regex `\b==\b` also corrected (word-boundary can't precede `=`); restructured to capture condition then test for `==|\bor\b|\bnot\b`.
- **DEV-T2-3** 2026-08-21: Row 2.3 measured note — manifest carries pass_criteria for 8/12 strategicImplement gates; the other 4 are advisory guidance-type gates whose gate.yaml contains no pass_criteria. Manifest is faithful to source, not lossy.
- **NOTE-T3/T4** 2026-08-21: Enforcement decision logic extracted to `src/lib/gate-enforcement.ts` (pure functions: evaluateGateBlock, evaluateArmedGateBlock, detectSkillGateArm, loadResolutionVerbs) rather than living inline in the plugin handler — testable without OpenCode, matching the OOP-shell/FP-internals pattern. Armed-gate check runs BEFORE the prompt_engine-specific block in tool.execute.before because armed gates deny ALL tools (row 4.2 contract), and a PASS verdict disarms before chain-gate logic runs.

## Authored-vs-Measured

- **T5.3 live drive** 2026-08-21: full restart-drive of the maintainer's live OpenCode session was not safe from inside that session (killing/restarting it would terminate the work itself). Substituted a scripted drive of the BUILT artifact `dist/.opencode/plugin/index.js` executing the real handler sequence against the real strategicImplement export on disk: read → armed; bash → BLOCKED with gates named; prompt_engine + PASS → disarmed; bash → allowed. ALL CHECKS PASSED. Maintainer restart-drive remains available as an extra confidence step: register "opencode-prompts" in ~/.config/opencode/opencode.json plugin array, restart, read strategicImplement/SKILL.md, attempt any tool.
- 2026-08-21: all Tier 1/2 line anchors re-measured by Step-3 probe batch (service.ts :398-409/:1477-1498/:1608-1622/:1528-1587/:2246 exact or ±10). No divergence at bind time.

## Discovered Unknowns

(none yet)

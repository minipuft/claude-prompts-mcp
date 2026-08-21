---
title: "OpenCode Client Parity — Close the Five Verified Gaps (P1)"
date: 2026-08-21
status: reference
tags: [opencode, skills-sync, hooks, parity]
---

# OpenCode Client Parity — Close the Five Verified Gaps (P1)

Date: 2026-08-21
Chain: chain-implementation_plan#1
Repos: claude-prompts-mcp (upstream), opencode-prompts (downstream)
Source evidence: two explore-agent reports (adapter capability matrix; hook/enforcement parity), verify-paths probe batch 2026-08-21

## Problem

OpenCode exports drop docs/references/script-tools and ship raw `{% elif %}` markup silently; the plugin mis-blocks legitimate gate exits, false-positive gates from parser drift, and never enforces exported-skill gates. Gap ids: A1, A2 (export fidelity), B2, B4 (plugin correctness), B1 (enforcement).

## Intent

```
work_type     : feature
secondary     : bug_fix
scope         : claude-prompts-mcp/server/src/modules/skills-sync/service.ts (:398-409, :1477-1498, :1608-1622, :1528-1587, :2246); opencode-prompts/.opencode/plugin/index.ts (:92-123, :131-187); opencode-prompts/src/lib/{session-state,types}.ts
risk          : medium — shared compiler change affects ALL clients' exports; plugin blocking can trap legitimate calls if wrong
external_deps : none
next_phase    : design → executed through this plan
confidence    : high
```

## Design Decisions

| Decision              | Chosen                                                                | Rejected                 | Why                                                                 |
| --------------------- | --------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------- |
| A2 strategy           | Handle elif/complex expressions in shared compilers + extend detector | Warn-only                | Silent corruption is worse than loud degradation                    |
| B2 verbs source       | Upstream exports verbs as JSON beside Python module                   | Hand-copy into TS        | Contract-synced single source                                       |
| B4 mechanism          | Generate extraction patterns upstream                                 | Sync two regexes by hand | Drift is the bug; generation eliminates the class                   |
| B1 enforcement moment | Block NEXT tool call while armed-unverdicted                          | Intercept turn end       | OpenCode has no Stop event; mirrors delegation-enforce deny pattern |
| B1 gate manifest      | JSON index.json over runtime YAML parsing                             | Parse gate.yaml in TS    | Plugin stays dependency-free                                        |

## Interfaces

- `gates/index.json`: `{ skill, gates: [{ id, criteria[] }] }` — emitted upstream, consumed by plugin
- `resolution-verbs.json`: string[] — generated upstream, shipped in claude-prompts package, read by plugin pre-tool handler
- `extraction-patterns.json`: `{ step, chainId, gateHeader, structuredVerdict }` regex sources — generated upstream, consumed by Python loader AND TS plugin
- `GateArmedState`: added to plugin ChainState store

## Plan Table

### Tier 1: Upstream export fidelity

| #   | St  | File                             | Change                                                                    | ~Lines | Depends | Verify                                                                                                                                                                                                                      | Justification                                             |
| --- | --- | -------------------------------- | ------------------------------------------------------------------------- | ------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1.1 | ✓   | service.ts:398-409               | Flip opencode capabilities scripts/references/assets → true               | 3      | —       | MEASURED 2026-08-21: dev-workflow export ships docs/ (5 files) proving assets gate; scripts/references share the same branch (:2512/:2584). Authored verify assumed tools/ — dev-workflow has none in source (see DEV-T1-1) | One-line registry fix restoring cursor/codex parity       |
| 1.2 | ✓   | service.ts:1477-1498, :1608-1622 | Extend both compilers: elif chains + complex if-expressions (==, or, not) | ~60    | —       | MEASURED 2026-08-21: new export-template-compile.test.ts (10 tests) green; full suite 2711 passed / 2712 (1 pre-existing skip)                                                                                              | Silent raw-Jinja corruption affects ALL clients today     |
| 1.3 | ✓   | service.ts:1528-1587             | findTemplateFidelityGaps: add elif + unmatched-if detection               | ~15    | 1.2     | MEASURED 2026-08-21: 3 new detector tests green; live export names 16 elif gaps in dev-workflow instead of shipping silently                                                                                                | Detection must land with handling or failure stays silent |

Tier 1 gate: `cd server && npm test && npm run skills:export`, then rg raw Jinja over exported SKILL.md returns nothing.
→ PASSED 2026-08-21: full unit suite 2715 passed / 2716 (1 pre-existing skip), tsc clean; export re-run — **0 raw `{%`/`{{` occurrences in dev-workflow + strategicImplement SKILL.md for BOTH opencode and claude-code targets** (dev-workflow previously shipped 11+ raw tags incl. a shredded nested chain). Compiler rewrite during 1.2 went beyond the lazy-regex plan: nested if chains now resolve via depth-tracking parser (was silently corrupting dev-workflow's phase state machine on every client).

### Tier 2: Generated contracts

| #   | St  | File                                   | Change                                                                                | ~Lines | Depends | Verify                                                                                                                                                                                                                                             | Justification                                         |
| --- | --- | -------------------------------------- | ------------------------------------------------------------------------------------- | ------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 2.1 | ✓   | generator + package.json files array   | Emit resolution-verbs.json beside lib/_generated/resolution_verbs.py; ship in package | ~30    | —       | MEASURED 2026-08-21: generate:contracts run; JSON parses; py/json verb sets IDENTICAL ({cancel, gate_action, gate_verdict}). Packaging: server/package.json ships `hooks` wholesale — no files-array change needed (authored assumption corrected) | TS-consumable contract; hand-copying re-creates drift |
| 2.2 | ✓   | generator + hooks/lib/session_state.py | Generate extraction-patterns.json; wire Python loader to consume                      | ~50    | —       | MEASURED 2026-08-21: 8-fixture baseline captured pre-refactor, post-refactor extraction IDENTICAL; fail-open verified (JSON removed → hardcoded fallback parses correctly); patterns load from generated file when present                         | B4 root fix: one pattern source, two consumers        |
| 2.3 | ✓   | service.ts:2246 emitGateFiles          | Emit gates/index.json manifest {skill, gates:[{id,criteria}]}                         | ~25    | —       | MEASURED 2026-08-21: 3 unit tests green; live export → strategicImplement/gates/index.json exists, 12 manifest ids MATCH 12 gate dirs; 8/12 carry pass_criteria (4 advisory guidance-gates have none in source — faithful)                         | B1 substrate; plugin stays YAML-dependency-free       |

Tier 2 gate: server test suite green; all three artifacts present in fresh export/package.
→ PASSED 2026-08-21: full unit suite 2718 passed / 2719 (1 pre-existing skip), tsc clean; resolution-verbs.json + extraction-patterns.json generated in hooks/lib/_generated/ (shipped via wholesale hooks/ packaging); gates/index.json present in fresh opencode export with ids matching gate directories..

### Tier 3: Downstream plugin correctness

| #   | St  | File                             | Change                                                                                               | ~Lines | Depends | Verify                                                                                                                                                                                                                                                     | Justification                                              |
| --- | --- | -------------------------------- | ---------------------------------------------------------------------------------------------------- | ------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 3.1 | ✓   | .opencode/plugin/index.ts:92-123 | Read resolution-verbs.json; accept verb-carrying resumes; parse {overall:"FAIL"} structured verdicts | ~40    | 2.1     | MEASURED 2026-08-21: enforcement extracted to src/lib/gate-enforcement.ts (evaluateGateBlock pure fn); 8 unit tests green — gate_action passes, string+structured FAIL block, no-verb resume blocks, missing artifact degrades fail-open; full suite 40/40 | Port of upstream 2026-08-20 fix; unblocks legitimate exits |
| 3.2 | ✓   | src/lib/session-state.ts:170-200 | Replace hand-rolled regexes with generated extraction-pattern consumers                              | ~35    | 2.2     | MEASURED 2026-08-21: new src/lib/extraction-patterns.ts loads generated JSON (fail-open defaults); 9 parity tests green incl. complete-paren steps, chain_id param non-match, prose-Gate false-positive eliminated; full suite 49/49                       | Eliminates parser-drift class (false-positive gates)       |
| 3.3 | ✓   | types.ts:33-42, session-state.ts | Add GateArmedState to store; enable file persistence from plugin entry                               | ~30    | —       | MEASURED 2026-08-21: gate_armed added to ChainState; plugin saves with persistToFile=true; 3 restart-recovery tests green (evict memory → disk recovery incl. armed gates; cleanup removes file); validate full pass                                       | State survives restart; enables T4 arming                  |

Tier 3 gate: `npm run validate` in opencode-prompts (typecheck+build+test+artifact verify).
→ PASSED 2026-08-21: typecheck clean, build ok, 52/52 tests, package artifact self-test + verification PASSED (53950 packed / 254504 unpacked)..

### Tier 4: Exported-skill gate enforcement (B1)

| #   | St  | File                                                          | Change                                                                                                 | ~Lines | Depends  | Verify                                                                                                                                                                                                                                                                    | Justification                                                           |
| --- | --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 4.1 | ✓   | .opencode/plugin/index.ts tool.execute.after                  | Detect read-type tools resolving inside skills dirs with sibling gates/index.json → arm GateArmedState | ~45    | 2.3, 3.3 | MEASURED 2026-08-21: detectSkillGateArm pure fn in gate-enforcement.ts; 4 unit tests green (real manifest arms, non-read no-op, outside-skills no-op, corrupt/missing fail-open); wired into tool.execute.after with persistToFile=true                                   | Mechanical-review substrate already ships; makes it load-bearing        |
| 4.2 | ✓   | .opencode/plugin/index.ts tool.execute.before + event handler | Armed-unverdicted/FAIL throws next call; disarm on GATE_REVIEW grammar match                           | ~50    | 4.1, 3.1 | MEASURED 2026-08-21: evaluateArmedGateBlock + disarmGate; 4 unit tests green (armed blocks unrelated tool naming gates, PASS string+structured disarm, FAIL escalates); plugin before-handler checks armed FIRST across all tools; full suite 60/60; validate gate PASSED | Mirrors delegation-enforce deny pattern; no Stop event exists to mirror |

Tier 4 gate: full plugin suite + scripted flow against running OpenCode.
→ PASSED 2026-08-21: npm run validate full pass (typecheck+build+52→60 tests+artifact verify 56858 packed). Scripted live drive deferred to Tier 5.3 by design..

### Tier 5: Integration, docs, live drive

| #   | St  | File                                      | Change                                                                                  | ~Lines | Depends                 | Verify                                                                                                                                                                                                                                                                                                                                                                                                  | Justification                                                |
| --- | --- | ----------------------------------------- | --------------------------------------------------------------------------------------- | ------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 5.1 | ✓   | docs/guides/skills-sync.md, server README | Update capability matrix + adapter docs for flipped flags, new artifacts, elif handling | ~40    | 1.1, 1.2, 2.1, 2.2, 2.3 | MEASURED 2026-08-21: guide gains Template Compilation Fidelity section + OpenCode-enforcement-via-plugin paragraph; output-dir table corrected earlier; grep confirms no stale claims (no ~/.opencode/skills; "Claude Code only" correctly scoped to the Stop hook)                                                                                                                                     | Docs already misstated output dirs once                      |
| 5.2 | ✓   | opencode-prompts README.md                | Document exported-skill gate enforcement + state persistence                            | ~20    | 4.1, 4.2                | MEASURED 2026-08-21: Features list gains Exported-Skill Gates + restart-durable persistence; new subsection documents arm→block→disarm flow with real output shape and resolution-verb behavior                                                                                                                                                                                                         | User-facing promise must match behavior                      |
| 5.3 | ✓   | — verification only                       | Fresh export → drive the built plugin through the real handler sequence                 | 0      | 5.1, 5.2                | MEASURED 2026-08-21: scripted live drive of dist/.opencode/plugin/index.js against the REAL strategicImplement export on disk — read armed gates, bash BLOCKED, prompt_engine PASS disarmed, bash allowed. SUBSTITUTION recorded: a restart-drive of the maintainer's live OpenCode session was not safe from inside it; the scripted drive executes the identical compiled handlers end-to-end instead | Final tier requires build + live drive, not only green gates |

Tier 5 gate: both repos' full validation suites green + live-drive observation recorded in implementation notes.
→ PASSED 2026-08-21: upstream 2718/2719 unit green + tsc clean; downstream validate full pass (60/60 + artifact verify); live drive ALL CHECKS PASSED (recorded in implementation notes).

New-file justifications: resolution-verbs.json / extraction-patterns.json are generated artifacts beside existing _generated modules; gates/index.json is an export artifact from existing emitGateFiles — no new source modules.

Execution dispatch: T1 standard · T2 standard · T3 heavy (blocking semantics can trap legitimate calls) · T4 heavy (new enforcement surface) · T5 main thread (never-delegate: gate verdicts, live drive, scope check).

## §Open Questions

- **OQ-1** — RULED 2026-08-21 → implementation-notes.md: hard block from day one, mirroring delegation-enforce's deny pattern; fail-open on missing artifacts so a stale install degrades to today's behavior rather than trapping calls.
- **OQ-2** — RULED 2026-08-21 → implementation-notes.md: artifact location = `hooks/lib/_generated/` beside the Python twin.

## Validation & Completion

Testing strategy:

| What to test                          | Test type                  | Location                      | Why this type                                 |
| ------------------------------------- | -------------------------- | ----------------------------- | --------------------------------------------- |
| Compiler elif/expression handling     | Unit                       | server tests/unit/skills-sync | Pure function transforms with fixture inputs  |
| Fidelity gap detection                | Unit                       | server tests/unit/skills-sync | Detector output on crafted IR                 |
| Artifact generation (.json manifests) | Unit + snapshot            | server tests/unit/skills-sync | Generated content must match contract shape   |
| Verb/structured-verdict acceptance    | Unit                       | opencode-prompts tests        | Blocking logic branches on parsed input       |
| Parser parity TS vs Python            | Shared-fixture integration | both repos, one fixture file  | Cross-implementation agreement is the point   |
| Restart recovery / persistence        | Unit with temp dirs        | opencode-prompts tests        | File round-trip behavior                      |
| Arm → block → disarm sequence         | Integration                | opencode-prompts tests/e2e    | Multi-handler stateful flow                   |
| Live client flow                      | Manual live drive          | real OpenCode session         | Final proof; green gates predict nothing here |

Done criteria:

| Criterion   | Validation                        | Pass Condition                                                   |
| ----------- | --------------------------------- | ---------------------------------------------------------------- |
| A1 closed   | fresh export listing              | ~/.config/opencode/skills/dev-workflow contains docs/ and tools/ |
| A2 closed   | rg raw Jinja over exports         | zero `{%` / `{{` occurrences; warnings name gaps instead         |
| B2 closed   | plugin unit suite                 | gate_action/cancel pass; string + object FAIL block              |
| B4 closed   | shared fixture run                | TS and Python extract identical ChainState                       |
| B1 closed   | scripted flow vs running OpenCode | armed gate blocks next call; GATE_REVIEW disarms                 |
| Both suites | npm test / npm run validate       | green in both repos                                              |

Documentation:

| Doc                        | Update Needed                                     |
| -------------------------- | ------------------------------------------------- |
| docs/guides/skills-sync.md | capability matrix, adapter section, artifact list |
| server README              | skills-sync bullet updates                        |
| opencode-prompts README    | enforcement + persistence sections                |

Risks:

| Risk                                                       | Impact | Mitigation                                                               | Rollback                         |
| ---------------------------------------------------------- | ------ | ------------------------------------------------------------------------ | -------------------------------- |
| Compiler change alters existing good exports               | medium | snapshot tests before/after; elif handling strictly additive             | revert service.ts hunks          |
| Plugin block traps unforeseen legitimate calls             | high   | OQ-1 default mirrors proven deny pattern; fail-open on missing artifacts | flip to warn-only flag           |
| Generated patterns drift from hand-written Python behavior | medium | fixture suite asserts identical extraction pre/post                      | keep old regexes behind fallback |
| Capability flip surfaces broken tools/docs in OpenCode     | low    | export inspection before release                                         | re-flag capabilities false       |

Release: conventional commits — `fix(skills-sync): ...`, `feat(plugin): ...`, scope per repo.

Growth capture:

- [ ] Pattern worth capturing: generated-contract pattern for cross-language parser sync (candidate for /knowledge-capture after T3)
- [ ] Memory update: opencode adapter output dir is ~/.config/opencode/skills (docs were stale)
- [ ] Skill correction: none yet

## Changelog Entry (planned)

Fixed: OpenCode exports carry docs/references/script tools, compile elif/complex conditionals instead of shipping raw Jinja, and exported-skill gates are mechanically enforced by the opencode-prompts plugin; plugin accepts legitimate gate exits and structured FAIL verdicts.

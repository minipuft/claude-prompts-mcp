---
title: Creation prompt alignment implementation notes
status: reference
date: 2026-09-30
tags: [prompts, contracts, workflows]
---

# Creation prompt alignment implementation notes

## Rulings

- R1-R6: see plan; canonical server validation remains authoritative. Gate/framework do not expose validate, so their prepared drafts cannot auto-create.

## Findings

- Baseline main HEAD 46a4b8146; unrelated dirty main changes retained. Worktree bootstrap verified executable hooks and linked dependencies; no installation needed.
- The earlier audit confirmed three nonmutating prompt drafts including reusable edges/budget/artifacts and own child scaffold references.
- DEV-T1-1: resource row extended from 15 to 17 files after worker found two stale tool description.md files claiming old scoring/immediate creation; MCP must update injected descriptions too.
- DEV-T1-1 correction: only framework_builder has description.md; gate description is inline tool.yaml. The resource writer will remove/re-add the framework tool through MCP to remove its obsolete sidecar because normal MCP tool replacement cannot delete it.
- DEV-T1-2: read-only sibling audit expanded docs row from 3 to 8 files: script-tools/frameworks guides, architecture overview, and two portfolio descriptions claimed authoring auto-creation or mandatory adapter scoring. Generic auto_execute and canonical framework validation remain supported and their tests remain unchanged.

## Validation

Completed; final evidence below.

- Row 1.2 accepted after spot-reading actual checker and mutation tests: 43 tests in 2 focused suites; real CLI and self-test pass, scripts typecheck, ESLint, formatting, suite membership pass. Root independently reran CLI+self-test and saw all3 builders align. Documentation row dispatched to same worker; no memory updates.
- User requested retry after two production agents hit usage limit. Existing edits were remeasured, retained, and workers resumed successfully; no duplicate edits or source rollback.
- Rows 1.5/1.6: 65 tests across 4 focused suites, source typecheck/build, and both deliberate mutations passed. Baseline ESLint comparison found no new findings. Isolated MCP all3 design renders passed; full prompt draft validated with tools:[] retained, gate/framework produced non-executing drafts; no smoke draft ID was written.
- R9: normalize base guard fixtures to owner-valid transport shapes and check them against resourceManagerInputSchema; current opacity probes included unsupported visibility/frequency/cost values. Keep malformed opacity tests isolated; domain/resource validity remains server-owned. Row1.2 owner will update its own fixtures/check/tests and docs statements.
- Full validate:all first run: 74/79 passed. Own failures: new test diagnostic, three resource template formatting mismatches, and plan frontmatter vocabulary; fixed by row owner/parent. Readme count and preexisting interview-boundary plan stamps remain to attribute. All lint/source architecture/schema/contract gates passed.
- Fresh end-to-end lifecycle: both STDIO and HTTP passed 35 calls each, four creates/four MCP deletes each; temp workspace receipts proved actual write root. Structural YAML budget receipt mismatch separately captured, not suppressed.
- R10: add bounded receipt fix row1.7; compare normalized loaded budget through its existing owner and independently compare authored structural caps in actual YAML so writer loss stays detectable. Retain existing YAML runtime semantics and document structural caps as enforced only for explicit Workflow IR submissions, not saved-YAML count narrowing.
- Baseline attribution: HEAD contains 52 bundled prompt.yaml files and unchanged README claims 51; current worktree still has 52. Main readme validator also fails (58 due unrelated in-progress untracked prompts). Preexisting interview-boundary-2026-09-27 rows match HEAD and are unchanged by this task. These two checks are existing repository issues, not introduced by authoring updates.
- Docs budget followup accepted: 93 local links resolve; YAML declared structural knobs versus IR submission checks are now stated accurately. Parent source semantics remain unchanged.
- Row1.7 accepted after source/receipt spot-read: 62 focused tests, two snapshot-mutation failures, source/build/tests-typecheck/ESLint/format pass. Full structural-budget lifecycle now passes both transports with declared caps checked in affected parent YAML.
- Final validate:all run: 77/79 pass. Only attributed HEAD-baseline README count and interview-boundary plan stamps fail; all task-related checks including all ratchets, architecture, schemas, format, new guard and plan frontmatter pass. Full test:all now running.

- Live design smoke failed with optional array/object arguments synthesized as empty strings. Captured receipt /tmp/creation-authoring-error-receipts.json. Read-only diagnosis found TWO validation boundaries, so an enrichment-only filter is insufficient. Added rows 1.5/1.6 for parser omission semantics and explicit-empty-array script extraction; no fake authored defaults.
- DEV-T1-3: source detector path was authored as modules/script-tools/detection; measured defining path is modules/automation/detection/tool-detection-service.ts. Corrected row ownership before edits.
- R8: worker found Number('') and z.coerce.number preserve an existing explicit blank-to-zero behavior. Ruled not to broaden absence repair into numeric coercion changes; malformed blank object/array inputs must still fail and actual authored falsy values must survive.

- Full test:all reached a YAML-quoted phase-header selftest failure (removed authoring example was its fixture), then Node default2GB heap OOM. Added bounded row1.8 to isolate the selftest fixture; parent will run identical unit/integration/e2e paths sequentially with explicit4GB Node heap.
- Final compatibility review: detector null filtering was newly introduced alongside empty-array repair. Reopened row1.6 to preserve old explicit-null behavior and defer validity to custom script schema; undefined/blank placeholders still absent.
- Row1.8 accepted: phase selftest, focused script test and three isolated extraction/quote mutations pass. Production extraction unchanged. Null compatibility controls pass, restoring null filtering fails two regressions.
- Full tests with4GB heap and explicit GC: unit335suites/5944passed/1skipped/3snapshots; integration114suites/1344passed/2snapshots. Both exit0. End-to-end suite now running. Final lint/tests-type ratchets and real authoring CLI+selftest pass.

- Full end-to-end suite exit0:47suites600passed2skipped. Combined required suite coverage496suites7888passed3skipped; identical project unit/integration/e2e paths run with4GB/exposed GC after default-heap OOM. Final architecture/scripts/format pass after last scoped fixes. Main integration authorized with41file manifest, checked25file nonresource patch and16resource paths viaMCP.

## Final acceptance and growth

All 41 named files match main after checked patch plus serial MCP updates. Resource roots are main/server/resources/prompts; create_prompt, create_gate and create_framework each loaded at version 2. Main source typecheck, authoring CLI, existing test-type ratchet (341 baseline diagnostics) and build pass. Fresh main-built servers passed both transports, including structural-budget receipts and child scaffolding. Basic renders pass on the cached active server.

Full tests: 335 unit suites / 5,944 passed / one skipped; 114 integration suites / 1,344 passed; 47 e2e suites / 600 passed / two skipped. Direct Node runners used the exact project paths with 4 GB heap and exposed GC after npm test:all hit the default heap limit. All runs exited zero. Final lint, scripts typecheck, architecture, format and guard checks pass on the accepted tree. Full validation retained two attributed HEAD-baseline failures (README count and old interview plan stamps).

Integration preserved all 35 unrelated dirty files, the existing index and HEAD. The index still lists the deleted framework sidecar until staging; no unrequested staging was performed in main. Active cached binary is unchanged and must be refreshed to load runtime code fixes. No commit, cache update, configuration change or public artifact was created.

Growth: confirmed canonical projection ownership, absence versus authored values, normalized runtime views versus persisted declarations, and isolated mutation controls. Durable evidence lives in regression tests and docs; no global skill/rule/memory changes. Temporary drivers and receipts are deleted after this summary; the isolated worktree can be removed after source/plan disposition is verified.

Governing reference: [creation authoring alignment](creation-authoring-schema-sync-2026-09-30.md).

- Final scoped gate self-review: PASS for preflight, integration and plan quality; creed n/a (no visual surface). Attempted MCP verdict for original strategic signal returned no stored execution blueprint, so no recorded server verdict is claimed. Local retirement lint passes in provider mode local; no GitHub operations performed.

## Accepted file ownership

- `CHANGELOG.md`
- `docs/architecture/overview.md`
- `docs/guides/frameworks.md`
- `docs/guides/mcp-contract-maintenance.md`
- `docs/guides/script-tools.md`
- `docs/portfolio/case-study.md`
- `docs/portfolio/design-decisions.md`
- `docs/reference/chain-schema.md`
- `docs/reference/mcp-tools.md`
- `docs/reference/workflow-ir.md`
- `server/package.json`
- `server/resources/prompts/examples/create_framework/prompt.yaml`
- `server/resources/prompts/examples/create_framework/tools/framework_builder/description.md`
- `server/resources/prompts/examples/create_framework/tools/framework_builder/schema.json`
- `server/resources/prompts/examples/create_framework/tools/framework_builder/script.py`
- `server/resources/prompts/examples/create_framework/tools/framework_builder/tool.yaml`
- `server/resources/prompts/examples/create_framework/user-message.md`
- `server/resources/prompts/examples/create_gate/prompt.yaml`
- `server/resources/prompts/examples/create_gate/tools/gate_builder/schema.json`
- `server/resources/prompts/examples/create_gate/tools/gate_builder/script.py`
- `server/resources/prompts/examples/create_gate/tools/gate_builder/tool.yaml`
- `server/resources/prompts/examples/create_gate/user-message.md`
- `server/resources/prompts/examples/create_prompt/prompt.yaml`
- `server/resources/prompts/examples/create_prompt/tools/prompt_builder/schema.json`
- `server/resources/prompts/examples/create_prompt/tools/prompt_builder/script.py`
- `server/resources/prompts/examples/create_prompt/tools/prompt_builder/tool.yaml`
- `server/resources/prompts/examples/create_prompt/user-message.md`
- `server/scripts/run-validation-suite.js`
- `server/scripts/validate-authoring-contracts.ts`
- `server/scripts/validate-phase-header-drift.js`
- `server/src/engine/execution/parsers/argument-parser.ts`
- `server/src/mcp/tools/resource-manager/prompt/services/prompt-mutation-receipt-service.ts`
- `server/src/modules/automation/detection/tool-detection-service.ts`
- `server/src/modules/prompts/yaml-prompt-loader.ts`
- `server/tests/unit/execution/parsers/argument-parser.test.ts`
- `server/tests/unit/execution/pipeline/command-parsing-stage.test.ts`
- `server/tests/unit/mcp-tools/resource-manager/prompt/prompt-mutation-receipt-service.test.ts`
- `server/tests/unit/resources/bundled-script-tool-fixtures.json`
- `server/tests/unit/resources/bundled-script-tool-params.test.ts`
- `server/tests/unit/scripts/detection/tool-detection-service.test.ts`
- `server/tests/unit/scripts/validate-authoring-contracts.test.ts`

# Roadmap

What's next for Claude Prompts MCP.

---

## Next Up

### 🌐 Web UI for Prompt Management

**Problem**: Editing JSON/Markdown works for developers. Non-technical teammates can't participate. No visual feedback when building chains.

**Solution**: Browser-based editor over the existing MCP server. Live preview. Drag-and-drop chain builder. Hot-reload keeps everything synced.

**Expect**: Open `localhost:3000`, build a prompt visually, test it—Claude sees it immediately. Zero file editing.

**Foundation**: `prompts/hot-reload-manager.ts`, SSE transport, `resource_manager` CRUD.

---

### 🔌 VS Code Extension

**Problem**: Context-switching kills flow. You're coding, want to run a prompt, have to open Claude Desktop or a terminal.

**Solution**: Command palette integration. Select code → run prompt on selection. Results inline.

**Expect**: `Cmd+Shift+P` → "Run Prompt: code_review" → output appears next to your code.

**Foundation**: STDIO transport works with any client. Needs a VS Code wrapper.

---

## Exploring

### 🧪 Prompt Optimization Loop

**Problem**: You don't know if a prompt is good until you run it many times. Manual A/B testing is tedious.

**Solution**: Run a prompt N times with variations. Score against gates automatically. Surface the winner.

**Expect**:

```
prompt_engine(command:">>code_review", optimize:{runs:10, gate:"quality-score"})
→ Returns best-performing variant with scores
```

**Foundation**: Gate system scores outputs. Chain sessions track runs. Missing: variation generator, scoring aggregator.

---

### 🤝 Team Workspaces

**Problem**: Prompts are local files. Sharing means copy-paste or git repos. No visibility into what your team uses.

**Solution**: Optional remote sync. Push/pull to shared workspace. Usage stats across team.

**Expect**:

```
resource_manager(resource_type:"prompt", action:"push", workspace:"team-acme")
→ Local prompts sync to team library
```

**Foundation**: Local file storage, hot-reload. Missing: remote storage adapter, auth layer.

---

### 🔐 Access Control

**Problem**: All prompts visible to anyone with server access. Some contain sensitive logic.

**Solution**: Per-prompt permissions. API key scoping. Audit log.

**Expect**: Tag a prompt `private: true`—only authenticated users with the right scope can execute.

**Foundation**: Config-based settings. Missing: auth middleware, permission model.

---

## Technical Debt

| Area                 | Now       | Target                   | Plan                                                                                |
| -------------------- | --------- | ------------------------ | ----------------------------------------------------------------------------------- |
| Test coverage        | Unit only | Unit + Integration + E2E | [test-modernization-roadmap](../plans/techincal_debt/test-modernization-roadmap.md) |
| Coverage enforcement | None      | 80% threshold            | [test-modernization-roadmap](../plans/techincal_debt/test-modernization-roadmap.md) |
| TypeScript strict    | Full      | Keep strict enabled      | -                                                                                   |
| Bundle size          | ~4.5MB    | < 2MB (tree-shaking)     | -                                                                                   |

### Known Issues — Argument & Gate Pipeline

Found 2026-07-28 while authoring a prompt with `inline_gate_definitions`. All reproduced against v2.1.0.

**Tier-gated plan**: [arg-gate-pipeline-fixes.md](../plans/techincal_debt/arg-gate-pipeline-fixes.md) — T0 ✓ and T1 ✓ complete ([ADR 0001](adr/0001-gate-resolution-precedence.md) accepted). **T1.5 (one owner for gate resolution) now blocks T2/T3** — discovery found gate selection split across three places, two of them unreachable. Resume with `>>tier_execute plan_file:"plans/techincal_debt/arg-gate-pipeline-fixes.md" tier_id:"T1.5"`.

- [x] **Single-quoted option baking corrupts values containing apostrophes.** _(FIXED 2026-07-28, T0 — `serializeOptionValue`/`parseQuotedValue` in `jsonUtils.ts`; both `argument-parser.ts` regexes now share one escape-aware convention. Uncommitted.)_ `mergeOptionsIntoCommand` ([`00-request-normalization-stage.ts:216`](../server/src/engine/execution/pipeline/stages/00-request-normalization-stage.ts)) serializes MCP `options` string values as `` `'${value}'` `` with no escaping; the key/value regex ([`argument-parser.ts:249`](../server/src/engine/execution/parsers/argument-parser.ts)) then matches `'([^']*)'` and stops at the first embedded `'`. The value is silently truncated **and** trailing prose is re-parsed into phantom arguments — `theme:'… the creed line 'the void' … Target: dark ground.'` yields `theme` truncated plus a spurious `Target` argument. Fix: escape embedded quotes, or select a quote character not present in the value. Severity: silent data corruption + argument injection.

- [ ] **Inline gate definitions load but never execute.** `gateConfiguration.inline_gate_definitions` is documented as "Custom gate rules for this prompt" ([`prompt-yaml-schema.md`](reference/prompt-yaml-schema.md)), and the loader validates and stores it — but every consumer is display or analysis (`chain-session-router.ts:287`, `gate-analyzer.ts:394`, `prompt-lifecycle-processor.ts:149`, `prompt-discovery-processor.ts:335`). Nothing reaches gate selection. _(Resolved in [ADR 0001](adr/0001-gate-resolution-precedence.md) (b)/(d): wire them in via the existing `TemporaryGateRegistry` seam at rank 60, with two-release warn-then-arm. Plan T3.)_ ⚠️ The claim that the running gates come from `category-extractor.ts` is **wrong** — `selectGatesWithPrecedence` and `selectGatesWithEnhancedPrecedence` there have zero callers. Live category gates come from `gateManager.getCategoryGates()` via `execution-planner.ts:501`; plan item 1.5.4 deletes the dead pair.

- [ ] **No per-prompt opt-out of framework system-prompt injection.** _(Approach decided in [ADR 0001](adr/0001-gate-resolution-precedence.md) (a)/(c): prompt tier between step and chain; nesting scoped to `gate_type: 'framework'`. Implementation in plan T1.5 + T2.)_ ⚠️ **Correction to the line below**: `framework_gates: false` disables _nothing_ today. The planner's framework filter ([`execution-planner.ts:154`](../server/src/engine/execution/planning/execution-planner.ts)) reads `enhancedGateConfiguration`, which has five readers and **zero writers** repo-wide, so the flag never fires. A prompt's YAML value lands in `gateConfiguration.framework_gates`, which that filter does not consult. Plan item 1.5.5 deletes the phantom field and arms the flag. Original text follows — `framework_gates: false` was believed to disable framework _gates_ only, as documented — but a self-contained prompt carrying its own section contract has no way to refuse the _system-prompt_ injection, so an active CAGEERF/SCAMPER is prepended over it. The injection hierarchy has no prompt level, and the category level (`hierarchy-resolver.ts:323`) reads `config.categories`, which is absent from `config.json` and `config.schema.json` — programmatic-only. Current workaround is the `%clean` / `%lean` call-site modifier. Proposal: a prompt-level injection block, or extend `framework_gates` semantics.

- [ ] **Silent-drop normalizer for inline gates.** `normalizeInlineGateDefinitions` ([`yaml-prompt-loader.ts:89`](../server/src/modules/prompts/yaml-prompt-loader.ts)) `continue`s past any definition missing `name`/`type`/`scope`/`description`/`guidance`, and discards `severity`, `enforcementMode` and `retry_config` — all three of which [`gate-configuration.md`](reference/gate-configuration.md) documents as valid. A config following the docs loads with zero errors and zero gates. Fix: warn on drop, and scope the doc page to standalone `gate.yaml`.

### CI / Quality Gates (Remaining Work)

- [x] Enable strict TypeScript semantics in `server/tsconfig.json`: `noPropertyAccessFromIndexSignature`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- [x] Add a lint ratchet strategy: keep `tests/**` excluded initially, fail CI on new violations (`server/.eslint-ratchet-baseline.json`), and tighten scope once baseline is reduced.
- [x] Align core CI gates with server scripts: `npm run typecheck` + `npm run lint:ratchet` + tests in CI/PR workflows.
- [x] Ensure build output is exercised in CI: run `npm run build` and `npm run start:test` across the Node matrix.
- [x] Add toolchain pinning for developers: commit `.node-version` for the Node 24 development and publish toolchain.
- [x] Align rule docs with the new workflow: update `AGENTS.md` and `CLAUDE.md` to match scripts, docs taxonomy, and the ESLint ratchet approach.
- [ ] Ensure PR workflows run the architecture gates: `npm run validate:arch` and decide whether warnings should fail the build once cycles are resolved.
- [x] Ensure generated artifacts stay in sync in CI: `npm run validate:contracts` and `npm run validate:metadata`.
- [x] Decide support policy and enforce via CI matrix (Node versions / OS): server CI verifies Node 22.13.0 and 24 on `ubuntu-latest`; the standalone CLI runtime remains >=18.18.0. (An OS matrix can be added later if scripts are made cross-platform.)

### Test Modernization

See [test-modernization-roadmap.md](../plans/techincal_debt/test-modernization-roadmap.md) for the comprehensive 6-phase plan:

- [ ] **Phase 1**: Coverage infrastructure (thresholds, CI, helpers)
- [ ] **Phase 2**: Test classification audit & migration (8 sub-phases analyzing all 67 test files)
- [ ] **Phase 3**: Missing unit test coverage (8 subsystems without tests)
- [ ] **Phase 4**: Integration test suite (MCP protocol, chains, hot-reload, pipeline)
- [ ] **Phase 5**: E2E test suite (STDIO/SSE transports, MCP compliance)
- [ ] **Phase 6**: Test quality improvements (remove implementation detail tests, consolidation)

---

## Contributing

Ideas welcome. [Open an issue](https://github.com/minipuft/claude-prompts/issues) with the `enhancement` label.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for dev setup.

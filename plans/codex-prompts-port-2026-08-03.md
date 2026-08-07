---
title: "codex-prompts: Codex CLI Downstream Port"
date: 2026-08-03
status: active
tags: []
---

# codex-prompts: Codex CLI Downstream Port — Implementation Plan (2026-08-03)

**Status**: COMPLETE — all tiers (0-5) executed 2026-08-03, plus a user-requested isolation validation (global MCP server disabled) that passed end-to-end under sandbox bypass and surfaced a third divergence pair: Codex sandboxes MCP server children under a fixed profile, and the packaged claude-prompts server writes package-relative, ignoring `MCP_WORKSPACE` (upstream defect → backlog). All four spikes answered; Tier 3 surfaced + fixed the gate-enforce structured-verdict bug. Commits pending user approval in all three repos. Details: implementation-notes deviations 16-17.
**Origin**: `>>implementation_plan` chain `chain-implementation_plan#1`, grounded in a 3-repo inventory sweep + official Codex docs research (2026-08-03).
**Companion file**: `plans/codex-prompts-port-implementation-notes.md` (create at execution start; log deviations under `## Deviations`).

---

## Decisions most likely to change (read these first)

1. **Port style = gemini pattern, thinner.** Python adapters + npm dep on `claude-prompts@^2` + `hooks/lib` symlink. Codex's hook contract is a near-clone of Claude Code's (same event names, stdin JSON, `hookSpecificOutput.permissionDecision`, `decision:block`, `stop_hook_active`, `CLAUDE_PLUGIN_ROOT` alias), so most adapters are importlib shims, not rewrites.
2. **All 9 hooks port — including the two both prior ports dropped.** `ralph-stop.py` works because Codex `Stop` supports stop-blocking; `subagent-gate-enforce.py` becomes portable via Codex `SubagentStop` + `agent_transcript_path` — gated on Spike S1 (transcript JSONL shape).
3. **Four spikes before any committed code** (S1 transcript format, S2 tool names, S3 directive token size vs `additionalContextLimit`, S4 legacy marketplace path). Two plan steps are conditional on their outcomes.
4. **Zero new upstream files.** All claude-prompts-mcp changes extend existing files: `workspace.py`, `cli_spawner.py`, `model_strategies.py`, `skills-sync.yaml`, `extension-alignment.md`, `CHANGELOG.md`.
5. **Already done upstream (discovered during verification, do NOT re-implement):** `CLIENT_REGISTRY.codex` exists in `server/src/modules/skills-sync/service.ts:~355` (variant `codex`, outputDir `~/.codex/skills`). The skills-sync step is config-only (`registrations.codex` in `server/skills-sync.yaml`).

## Codex platform facts this plan depends on

- Hooks experimental: `[features] hooks = true` in `config.toml`; no Windows. Floors: hooks v0.114, `UserPromptSubmit` v0.116, `Pre/PostToolUse` v0.117, stable ~v0.124. Plan floor: **>=0.117**.
- Events: SessionStart/SessionEnd, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, Pre/PostCompact, Stop, SubagentStart/SubagentStop.
- Output shapes match Claude Code: `hookSpecificOutput.{permissionDecision, permissionDecisionReason, additionalContext}`, top-level `{"decision":"block","reason"}`, exit 2 = block. Plain stdout is context for SessionStart/SubagentStart/UserPromptSubmit.
- Plugin: `.codex-plugin/plugin.json` (required) + `hooks/hooks.json` (auto-discovered) + `skills/<name>/SKILL.md`. Env: `PLUGIN_ROOT`, `PLUGIN_DATA`, plus `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA` aliases.
- Marketplace: `.agents/plugins/marketplace.json`; a legacy-compatible `.claude-plugin/marketplace.json` path exists (S4 tests whether minipuft-plugins serves Codex as-is).
- Trust: plugin hooks need explicit user approval (`/hooks`); trust is recorded against hook hash and re-required on change. Document, never bypass.
- `additionalContextLimit` default ~2500 tokens; overflow spills to disk with only a preview shown to the model — breaks imperative directives (S3 sizes the override).
- Hosted tools (WebSearch) don't fire Pre/PostToolUse; timeouts are in **seconds** (like Claude Code, unlike Gemini's ms).

Sources: learn.chatgpt.com/docs/hooks · developers.openai.com/codex/plugins/build · developers.openai.com/codex/config-advanced

---

## Phase 1 — Discovery & Triage

```
search_type   : exploratory + dependency_trace
queries_run   :
  - [Explore agent, 33 tool uses] hooks/, hooks/lib/, hooks.json, minipuft-plugins, gemini-prompts, opencode-prompts → per-hook inventory, port comparison, event maps
  - [WebFetch] learn.chatgpt.com/docs/hooks → events, stdin schema, output shapes, trust, context limits
  - [WebFetch] developers.openai.com/codex/plugins/build → plugin.json schema, hooks bundling, marketplace formats
  - [rg] workspace.py → chain MCP_WORKSPACE → CLAUDE_PLUGIN_ROOT → GEMINI_EXTENSION_PATH/extensionPath; no Codex branch
  - [ls/rg] synchronize-downstream-lock.js exists (parameterized); extension-alignment.md:30 stale PreCompact row, no Codex column
  - [python] hooks.json → 7 hooks / 5 events registered; subagent-gate-enforce.py + session-skills.py unregistered
sibling_patterns : gemini-prompts = canonical template (Python + npm dep + lib symlink + thin adapters; importlib shim for ralph-stop); opencode-prompts = anti-pattern here (TS rewrite, dropped UserPromptSubmit/Stop/SubagentStop)
domain_ownership : hooks/ + hooks/lib/ (Python core; workspace.py is the only host-coupled seam); server/scripts/ (lock sync); server/src/modules/skills-sync/ (export); .claude/rules/extension-alignment.md (cross-client map SSOT); new repo codex-prompts (adapters + manifest)

intent:
  work_type     : feature
  secondary     : refactor (upstream seam extensions)
  scope         : NEW codex-prompts/ (.codex-plugin/plugin.json, hooks/hooks.json, hooks/*.py adapters, hooks/lib symlink, package.json, tests/, README); UPSTREAM hooks/lib/{workspace,cli_spawner,model_strategies}.py, server/skills-sync.yaml, lock-sync call sites, .claude/rules/extension-alignment.md; CONDITIONAL minipuft-plugins marketplace
  risk          : medium — Codex hooks experimental/flag-gated; SubagentStop transcript format unverified; tool-name table unconfirmed
  external_deps : codex CLI >=0.117 (runtime host); claude-prompts@^2.0.0 (npm dep of new repo); hooks stay stdlib Python 3
  problem       : Codex CLI users have no access to chain/gate/delegation/Ralph hook workflows → codex-prompts plugin ports all 9 hooks with near-verbatim adapters + upstream seams + docs/skill updates
  next_phase    : design
confidence    : high
uncertain     : S1 transcript shape · S2 tool names · S3 directive size vs context limit · S4 legacy marketplace path
```

### Hook inventory (upstream `hooks/`, all Python 3 stdlib, registration in `hooks/hooks.json`)

| Hook                                      | Event (matcher)                        | Portability to Codex                                                                                 |
| ----------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `prompt-suggest.py`                       | UserPromptSubmit (`*`)                 | Near-verbatim (event + `prompt` field + additionalContext all match)                                 |
| `gate-enforce.py`                         | PreToolUse (`.*prompt_engine`)         | Verbatim (`permissionDecision:"deny"` identical); matcher still hits `mcp__*__prompt_engine`         |
| `delegation-enforce.py`                   | PreToolUse (`Edit\|Write\|Bash\|Task`) | Ports with CODEX_TOOL_NAMES remap (S2)                                                               |
| `post-prompt-engine.py`                   | PostToolUse (`.*prompt_engine`)        | Verbatim                                                                                             |
| `ralph-context-tracker.py`                | PostToolUse (`Edit\|Write\|Bash`)      | Ports with tool-name remap                                                                           |
| `ralph-stop.py`                           | Stop (timeout 120s)                    | Ports — Codex Stop supports `decision:block` + `stop_hook_active`; needs `codex exec` spawn strategy |
| `compact-recovery.py`                     | SessionStart (`compact`)               | Verbatim — Codex has `source:compact` + stdout-is-context                                            |
| `subagent-gate-enforce.py` (unregistered) | SubagentStop                           | Portable pending S1 (`agent_transcript_path` exists in Codex)                                        |
| `session-skills.py` (unregistered)        | SessionStart (`startup\|resume`)       | Verbatim; point at `~/.codex/skills`                                                                 |

Shared core `hooks/lib/` (3,342 LOC) is host-agnostic except `workspace.py` env chain. Both prior ports reuse it unchanged (gemini: symlink; opencode: TS reimplementation).

---

## Phase 2 — Design & Pre-flight

```
scope:
  objective     : Ship a codex-prompts plugin repo that runs all 9 hooks under Codex CLI by reusing hooks/lib unchanged behind thin per-event adapters, with minimal upstream seam extensions.
  success_signal: With hooks enabled: >>syntax directive injected on prompt submit; gate FAIL denies prompt_engine; delegation deny fires; ralph-stop blocks Stop and re-feeds reason; compact recovery injects chain state.
  non_goals     : No TS rewrite; no new hook capabilities beyond parity; no Windows; no codex-marketplace.com submission this pass; codex-plugins skill authored AFTER empirical validation.
  constraints   : stdlib Python 3 only; lib symlinked never copied; Codex >=0.117; trust flow documented, never bypassed.

pre_flight: all 13 checks pass, 0 failures, compound: none (probes recorded in chain transcript; highlights below)
  - contracts : Codex stdin/output shapes matched field-by-field against official docs
  - service   : extends existing ModelStrategyRegistry + SpawnConfig — no new services
  - defined   : lib symlinked; operator regexes stay SSOT from tooling/contracts/registries/operators.json
  - reuse-scope: multi-client seams already exist (workspace env chain, strategy registry, parameterized lock sync)

identification:
  behavior  : translates Codex hook lifecycle I/O into calls against host-agnostic hooks/lib core; re-serializes decisions into Codex shapes
  state     : config (manifest, hooks.json) + delegated lifecycle state (SQLite via lib); adapters stateless
  shape     : module — repo of thin script modules + manifest
  placement : new downstream repo /home/minipuft/Applications/codex-prompts, sibling to gemini-prompts
alternatives:
  chosen    : gemini-pattern port — proven twice, cheapest given contract near-identity
  rejected  : opencode-pattern TS rewrite (pure cost here); zero-adapter direct wiring to upstream scripts (loses tool-name/env normalization seam)
```

### Decisions

| Decision              | Chosen                                                                                                                                              | Rejected                                        | Why                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| Lib reuse             | npm dep + `hooks/lib` symlink                                                                                                                       | vendor copy; TS rewrite                         | SSOT; proven by gemini                                                |
| Adapter style         | thin per-event .py: normalize stdin → `os.environ.setdefault("MCP_WORKSPACE", plugin root)` → delegate → reshape; importlib shim where shapes match | direct hooks.json → upstream scripts            | keeps normalization seam without touching upstream                    |
| workspace.py          | add generic `PLUGIN_ROOT` branch after CLAUDE_PLUGIN_ROOT + adapter setdefault                                                                      | rely solely on Codex's CLAUDE_PLUGIN_ROOT alias | alias covers plugin runs; branch covers repo-level `.codex/` installs |
| cli_spawner           | `SpawnConfig.client: "claude"\|"codex"`; `_build_command` dispatches; `CodexModelStrategy` in existing registry                                     | keep hard-coded `"claude"`                      | codex hosts won't have claude installed; registry built for this      |
| Tool names            | adapter-level `CODEX_TOOL_NAMES` constant (from S2)                                                                                                 | editing upstream delegation-enforce             | same approach as gemini matcher remap                                 |
| subagent-gate-enforce | port + register ONLY after S1 confirms transcript shape                                                                                             | register blind                                  | format mismatch = silent no-op or crash                               |
| prompt-suggest budget | explicit `additionalContextLimit` from S3 measurement                                                                                               | accept 2500 default w/ spill                    | spill gives model only a preview — breaks directive pattern           |
| Marketplace           | S4 tests legacy path first; fall back to `.agents/plugins/marketplace.json`                                                                         | separate codex marketplace repo                 | one index for all clients if legacy works                             |
| Docs                  | extension-alignment.md Codex column + PreCompact fix in same PR                                                                                     | separate docs PR                                | docs/code lockstep                                                    |

### Interfaces

- `codex-prompts/.codex-plugin/plugin.json`: `{name:"codex-prompts", version, description, hooks:"./hooks/hooks.json", skills:"./skills/"}`
- `codex-prompts/hooks/hooks.json`: UserPromptSubmit, PreToolUse (`.*prompt_engine` | tool table), PostToolUse, Stop (timeout 120), SessionStart (`compact` + `startup|resume`), SubagentStop (post-S1) → `python3 ${CLAUDE_PLUGIN_ROOT}/hooks/<adapter>.py`; `additionalContextLimit` per S3
- Adapter contract: stdin JSON → setdefault `MCP_WORKSPACE` from `CLAUDE_PLUGIN_ROOT`/`PLUGIN_ROOT` → delegate → Codex-shaped stdout, exit 0/2
- `SpawnConfig(client: Literal["claude","codex"]="claude")`; `CodexModelStrategy.CAPABILITY_MAP` → codex model slugs
- Lock sync: `node scripts/synchronize-downstream-lock.js --workspace ../codex-prompts --package claude-prompts --version <published>`

### Read before implementing

- `hooks/lib/cli_spawner.py:204-260` — `_build_command` + spawn flow (hard-coded `"claude"` at 207)
- `hooks/lib/model_strategies.py:27-64` — Strategy base + registry registration
- `hooks/lib/workspace.py:14-38` — resolution chain insertion point (after line 38)
- `gemini-prompts/hooks/stop.py` + `before-agent.py` — shim + reimplementation templates
- `gemini-prompts/package.json` + `hooks/lib` symlink — scaffold to mirror
- `hooks/subagent-gate-enforce.py:42-147` + `hooks/tests/conftest.py:56-79` — transcript shape the parser expects (drives S1)
- `server/skills-sync.yaml` + `server/src/modules/skills-sync/service.ts:342-366` — registrations + CLIENT_REGISTRY (NOT `scripts/skills-sync.ts`, a 9-line wrapper)
- `.claude/rules/extension-alignment.md:25-40` — mapping table to extend

---

## Phase 2.5 — Verification (all paths probed 2026-08-03)

- 0 files with major drift. All cited lines confirmed: `cli_spawner.py:204/207`, `model_strategies.py:27-64`, `workspace.py:24-38`, `extension-alignment.md:30`, `subagent-gate-enforce.py:42/147`, `conftest.py:56-79`; gemini symlink target `../node_modules/claude-prompts/hooks/lib` confirmed via readlink.
- Shims detected: `server/scripts/skills-sync.ts` (9-line wrapper → `src/modules/skills-sync/service.ts`, 3433 LOC); `server/skills-sync.yaml` (config-only; clients hardcoded in CLIENT_REGISTRY).
- **Binding corrections applied to Phase 3**: (1) `CLIENT_REGISTRY.codex` already exists (service.ts:~355) — skills-sync step is yaml-config-only; (2) skills-sync edits target the yaml (+ service.ts:342-366 only if capabilities prove wrong empirically).
- Fields to add: `SpawnConfig.client`, `CodexModelStrategy`, `PLUGIN_ROOT` branch (workspace.py, after line 38), `registrations.codex` (skills-sync.yaml), Codex column (extension-alignment.md).
- Raw probe outputs: chain transcript, Phase 2.5 message (session 2026-08-03).

---

## Phase 3 — Implementation Plan

### Tier 0: Empirical spikes (one Codex session, scratch plugin; nothing committed)

| #   | File                                   | Change                                                                                                | ~Lines | Depends | Verify                                                                                 |
| --- | -------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------ | ------- | -------------------------------------------------------------------------------------- |
| 0.1 | scratch `.codex/hooks.json` + probe.py | S2: PreToolUse probe logging `tool_name`/`tool_input` for shell, patch, MCP, subagent spawns          | 25     | none    | log yields canonical names → fills `CODEX_TOOL_NAMES`                                  |
| 0.2 | same probe                             | S1: SubagentStop probe dumping `agent_transcript_path` + first 5 lines                                | 15     | 0.1     | lines parse as `{"type","content"}` JSONL (conftest.py:56-79) or divergence documented |
| 0.3 | scratchpad script                      | S3: measure prompt-suggest directive size over 10 representative `>>`commands                         | 20     | none    | max tokens known → `additionalContextLimit` chosen                                     |
| 0.4 | minipuft-plugins (no edit)             | S4: `codex plugin marketplace add` existing legacy `.claude-plugin/marketplace.json`; attempt install | 0      | none    | success → reuse index; failure → step 4.4                                              |

**Gate**: all four results recorded in this file under `## Spike Results` (section stub below).

### Tier 1: Upstream seams (claude-prompts-mcp; extensions only, zero new files)

| #   | File                                                       | Change                                                                                                      | ~Lines | Depends | Verify                                                           |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------ | ------- | ---------------------------------------------------------------- |
| 1.1 | `hooks/lib/workspace.py`                                   | generic `PLUGIN_ROOT` branch after line 38 + docstring                                                      | 8      | none    | hooks pytest + new PLUGIN_ROOT case                              |
| 1.2 | `hooks/lib/cli_spawner.py`                                 | `SpawnConfig.client` (line 34); `_build_command` (204) dispatches `codex exec`; error strings parameterized | 40     | none    | test_ralph_stop + new codex `_build_command` case                |
| 1.3 | `hooks/lib/model_strategies.py`                            | `CodexModelStrategy` + registry registration                                                                | 20     | none    | unit: capability hints resolve for client=codex                  |
| 1.4 | `server/skills-sync.yaml`                                  | `registrations.codex` block (registry already exists — service.ts:355)                                      | 6      | none    | `npm run skills:export` writes `~/.codex/skills/<name>/SKILL.md` |
| 1.5 | lock-sync call sites (package.json scripts / release docs) | wire `--workspace ../codex-prompts` invocation                                                              | 5      | none    | `--self-test`; dry run once repo exists                          |

**Gate**: `cd server && npm run typecheck && npm run lint:ratchet && npm test`; hooks pytest green.

### Tier 2: Scaffold codex-prompts repo (new repo; mirrors gemini-prompts)

| #   | File                        | Change                                                             | ~Lines | Depends                            | Verify                                |
| --- | --------------------------- | ------------------------------------------------------------------ | ------ | ---------------------------------- | ------------------------------------- |
| 2.1 | `package.json`              | name, `claude-prompts@^2` dep, scripts                             | 30     | 1.x published (or `file:` for dev) | `npm install`; symlink resolves       |
| 2.2 | `hooks/lib`                 | symlink → `../node_modules/claude-prompts/hooks/lib`               | 1      | 2.1                                | readlink matches gemini               |
| 2.3 | `.codex-plugin/plugin.json` | manifest w/ hooks + skills refs                                    | 25     | none                               | local `codex plugin install` succeeds |
| 2.4 | `hooks/hooks.json`          | 5-event wiring; Stop timeout 120; `additionalContextLimit` from S3 | 80     | 0.3                                | `/hooks` lists all entries            |
| 2.5 | `README.md` + config docs   | install, feature flag, trust flow, >=0.117 floor, no-Windows       | 80     | none                               | doc review                            |

**Gate**: local plugin install succeeds; `/hooks` shows entries pending trust.

### Tier 3: Port the 7 registered hooks (parallel after 2.x)

| #   | Adapter                    | Style                                          | ~Lines | Depends  | Verify                                                            |
| --- | -------------------------- | ---------------------------------------------- | ------ | -------- | ----------------------------------------------------------------- |
| 3.1 | `prompt-suggest.py`        | importlib shim                                 | 30     | 2.x      | `>>ping` injects directive in Codex                               |
| 3.2 | `gate-enforce.py`          | importlib shim                                 | 25     | 2.x      | FAIL verdict denies prompt_engine                                 |
| 3.3 | `delegation-enforce.py`    | `CODEX_TOOL_NAMES` remap + delegate            | 45     | 0.1, 2.x | pending delegation denies apply_patch/shell, allows subagent tool |
| 3.4 | `post-prompt-engine.py`    | importlib shim                                 | 25     | 2.x      | chain step persisted; CALL-TOOL directive injected                |
| 3.5 | `ralph-context-tracker.py` | tool-name remap + delegate                     | 35     | 0.1, 2.x | rows written during active Ralph session                          |
| 3.6 | `ralph-stop.py`            | importlib shim + `SpawnConfig(client="codex")` | 30     | 1.2, 2.x | unfinished chain blocks Stop with continue directive              |
| 3.7 | `compact-recovery.py`      | importlib shim; matcher `compact`              | 25     | 2.x      | post-compaction session shows recovered chain state               |
| 3.8 | `tests/`                   | pytest fixtures from recorded Codex stdin      | 200    | 3.1-3.7  | pytest green in repo CI                                           |

**Gate**: end-to-end Codex session demonstrates the Phase 2 success_signal.

### Tier 4: Spike-gated items

| #   | File                                                  | Change                                                                                         | ~Lines | Depends | Verify                                        |
| --- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------ | ------- | --------------------------------------------- |
| 4.1 | `subagent-gate-enforce.py` adapter + hooks.json entry | port IFF S1 confirms shape; else file upstream divergence issue                                | 35     | 0.2     | SubagentStop blocks on missing GATE_REVIEW    |
| 4.2 | `session-skills.py` adapter + entry                   | port; read `~/.codex/skills` (from 1.4 export)                                                 | 30     | 1.4     | SessionStart injects skills catalog           |
| 4.3 | hooks.json context-limit tuning                       | apply S3 value                                                                                 | 4      | 0.3     | large directive arrives un-spilled            |
| 4.4 | minipuft-plugins marketplace                          | IF S4 failed: add `.agents/plugins/marketplace.json`; fix 3.0.0→3.1.0 version drift either way | 20     | 0.4     | `codex plugin install codex-prompts@minipuft` |

**Gate**: full hook suite active in Codex; trust flow reproducible.

### Tier 5: Docs lockstep + capture

| #   | File                                         | Change                                                                    | Depends  | Verify                                                    |
| --- | -------------------------------------------- | ------------------------------------------------------------------------- | -------- | --------------------------------------------------------- |
| 5.1 | `.claude/rules/extension-alignment.md`       | Codex column; fix stale PreCompact row (line 30) to SessionStart(compact) | 3.x      | table matches shipped hooks.json across all three clients |
| 5.2 | `~/.claude/skills` new `codex-plugins` skill | author from validated findings via skill-builder                          | 3.x, 4.x | skill loads; matches shipped behavior                     |
| 5.3 | `CHANGELOG.md` `[Unreleased]`                | entry below                                                               | 1.x      | changelog lint                                            |

**new_file_justifications**: all new files live in the NEW codex-prompts repo (inherent) and mirror gemini-prompts 1:1. Upstream gains zero new files. Spike scratch files stay in the session scratchpad, uncommitted.

**changelog_entry**: Added — Codex CLI support seams: generic PLUGIN_ROOT workspace resolution, codex exec spawn strategy (`SpawnConfig.client` + `CodexModelStrategy`), and a codex skills-sync registration; consumed by the new codex-prompts downstream plugin.

---

## Phase 4-6 — Validation & Completion

### Testing strategy

| What to test                                           | Test type                                 | Location                                                               | Why this type                                                                     |
| ------------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `workspace.py` PLUGIN_ROOT branch                      | unit (pytest)                             | upstream `hooks/tests/`                                                | pure env-resolution function                                                      |
| `_build_command` codex dispatch + `CodexModelStrategy` | unit (pytest)                             | upstream `hooks/tests/`                                                | pure builders, table-driven                                                       |
| Each adapter vs recorded Codex stdin                   | integration (pytest fixtures)             | `codex-prompts/tests/`                                                 | validates the real I/O contract, not mocks — fixtures captured from spike session |
| subagent-gate-enforce transcript parse                 | integration w/ transcript_builder fixture | `codex-prompts/tests/` (reuse upstream conftest pattern)               | the S1-risk surface                                                               |
| Full hook suite behavior                               | manual E2E in live Codex session          | Tier 3/4 gates                                                         | hook trust + injection observable only in the real host                           |
| Upstream regression                                    | existing suites                           | `npm run typecheck && npm run lint:ratchet && npm test` + hooks pytest | seam edits must not disturb Claude/Gemini consumers                               |
| Lock sync                                              | `--self-test` + dry run                   | `server/scripts/`                                                      | already has self-test harness                                                     |

### Done criteria

| Criterion                               | Validation                                  | Pass Condition                                                      |
| --------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------- |
| All 5 success_signal behaviors in Codex | manual E2E (Tier 3 gate)                    | each observed in one session with hooks trusted                     |
| SubagentStop enforcement                | Tier 4.1 verify                             | blocks on missing GATE_REVIEW, or documented divergence issue filed |
| Upstream suites green                   | Tier 1 gate commands                        | zero new failures; ratchet not raised                               |
| Downstream CI green                     | codex-prompts pytest                        | all adapter fixture tests pass                                      |
| Install path reproducible               | fresh machine/profile walkthrough of README | plugin installs, hooks trusted, flag enabled, floor enforced        |
| Docs lockstep                           | Tier 5 diffs                                | extension-alignment.md + CHANGELOG updated in same PRs as code      |

### Documentation

| Doc                                    | Update Needed                                                 |
| -------------------------------------- | ------------------------------------------------------------- |
| `.claude/rules/extension-alignment.md` | Codex column; PreCompact row fix                              |
| `codex-prompts/README.md`              | full install/trust/flag/floor guide (new)                     |
| `CHANGELOG.md` (upstream)              | Added entry (5.3)                                             |
| `docs/guides/skills-sync.md`           | mention codex registration target if guide enumerates clients |
| `~/.claude/skills/codex-plugins`       | new skill, authored post-validation (5.2)                     |

### Risks

| Risk                                                               | Impact                                    | Mitigation                                                                                     | Rollback                                      |
| ------------------------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Codex hooks still experimental; contract shifts release-to-release | adapters break silently                   | pin floor >=0.117 in README + manifest; spike per new Codex minor before upgrading             | plugin uninstall; no upstream behavior change |
| S1: transcript format ≠ parser expectation                         | subagent-gate-enforce no-ops or crashes   | spike-gated registration (4.1); divergence path = upstream issue, hook stays unregistered      | omit hooks.json entry                         |
| S2: tool-name table wrong/incomplete                               | delegation enforcement misses tools       | probe hook logs real names before adapter written                                              | matcher narrows to known-good names           |
| additionalContextLimit spill truncates directives                  | chain automation degrades to preview text | S3 measures; explicit per-hook limit                                                           | raise limit or trim directive format          |
| Trust friction (hash re-review on every hook change)               | users silently run without hooks          | document `/hooks` flow prominently; stable hook files (logic lives in lib) minimize hash churn | n/a — platform behavior                       |
| npm dep lag (claude-prompts publish needed for CI)                 | downstream CI blocked                     | `file:` dep during dev; `synchronize-downstream-lock.js` on publish                            | pin previous version                          |
| Marketplace legacy path unsupported (S4 fails)                     | separate index needed                     | conditional 4.4 adds `.agents/plugins/marketplace.json`                                        | keep local-path install instructions          |

### Release

- commit_convention: `feat(hooks): <description>` upstream seams · `docs(docs):` alignment rule · downstream repo follows its own Conventional Commits from first commit
- scope: `hooks` (upstream seams), `docs` (rule), `scripts` (lock-sync wiring)

### Growth capture

- [ ] Pattern: "hook-porting adapter architecture" now validated 2+ times (gemini, opencode; codex pending) — promote to `extension-alignment.md` §Porting Pattern or small skill once codex port confirms
- [ ] Memory: add codex-prompts initiative to Active Initiatives on execution start
- [ ] Skill: author `codex-plugins` (5.2) from empirical findings; check `gemini-extensions`/`opencode-plugins` skills for shared structure to mirror

## Spike Results (2026-08-03, codex-cli 0.146.0, local)

- **S1 (SubagentStop transcript shape): ANSWERED 2026-08-03 (Tier 4 re-probe) — envelope compatible, content divergent.** In a session that waits for agent completion, `SubagentStop` DOES fire with the full Claude-compatible envelope (`agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`, `stop_hook_active`). The wait tool is `collaborationwait_agent`. But the transcript at `agent_transcript_path` is Codex's native rollout format (`session_meta`/`response_item`/`event_msg` wrappers; roles nested as `payload.role` = user/assistant), AND the delegated task prompt is unrecoverable: encrypted in spawn `tool_input.message`, empty in the transcript's inter-agent `NEW_TASK` payload block. Upstream's gate-criteria extraction (from the Task prompt) is unsatisfiable → 4.1 took the plan's divergence path. Note: `[features].collab` is deprecated in favor of `multi_agent`.
- **S2 (Codex tool names): ANSWERED — Codex uses Claude Code-compatible names.** Shell execution reports `tool_name: "Bash"` with `tool_input.command` (verbatim match to our hooks' expectations). File creation in the probe went through `Bash` (`printf > file`), not `apply_patch`; docs still list `apply_patch` as a canonical name. Subagent spawning is `collaborationspawn_agent`. → `CODEX_TOOL_NAMES` table: `Bash`→`Bash` (identity), delegation allow-list must add `collaborationspawn_agent` as the Task-equivalent, matcher should cover `Bash|apply_patch|collaborationspawn_agent`. Common stdin fields matched the docs exactly (`session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`, `permission_mode`, `turn_id`).
- **S3 (prompt-suggest directive size): ANSWERED — no override needed.** Max across 10 representative commands: ~98 tokens (395 chars, `>>implementation_plan` with args). The 2500-token default `additionalContextLimit` has ~25x headroom → step 4.3 is a no-op; keep defaults.
- **S4 (legacy marketplace path): ANSWERED — works.** `codex plugin marketplace add /home/minipuft/Applications/minipuft-plugins` accepted the repo via its `.claude-plugin/marketplace.json` (listed as marketplace `minipuft`). One index serves Claude Code and Codex → step 4.4 reduces to fixing the 3.0.0→3.1.0 version drift. The marketplace registration was left in place on this machine.
- **Operational notes for the codex-prompts repo**: `codex exec` blocks reading stdin when invoked with piped-but-unclosed stdin — spawn with stdin closed (`< /dev/null`) or deliver the prompt via stdin and close it (relevant to `_build_codex_command` call sites, which deliver the prompt via stdin — matches `codex exec -` semantics). Hooks fired with `--enable hooks --dangerously-bypass-hook-trust`; interactive sessions need the trust flow via `/hooks`.

## Execution status

- **Tier 0**: 0.1 ✓ · 0.2 ✓ (answered by Tier 4 re-probe — see updated S1 in §Spike Results) · 0.3 ✓ · 0.4 ✓
- **Tier 1**: 1.1 ✓ `workspace.py` PLUGIN_ROOT branch · 1.2 ✓ `SpawnConfig.client` + `_build_claude_command`/`_build_codex_command` split + per-client not-found errors + `json_config` client propagation · 1.3 ✓ `CodexModelStrategy` (verified slug `gpt-5.6-sol`; standard tier returns None → client default) · 1.4 ✓ `registrations.codex` in skills-sync.yaml (export verified writing `~/.codex/skills/dev_workflow/`) · 1.5 ✓ npm-publish.yml downstream comment + lock-refresh invocation documented
- **Tier 1 gate**: PASSED — hooks pytest 192/192 (14 new in `hooks/tests/test_codex_client_seams.py`), `validate:python` (ruff check + format + pyrefly baseline) clean, server `typecheck` clean, `lint:ratchet` no regressions, full Jest suite exit 0.
- **Tier 2** (2026-08-03): 2.1 ✓ package.json (dev dep = `file:vendor/claude-prompts-3.1.0.tgz`, gitignored; swap to `^3.1.0` on publish) · 2.2 ✓ `hooks/lib` symlink (resolves; Tier 1 seams confirmed importable through it) · 2.3 ✓ `.codex-plugin/plugin.json` · 2.4 ✓ `hooks/hooks.json` (5 events, 7 entries; delegation matcher uses S2 names `Bash|apply_patch|collaborationspawn_agent`; default context limits per S3) · 2.5 ✓ README (install, trust flow, flag, floors, stdin gotcha, dev wiring)
- **Tier 2 gate**: PASSED — plugin installed + enabled at v0.1.0 via a local dev marketplace (codex-cli 0.146 has no `codex plugin install <path>`; installs are marketplace-mediated: `codex plugin add codex-prompts@codex-prompts-dev`). Trust behavior verified non-interactively: hooks silently skipped without trust, discovered + executed with `--dangerously-bypass-hook-trust`. No upstream files changed this tier (suite unchanged from Tier 1 green).
- **Tier 2 findings binding on Tier 3**: (a) the plugin cache copy (`~/.codex/plugins/cache/...`) preserves `node_modules/` but **drops the `hooks/lib` symlink** — adapters must resolve lib as `Path(__file__).parent/"lib"` with fallback to `parents[1]/"node_modules/claude-prompts/hooks/lib"`; (b) a missing/broken adapter exits 2 which Codex treats as a BLOCK on the event — do not grant hook trust before Tier 3 adapters land; (c) plugin needs a bundled `.mcp.json` for the MCP server itself (plan omission) — add in Tier 3 after verifying Codex's `.mcp.json` env interpolation.
- **Tier 3** (2026-08-03): 3.1-3.7 ✓ — `hooks/_codex_bootstrap.py` (shared lib resolution w/ cache fallback, MCP_WORKSPACE pinning, RALPH_SPAWN_CLIENT=codex, CODEX_TOOL_NAMES remap) + 7 thin adapters (all importlib shims; delegation-enforce and ralph-context-tracker remap tool names) · 3.8 ✓ `tests/test_adapters.py` 14 tests incl. live-recorded Codex payload shapes, deny paths, spawn-remap-to-Task, and a cache-layout (no symlink) regression · plus `.mcp.json` + manifest `mcpServers` ref (Tier 2 finding c) · plus upstream `SpawnConfig.client` env default (`RALPH_SPAWN_CLIENT`) so ralph-stop spawns codex without modification
- **Tier 3 gate**: PASSED — live Codex session (codex-cli 0.146, gpt-5.6-sol): `>>dev_workflow` directive injected → model called `prompt_engine` → chain ran → PostToolUse tracked → **structured FAIL gate_verdict DENIED live** ("Tool call blocked by PreToolUse hook: Gate FAIL: ...") → Stop hook completed. Delegation deny + compact recovery verified via fixture tests (deny/remap/allow paths). Suites: adapter pytest 14/14, upstream pytest 197/197, ruff+pyrefly clean.
- **Tier 3 findings**: (a) **upstream bug found+fixed** — `gate-enforce.py` crashed (TypeError) on the structured `{overall,rationale,per_gate[]}` gate_verdict shape the schema PREFERS; hook failures are fail-open, so object verdicts were never enforced on ANY client until now. Fixed with isinstance branch + 4 regression tests (`hooks/tests/test_gate_enforce_verdict.py`); (b) npm keeps same-version `file:` tarballs stale (cache by version) — refreshing dev deps requires `rm -rf node_modules package-lock.json`; real releases avoid this via version bumps + `synchronize-downstream-lock.js`; (c) plugin `.mcp.json` IS registered by codex but the E2E was served by the machine's pre-existing global `[mcp_servers.claude_prompts_mcp]` entry — interpolation-at-spawn verification and global-vs-plugin server dedup became Tier 4 work (resolved there).
- **Tier 4** (2026-08-03): 4.1 ✓ divergence path (S1 re-probe: SubagentStop envelope compatible but delegated prompt encrypted/absent → hook NOT registered; divergence documented in codex-prompts README §Known divergences; session-state redesign logged as future option) · 4.2 ✓ `session-skills.py` adapter + `startup|resume` hooks.json entry + 3 tests — catalog-free deviation: Codex natively enumerates `~/.codex/skills` (16.4KB `<skills_instructions>` measured), so the adapter injects only the protocol framing via upstream `scan_skills()` as existence gate; **verified live** (exact framing echoed back by the model, 107 skills counted) · 4.3 ✓ no-op confirmed (S3: ~98 tokens vs 2500 default) · 4.4 ✓ marketplace 3.0.0→3.1.0 drift fixed + codex-prompts entry added; `codex plugin list` parses both entries (install completes after GitHub push)
- **Tier 5** (2026-08-03): 5.1 ✓ `extension-alignment.md` rewritten to current state — the old table described the retired in-repo `.gemini/` layout; now: 5-channel distribution table (incl. codex-prompts + opencode-prompts), behavior-keyed event mapping measured against all three shipped hooks configs, Codex divergences, host-seam inventory, stale globs dropped from frontmatter · 5.2 ✓ `~/.claude/skills/codex-plugins` authored via skill-builder (411-line SKILL.md + 3 references + 2 executable check scripts; skill-authoring gates passed; loads in-session) · 5.3 ✓ `CHANGELOG.md` `[Unreleased]` Added (codex seams) + Fixed (structured gate_verdict enforcement) · skills-sync guide re-measured: already enumerates codex — no edit needed
- **Tier 5 gate**: PASSED — typecheck clean, lint:ratchet + typecheck:tests:ratchet no regressions, Jest 1901/1901, prettier clean on changed files; the two `validate:all` failures remain the pre-existing committed items surfaced in Tier 4 (hit counts unchanged at 2+2 — not introduced by any port tier).
- **Tier 4 findings**: (a) **plugin `.mcp.json` interpolation DOES NOT exist on codex-cli 0.146** — argv-shim probe shows literal `${CLAUDE_PLUGIN_ROOT}` in argv+env, empty `CLAUDE_PLUGIN_ROOT` env, spawn cwd = session dir (not plugin root). The bundled server can never start from plugin config on 0.146; global `codex mcp add` with absolute paths is the only working registration → dedup resolved (global is authoritative; `.mcp.json` kept as forward contract; README documents the workaround); (b) the manually-spawned cached server (interpolated paths, cache layout) boots cleanly — the failure is purely host-side; (c) dev marketplace relocated from session scratchpad to `~/.codex/dev-marketplace` (scratchpad deletion had broken `codex plugin list` entirely); probe-hooks scratch plugin removed.

## Deviations

_(log in companion implementation-notes file during execution)_

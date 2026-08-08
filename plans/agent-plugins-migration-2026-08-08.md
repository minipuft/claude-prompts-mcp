---
title: "Agent Plugins Migration — Single Source Tree, Rendered Distributions"
date: 2026-08-08
status: backlog
tags: []
---

# Agent Plugins Migration — Single Source Tree, Rendered Distributions

**Status**: READY — full implementation plan produced via >>implementation_plan chain 2026-08-08 (discovery → pre-flight → path verification → tier table). Activates after acquisition-recovery Tier 2b closes; owner validates each client manually.
**Owner**: minipuft (manual client checks per phase are an explicit gate, not a courtesy)
**Parent**: `plans/acquisition-recovery.md` Tier 6 (pointer); subsumes Tier 5's marketplace research
**Standard**: [Agent Plugins 1.0.0](https://agent-plugins.org/) — announced 2026-08-06 by OpenAI
with AWS, Cursor, GitHub, Microsoft, Vercel. **Days old — pin, don't chase.**

## Why

Four per-client repos exist because storefronts bind to repo shape at install time. The cost is
drift, not effort — evidenced 2026-08-06 (marketplace served 3.1.1 against the 3.2.1 release
until sync merged; codex-prompts has no self-heal at all). Agent Plugins 1.0 provides the
canonical source _shape_, and its launch clients (Codex, ChatGPT, Cursor, GitHub Copilot, Kiro,
VS Code) are net-new acquisition surfaces.

## What the standard specifies (verified against spec 2026-08-08)

- `plugin.json` manifest — only permitted top-level fields: `$schema`, `name`, `version`,
  `description`, `author`, `homepage`, `repository`, `license`, `keywords`, `extensions`.
- `skills/<name>/SKILL.md` — fixed path, conforms to agentskills.io.
- `mcp.json` — fixed file, `mcpServers` map; stdio/streamable-http; MUST NOT be inline in
  `plugin.json`. Placeholders `${PLUGIN_ROOT}` / `${PLUGIN_DATA}` expand in `args`/`env`
  values/`cwd` only — NOT in `command`.
- **Client extensions**: reverse-domain namespace dirs (`com.example.client/`) and/or
  `extensions` manifest field — this is where hooks live; v1 defines NO core hooks/commands/
  agents/rules.
- Containment: reads/executes resolve inside plugin root; persistent data → client-provided
  `PLUGIN_DATA`.
- **Anthropic is absent** — Claude Code marketplace format remains a permanent legacy render.

## Discovery findings (probed 2026-08-08 — these reshaped the original P0–P6 draft)

1. **The render pattern already exists.** `extension-publish.yml:477` (claude-code-plugin job)
   stages root `.claude-plugin/`, `.mcp.json`, `hooks/`, `agents/`, `server/dist` and pushes the
   `dist` branch; marketplace.json sources `claude-prompts-mcp.git` ref `dist`. The migration
   generalizes this, it does not invent it.
2. **`.claude-plugin/plugin.json` already conforms** to the spec's permitted-field list — only
   `$schema` is missing. Root `.mcp.json` maps 1:1 modulo `${CLAUDE_PLUGIN_ROOT}` →
   `${PLUGIN_ROOT}`. The standard visibly descends from Claude Code's format.
3. **minipuft-plugins is a 2-file index** (marketplace.json + contract), not a content repo. The
   original "migrate it last, highest blast radius" ordering was wrong — its only blast radius is
   the installed marketplace URL.
4. **Verification corrections** (Phase 2.5, literal probes):
   - `server/scripts/skills-sync.ts` is an 8-line shim; the real export service is
     `server/src/modules/skills-sync/service.ts` (3,433 lines) — integrate there.
   - `paths.ts:113-116` ALREADY honors `MCP_WORKSPACE` (priority: `--workspace` flag → env var →
     package root). The packaged-server defect is real but lives in **writers that bypass
     `PathResolver.getWorkspace()`** — Tier 0 diagnoses those, not the resolver.
   - `resolvePackageRoot` = `server/src/runtime/startup.ts:32`. opencode build step confirmed
     (`tsc -p tsconfig.build.json`, package.json:24).
5. **Stale URLs**: plugin.json homepage/repository still point at pre-rename
   `github.com/minipuft/claude-prompts`.

## Retirement matrix (RESOLVED — was the plan's core open question)

| Repo             | Evidence                                                          | Decision                                                                |
| ---------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| codex-prompts    | Its client (Codex) is a launch consumer of the standard           | **RETIRE** — archive after native-package pilot passes owner validation |
| gemini-prompts   | Gemini CLI not on the standard; Tier 2b listing URLs pin the repo | **DEMOTE** to rendered artifact (GENERATED banner + hand-edit CI check) |
| opencode-prompts | Same, plus a real `tsc` build the renderer must run               | **DEMOTE** to rendered artifact                                         |
| minipuft-plugins | 2-file marketplace index; installed URL has no redirect mechanism | **FREEZE** as index — version bumps arrive only via render              |

## Alignment matrix (the four surfaces the owner named)

| Surface                            | Today                                                | During migration                                                         | End state                                                         |
| ---------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| **npm package** (`claude-prompts`) | The engine                                           | UNCHANGED — public API out of scope                                      | `mcp.json` declares it; still the single engine                   |
| **Hooks**                          | Root `hooks/` (Claude Code) + hand copies in 3 repos | Root `hooks/` stays (live CI surface); renderer MAPS into namespace dirs | One source per client namespace, rendered to native locations     |
| **Marketplaces**                   | Listings pin downstream repo URLs                    | URLs never change                                                        | Rendered repos keep URLs; standard clients get the native package |
| **GitHub workflows**               | Release train ends at version-sync PRs               | Render jobs replace sync (same-PR retirement)                            | npm → extensions → dist → render all → drift check                |

## Implementation tiers (chain Phase 3 output — supersedes the original P0–P6)

### Tier 0 — Prerequisites (no distribution change)

| #   | File                                                                  | Change                                                                                                                               | ~Lines | Depends | Verify                                                                                      |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------- | ------------------------------------------------------------------------------------------- |
| 0.1 | server/src (diagnosis)                                                | rg for `import.meta.url`/`__dirname`-relative state+log writers bypassing `PathResolver.getWorkspace()`; route each through paths.ts | ~30    | —       | packaged build honors MCP_WORKSPACE for state.db + logs (repro from packaged-defect memory) |
| 0.2 | .claude-plugin/plugin.json                                            | homepage/repository → `claude-prompts-mcp` URL                                                                                       | 2      | —       | git diff                                                                                    |
| 0.3 | tooling/contracts/vendor/agent-plugins/1.0.0/{plugin,mcp}.schema.json | vendor both spec schemas (NEW — pins; CI never fetches live)                                                                         | ~200   | —       | sha256 in commit msg                                                                        |
| 0.4 | server/package.json                                                   | `validate:agent-plugins` (ajv vs vendored schemas) wired into validate:all                                                           | ~10    | 0.3     | script passes                                                                               |

**Gate**: `npm run validate:all` + packaged-build repro of 0.1.

### Tier 1 — Canonical tree promotion (main repo only)

| #   | File                                              | Change                                                                                                     | ~Lines | Depends  | Verify                                         |
| --- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------ | -------- | ---------------------------------------------- |
| 1.1 | plugin.json (root, NEW — spec-mandated location)  | promote from .claude-plugin/, add `$schema`                                                                | ~22    | 0.3      | validate:agent-plugins                         |
| 1.2 | mcp.json (root, NEW — spec-mandated)              | canonical .mcp.json: `${PLUGIN_ROOT}` paths, state → `${PLUGIN_DATA}`                                      | ~18    | 0.1, 1.1 | schema-valid; server boots with expanded paths |
| 1.3 | scripts/render-targets.json (NEW — renderer SSOT) | target matrix: {client, namespace, consumes, output{repo,branch}, placeholderMap, hookMapping, buildStep?} | ~60    | —        | renderer self-check                            |
| 1.4 | server/src/modules/skills-sync/service.ts         | skills/ export profile (SKILL.md per skill) — the REAL service, not the 8-line shim                        | ~40    | —        | skills:export emits skills/<name>/SKILL.md     |

**Gate**: validate:all; `.claude-plugin/` + `.mcp.json` UNCHANGED (Claude Code installs unaffected).

### Tier 2 — Renderer + drift check

| #   | File                                   | Change                                                                                                                                                      | ~Lines | Depends | Verify                                                                                                     |
| --- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- | ---------------------------------------------------------------------------------------------------------- |
| 2.1 | scripts/render-distributions.mjs (NEW) | reads targets; emits native package + per-client renders (manifest transform, `${PLUGIN_ROOT}`↔`${CLAUDE_PLUGIN_ROOT}` rewrite, hook mapping, opencode tsc) | ~250   | 1.1–1.4 | **zero-diff render** vs current .claude-plugin/, .mcp.json, gemini-prompts, opencode-prompts working trees |
| 2.2 | same file, `--check` mode              | render to temp, byte-compare vs published target                                                                                                            | ~40    | 2.1     | seeded mutation → check fails                                                                              |
| 2.3 | validate-versions (owning script)      | `--distribution` grows root plugin.json + every rendered manifest                                                                                           | ~20    | 2.1     | gate green                                                                                                 |

**Gate**: zero-diff render proves renders reproduce today's hand state before automation may overwrite anything.

### Tier 3 — Workflow integration (hand paths retired same-PR)

| #   | File                                          | Change                                                                                              | ~Lines | Depends | Verify                         |
| --- | --------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------ | ------- | ------------------------------ |
| 3.1 | .github/workflows/extension-publish.yml       | render-distributions job: all targets, push with `--auto` + state==MERGED verify + BEHIND self-heal | ~80    | 2.1     | workflow_dispatch dry-run flag |
| 3.2 | .github/workflows/downstream-sync.yml         | DELETE — renders supersede                                                                          | −59    | 3.1     | no sync PRs; render job green  |
| 3.3 | server/scripts/synchronize-downstream-lock.js | retire absorbed targets; delete if empty                                                            | −100   | 3.1     | rg in workflows = 0            |
| 3.4 | validate-renovate-extraction.js               | workflow inventory reflects delete+add                                                              | ~6     | 3.1–3.2 | gate green                     |

**Gate**: test-tag release dry-run; OWNER installs Claude Code plugin from dist branch.

### Tier 4 — Codex native pilot + retirement (OWNER gate)

| #   | Change                                                             | Depends        | Verify                                                                  |
| --- | ------------------------------------------------------------------ | -------------- | ----------------------------------------------------------------------- |
| 4.1 | native target → release asset + Codex install path (P0-researched) | 3.1            | OWNER installs in Codex: hooks fire, server boots, state in PLUGIN_DATA |
| 4.2 | archive codex-prompts; README pointer to native package            | 4.1 OWNER PASS | archived; instructions verified                                         |
| 4.3 | marketplace.json codex entry → native package or removed           | 4.2            | rendered index valid                                                    |

### Tier 5 — Demote gemini-prompts, then opencode-prompts (one per PR, OWNER gate each)

| #   | Change                                                                                       | Verify                                                |
| --- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 5.1 | gemini-prompts: GENERATED banner + hand-edit CI check; local release-please/renovate retired | render --check green; OWNER installs Gemini extension |
| 5.2 | opencode-prompts: same + tsc buildStep; dist/ committed by render only                       | render --check green; OWNER installs opencode plugin  |

### Tier 6 — Freeze index + docs

| #   | Change                                                                     | Verify                              |
| --- | -------------------------------------------------------------------------- | ----------------------------------- |
| 6.1 | minipuft-plugins frozen as 2-file index                                    | marketplace URL still resolves      |
| 6.2 | docs/ + CLAUDE.md + downstream READMEs: rendered model, current state only | rg stale hand-edit instructions = 0 |
| 6.3 | this plan: date each landed tier                                           | plan reflects reality               |

## Testing strategy

| What to test                  | Test type                       | Location                                | Why this type                                                                                 |
| ----------------------------- | ------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| Writer-bypass fix (0.1)       | integration                     | server/tests/integration                | must prove packaged build writes to MCP_WORKSPACE — unit can't see path resolution end-to-end |
| Schema validation (0.4)       | unit                            | server/tests                            | ajv against vendored pins; fast, deterministic                                                |
| Renderer transforms (2.1)     | unit + golden                   | scripts (new test file beside renderer) | placeholder rewrite + manifest transform are pure functions; golden dirs catch shape drift    |
| Zero-diff property (2.1 gate) | one-shot manual + CI drift mode | render --check                          | the tripwire that catches hand-state discovery missed                                         |
| Release train (3.1)           | dry-run dispatch                | GitHub Actions                          | only the real runner proves push/auto-merge behavior                                          |
| Per-client installs (T4–T6)   | OWNER manual                    | each client                             | install-time behavior is not automatable from this repo                                       |

## Done criteria

| Criterion                    | Validation               | Pass condition                                         |
| ---------------------------- | ------------------------ | ------------------------------------------------------ |
| Canonical tree schema-valid  | validate:agent-plugins   | green vs pinned 1.0.0                                  |
| Renders reproduce hand state | zero-diff render         | 0 bytes differ at adoption moment                      |
| Release train end-to-end     | 3.3.x release            | native + 3 renders published, versions aligned         |
| No hand-maintenance remains  | rg + CI hand-edit checks | 0 hand paths; sync workflows deleted                   |
| Every client installs        | OWNER checks             | Codex (native), Claude Code, Gemini, opencode all pass |
| codex-prompts retired        | repo archived            | after OWNER Codex pass only                            |

## Risks

| Risk                           | Impact                              | Mitigation                                               | Rollback                                          |
| ------------------------------ | ----------------------------------- | -------------------------------------------------------- | ------------------------------------------------- |
| Spec point-release churn       | renders invalid vs live clients     | vendored pins; deliberate re-pin only                    | pins make no-op                                   |
| Render bug ships broken plugin | every client install breaks at once | zero-diff gate + dry-run + drift check                   | dist branch/repos are git — revert render commit  |
| Auto-push to wrong repo state  | downstream clobber                  | state==MERGED verify + BEHIND self-heal (proven pattern) | git revert on target                              |
| Codex namespace unknown        | native hooks don't fire             | P0 research before Tier 4; pilot gated on owner install  | codex-prompts un-archived (archive is reversible) |
| opencode tsc inside our CI     | render job fails                    | buildStep isolated per target; probe in Tier 2           | keep opencode hand-maintained until solved        |

## Documentation

| Doc                           | Update needed                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------ |
| CLAUDE.md (this repo)         | Environment/constraints rows if PLUGIN_DATA changes state paths; workflow list |
| docs/architecture/overview.md | distribution/render pipeline section                                           |
| downstream READMEs ×3         | GENERATED model, install unchanged                                             |
| docs/guides/identity-scope.md | if 0.1 changes workspace derivation                                            |

## Release

commit_convention: feat/fix/chore(scope) per repo convention; renderer lands as `feat(scripts)`,
workflow changes `chore(ci)`, defect fix `fix(runtime)`. Retirements are `chore` with same-PR
cleanup. Major version NOT required: MCP tool surface, CLI, resource formats, hook module API all
unchanged (public-contract table, CLAUDE.md).

## Growth capture (chain Phase 4c)

- Pattern sighting: "verify the defect SITE, not just the defect" — paths.ts honored
  MCP_WORKSPACE all along; the bug is in bypassing writers (2nd sighting of
  claim-vs-probe drift this initiative; log to observations ledger when it lands a 3rd).
- Memory update queued: packaged-defect memory should note the corrected diagnosis site.

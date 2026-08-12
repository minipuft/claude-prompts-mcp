---
title: "Agent Plugins Migration — Single Source Tree, Rendered Distributions"
date: 2026-08-08
status: active
tags: []
---

# Agent Plugins Migration — Single Source Tree, Rendered Distributions

**Status**: TIER 0, TIER 1 and **TIER 0.5 CLOSED** — every 0.5 row resolved 2026-08-11. Claims
corpus at **77 scenarios** (3 self-retiring `known_divergence` rows), `test:e2e` 123 passed/2
skipped, `test:ci` 2123/2123, `validate:all` 33/34. The one red step is `plans:retire:check`,
which fails on another workstream's plan and is not this plan's to fix.

**Tier 0.5b reconciled and then CLOSED for Workstreams A/B/C, 2026-08-11**: 28 of 33 rows resolved. Workstream D (4 rows) and E6 remain, and **none gates the
release**. The Done-criteria table names the canonical tree, zero-diff renders, the release train,
hand-maintenance removal, client installs and codex-prompts retirement; the conformance suite
appears in none of them. Open: A2, A5 (coverage), B2 (unblocked, ready), C6, D2/D4/D7/D9, E6.

**Still open elsewhere**: rows 1.6–1.9, findings 0.5.23–0.5.25 (carried forward, not blockers),
and tiers 2–6 — which ARE the release. This plan stays `status: active`.

**NEXT ACTIONS, in the owner's stated order** (A1 unblocked all three):

1. **B4** — driver needs `text_contains`; B2 and every C row need it to express a round-trip
2. **B2** — framework switch round-trip (now SAFE: A1 isolates the write)
3. **C1–C6** — chain run → `force_restart` → `gate_verdict` both shapes → `gate_action`.
   **C0 + C1 ✓ 2026-08-09** (`capture:`/`${...}` round-trip primitive + chain resume, corpus 52,
   3-mutation falsification incl. one product-side). C2–C6 open; C3 is next and retires C1's
   `%clean` crutch. New findings from the pass: **C8** (gated resume no-ops with `ok`), **E3**
   (93 of 119 local prompts are gitignored — CI fixture trap), **E4** (a vocab gate scans them)
4. **A2 → A3 (owner walkthrough) → A4/A5** — `resource_manager`; mutating rows LAST

**0.5.6, 0.5.7, 0.5.9, 0.5.11, 0.5.12 LANDED + 0.5.13 PARTIAL 2026-08-11. 0.5.14 was already covered — all 8 declared frameworks have scenarios; the row is stale, not open.** Corpus at **55 scenarios**, `validate:all` 32/32,
`test:ci` 2048/2048, `test:e2e` 100 passed / 2 skipped. 0.5.6 was the only confirmed product
defect and it was **larger than recorded** — NEITHER reserved operator was enforced; `+` merely
appeared to be, because its scenario failed on an unrelated missing argument. Reserved-operator
enforcement is now driven by the registry `status` field.

Open rows: **0.5.23–0.5.25** (new, found by the isolated-workspace batch), 1.6–1.9. **Tier 0.5 is CLOSED** — every row resolved 2026-08-11 (0.5.8, 0.5.10, 0.5.15, 0.5.16, 0.5.17, 0.5.18, 0.5.22). 0.5.23–0.5.25 are new findings carried forward, not blockers: two are self-retiring `known_divergence` rows and one is a documentation note.

**Activation-gate conflict, recorded rather than resolved**: this plan says it "activates after
acquisition-recovery Tier 2b closes". Measured 2026-08-09 — `plans/acquisition-recovery.md:167`
still reads `2b PREPARED, fires at ship`. Tier 0 + Tier 1 were executed anyway on explicit owner
instruction. Neither tier touches a listing URL or a published artifact, so nothing they changed
can race 2b; **Tier 3 onward can**, and the gate should be honored there.

**Owner**: minipuft — validates each client manually; the per-phase client checks are an explicit gate, not a courtesy
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

### Re-measured 2026-08-09 at execution (authored → measured)

Every count above was re-probed before executing. **Held**: `extension-publish.yml:477`
claude-code-plugin job · `downstream-sync.yml` = 59 lines · `service.ts` = 3,433 lines ·
`.claude-plugin/plugin.json` conforms to the permitted-field list modulo `$schema` · stale URLs ·
opencode `tsc -p tsconfig.build.json` at package.json:24 · `paths.ts` honors `MCP_WORKSPACE`.

**Falsified — finding 4, second bullet.** SUPERSEDED by the execution record at the end of this
document. The bullet's first half is right and its conclusion is wrong: the resolver was never
the problem, but neither were "writers that bypass `PathResolver.getWorkspace()`". A packaged
build with `MCP_WORKSPACE` set already wrote `state.db` and `logs/` into the workspace before any
Tier 0 change (repro 2026-08-09). The real defect is one level down and has a different shape —
`SqliteEngine.getInstance` is a singleton that keeps the FIRST caller's config, and five of its
six call sites pass no `dbPath` at all, falling back to `join(serverRoot, …)` = the package
directory. The observable behavior was correct only because `ResourceChangeTracker` — the single
site that passes the PathResolver-derived path — happens to initialize first.

**Pattern (3rd sighting → log it):** "verify the defect SITE, not just the defect" has now
produced a wrong site twice on this initiative and a wrong premise once on 1.4. A grep for
call sites answered _who could bypass the resolver_; only running the binary answered _whether
anything did_. See Growth capture.

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

### Tier 0 — Prerequisites (no distribution change) — ✓ LANDED 2026-08-09

| #   | Status | File                                                                                                   | Change                                                                                                                                                                                                                                                                                                                               | ~Lines authored → measured | Depends | Verify                                                                                      |
| --- | ------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| 0.1 | ✓      | server/src/infra/database/sqlite-engine.ts · server/src/runtime/module-initializer.ts                  | **Step rewritten — original premise falsified.** Not "route bypassing writers through paths.ts": the composition root claims the `SqliteEngine` singleton with the PathResolver-derived `dbPath` (`claimStateDatabase`), and `getInstance` now THROWS when a later caller requests a different path instead of silently ignoring it. | ~30 → ~45 (2 files)        | —       | packaged build honors MCP_WORKSPACE for state.db + logs (repro from packaged-defect memory) |
| 0.2 | ✓      | .claude-plugin/plugin.json                                                                             | homepage/repository → `claude-prompts-mcp` URL                                                                                                                                                                                                                                                                                       | 2 → 2                      | —       | git diff                                                                                    |
| 0.3 | ✓      | server/tooling/contracts/vendor/agent-plugins/1.0.0/{plugin,mcp}.schema.json                           | vendor both spec schemas (NEW — pins; CI never fetches live). Fetched from `https://agent-plugins.org/schemas/1.0.0/…`                                                                                                                                                                                                               | ~200 → 122 (both files)    | —       | sha256 in commit msg                                                                        |
| 0.4 | ✓      | server/scripts/validate-agent-plugins.js (NEW) · server/package.json · scripts/run-validation-suite.js | `validate:agent-plugins` (ajv vs vendored schemas) wired into validate:all, with `--self-test` proving 5 rejection rules + 1 acceptance                                                                                                                                                                                              | ~10 → ~230 (validator NEW) | 0.3     | script passes                                                                               |

**Gate**: ✓ PASSED 2026-08-09 — `npm run validate:all` 31/31, packaged-build repro wrote
`$MCP_WORKSPACE/runtime-state/state.db` + `$MCP_WORKSPACE/logs/mcp-server.log`, unit 2008/2008,
integration 489/489.

**0.4 was a vacuous gate at Tier 0 and is recorded as such.** With no root manifests yet it
printed "nothing to validate" and exited 0 — evidence about nothing. It became live at 1.1/1.2
(2/2 manifests schema-valid). The `--self-test` is what carried it in the meantime.

### Tier 1 — Canonical tree promotion (main repo only) — ✓ LANDED 2026-08-09

| #   | Status | File                                                                | Change                                                                                                                                                                                                                                                                                                 | ~Lines authored → measured | Depends  | Verify                                           |
| --- | ------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | -------- | ------------------------------------------------ |
| 1.1 | ✓      | plugin.json (root, NEW — spec-mandated location)                    | promote from .claude-plugin/, add `$schema`. Also registered in `validate-versions.js` — see row 1.5                                                                                                                                                                                                   | ~22 → 13                   | 0.3      | validate:agent-plugins                           |
| 1.2 | ✓      | mcp.json (root, NEW — spec-mandated)                                | canonical .mcp.json: `${PLUGIN_ROOT}` paths, state → `${PLUGIN_DATA}` via `MCP_RUNTIME_ROOT`. Added `"type": "stdio"`, which the vendored schema requires and `.mcp.json` does not carry                                                                                                               | ~18 → 16                   | 0.1, 1.1 | schema-valid; server boots with expanded paths   |
| 1.3 | ✓      | scripts/render-targets.json (NEW — renderer SSOT)                   | target matrix, 4 targets. Client namespaces left **null with an explicit `unresolved` block** rather than guessed — see row 1.6                                                                                                                                                                        | ~60 → 62                   | —        | renderer self-check → **SUBSTITUTED**, see below |
| 1.4 | ✓      | server/src/modules/skills-sync/service.ts · server/skills-sync.yaml | **Step rewritten — original premise falsified.** No export profile was needed: the service ALREADY emits `<name>/SKILL.md` (service.ts:1786, 1941 via `outputSubDir`). The actual change is a `CLIENT_REGISTRY` entry whose `outputDir.project` is a bare `skills` + a `skills-sync.yaml` registration | ~40 → ~19 (2 files)        | —        | skills:export emits skills/<name>/SKILL.md       |

**Gate**: ✓ PASSED 2026-08-09 — `validate:all` 31/31; unit 2008/2008, integration 489/489,
e2e 44/46 (2 pre-existing skips). `.mcp.json` byte-identical (no diff). `.claude-plugin/` carries
**only** the 2-line Tier 0.2 URL change — stated precisely rather than as "unchanged", because it
is not unchanged, it is unchanged _by Tier 1_.

**1.3's Verify was vacuous and was substituted.** "renderer self-check" names a renderer that
Tier 2.1 builds, so at Tier 1 nothing could observe the file. Substituted with a real check that
runs now: `validate:agent-plugins` resolves every `consumes` path in `render-targets.json` against
the filesystem and requires `client` + `output.repo` on each target (4 targets, all resolve). This
catches the most likely defect — a wrong path — at authoring time instead of at render time.

#### Rows added during Tier 1 execution

| #   | Status | Change                                                                                                                                                                                                                                                                                                                 | Depends | Verify                                                                                 |
| --- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------- |
| 1.5 | ✓      | **Landed early, belongs to 2.3.** Root `plugin.json` registered in `validate-versions.js`. Not deferred: a versioned manifest that no gate reads can drift from the moment it exists, and 2.3 is two tiers away. 2.3 now covers only the RENDERED manifests                                                            | 1.1     | `validate:versions` green with the new entry                                           |
| 1.6 | ☐      | **Client namespace strings are unresolved and are not guessed.** The spec puts hooks in reverse-domain dirs (`com.example.client/`) but v1 defines no core hooks, and the concrete string per launch client is not in the spec text. `render-targets.json` records this in an `unresolved` block                       | —       | each target's `namespace` is non-null, sourced from a client's own docs                |
| 1.7 | ☐      | **`skills/` generated output is committed and not gitignored.** Consistent with the repo's render model (`.claude-plugin/`, `dist` branch), but nothing yet regenerates or drift-checks it, so a hand edit would survive silently. Tier 2.1 must own it or it must be ignored                                          | 2.1     | `render --check` covers `skills/`, or `.gitignore` excludes it with a reason           |
| 1.8 | ☐      | **`skills-sync.yaml` `agent-plugins` registration exports only `reference_demo`.** Copied from the `codex` project scope as a working default; which resources the native package should actually ship is an owner decision, not a technical one                                                                       | —       | owner names the resource set; export reflects it                                       |
| 1.9 | ☐      | **`claimStateDatabase` has no test that observes it.** Its failure mode needs `serverRoot` empty while `pathResolver` is set, which `resolvePackageRoot` makes unreachable today (it throws instead). The divergence guard IS tested (3 cases, falsified). Either construct the state or record it as defense-in-depth | —       | a test that fails when `claimStateDatabase` is removed — or a recorded decision not to |

**Gate**: validate:all; `.claude-plugin/` + `.mcp.json` UNCHANGED (Claude Code installs unaffected).

### Tier 0.5 — Claims-conformance suite (owner-raised 2026-08-09; token-free functional validation) — ✓ LANDED 2026-08-09

**All five rows ✓. Gate passed**: `validate:all` 32/32 · `verify:claims` 14/14 · `test:e2e` 58/60
(2 pre-existing skips) · both falsification gates reproduced. **It found a real divergence on its
first run — see row 0.5.6.**

**Discovery counts re-measured at execution — every one HELD**: operators.json 8 = 6 implemented

- 2 reserved (`+`, `?`) · `VALID_MODIFIERS` at command-parser.ts:39 (clean/judge/lean/framework) ·
  verify-mcp-surface.mjs 669 · http-mcp-client.ts 641 · mcp-server-smoke.test.ts 721 ·
  validate-readme.js 235 · ci.yml E2E step · npm-publish.yml runs `test:ci` at :91.

**One count not reproduced, and it is a PROBE difference rather than drift**: the discovery says
"README 36 syntax-bearing lines". Re-probing found 28 lines matching a symbolic-syntax regex and
4 fenced blocks containing symbolic syntax. The original regex is unstated, so these measure
different properties and none of them falsifies the others. Recorded because 0.5.5's scope was
chosen from this measurement, not from the authored number.

**Position**: numbered 0.5 by owner designation (raised while Tiers 0–1 were in flight); executes
AFTER Tier 1, BEFORE Tier 2 — the renderer ships nothing until the claims the distributions
advertise are mechanically provable, and Tier 3's release-train wiring is where this suite's gate
lands. **Motivation**: Tier 3a of the acquisition plan found 9 OVERSTATED README claims by hand
(`%guided` threw a parse error for anyone who typed it); this makes that class a red CI job. The
server needs no LLM to be exercised — the LLM is the client, and a script plays that role, so
functional coverage costs zero tokens.

**Discovery (probed 2026-08-09, `/search` + direct)**:

- Two spawn harnesses exist: `verify-mcp-surface.mjs` (669 ln — RPC client, mutation baseline,
  action-coverage; deliberately does NOT import the e2e helpers, see its header comment) and
  `tests/e2e/helpers/http-mcp-client.ts` (641 ln — `startServerWithHttp`,
  `StreamableHttpMcpClient`). The driver reuses the e2e helpers; jest can import them, and the
  smoke suite proves the pattern.
- `mcp-server-smoke.test.ts` (721 ln) covers transport/protocol/startup/state placement — it does
  NOT cover the symbolic syntax matrix, `resource://` reads, chain resume, gate-verdict
  round-trip, or built-ins. No overlap; the conformance suite is a sibling, not a replacement.
- Machine-readable claims sources: `tooling/contracts/registries/operators.json` (6 implemented
  operators + 2 `reserved` — the status field gives the NEGATIVE rows for free: `+` and `?` must
  reject), `VALID_MODIFIERS` at `command-parser.ts:39-43` (clean/judge/lean/framework + the
  one-modifier rule), README (36 syntax-bearing lines), `validate-readme.js` (235 ln, parsing
  infra ready for the cross-check).
- CI wiring precedent: `test:e2e` runs only in ci.yml's full-route Test Suite job (:372);
  `npm-publish.yml` runs `test:ci` (unit only). So a driver living in `tests/e2e/` inherits the
  right cadence automatically: full CI routes + an explicit release gate, never per-commit hooks.

**Test classification (`/testing` RESULT)**:

```
test_type       : e2e
  rationale     : critical-user-workflow branch — documented claims exercised over real transport
                  against a spawned dist server; written now because claims = published surface
test_location   : NEW server/tests/e2e/claims-conformance.test.ts + NEW
                  server/tests/e2e/conformance/*.yaml corpus. New-file justification: new domain
                  boundary — smoke tests transport/protocol CORRECTNESS, this tests documentation
                  TRUTHFULNESS, and the corpus grows with docs, not code
mock_boundary   : no mocks — real dist server, real bundled resources, temp MCP_WORKSPACE per run
  kept_real     : the entire server + resource tree; the claim IS the integration
coverage_impact : modifier branches (command-parser.ts:108-150), operator dispatch, resource://
                  handlers, gate-verdict parse paths — none currently exercised end-to-end
edge_cases      : reserved operators (+, ?) MUST reject · modifier stacking MUST error · unknown
                  framework id · malformed gate_verdict string · unknown resource:// URI
inventory_required : yes — the corpus IS the inventory (claim → scenario mapping, one row each)
```

**Steps**:

| #     | File                                              | Change                                                                                                                                                                                  | ~Lines | Depends | Verify                                  |
| ----- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- | --------------------------------------- |
| 0.5.1 | server/tests/e2e/conformance/*.yaml (NEW dir)     | scenario corpus: `{id, claim_source (README §/doc/registry), requests, expect}` — first batch = full symbolic matrix from operators.json + VALID_MODIFIERS, including the negative rows | ~150   | —       | corpus validates against its own schema |
| 0.5.2 | server/tests/e2e/claims-conformance.test.ts (NEW) | driver: load corpus → `startServerWithHttp` → execute scenarios via `StreamableHttpMcpClient`                                                                                           | ~180   | 0.5.1   | suite green + falsification gate below  |
| 0.5.3 | server/package.json                               | `verify:claims` script (jest, that one file); NOT added to test:ci / pretest / pre-commit                                                                                               | ~3     | 0.5.2   | `npm run verify:claims`                 |
| 0.5.4 | .github/workflows/npm-publish.yml                 | pre-publish step runs `verify:claims` — a release cannot ship claims the server fails                                                                                                   | ~10    | 0.5.3   | dispatch dry-run                        |
| 0.5.5 | server/scripts/validate-readme.js                 | cross-check: every fenced README syntax example maps to a scenario id — a new claim cannot ship untested                                                                                | ~40    | 0.5.1   | self-test: unmapped example fails       |

**Falsification gate (TVD, distinct mutations → distinct failures)**: (a) seed a scenario
asserting `%guided` works — the driver must FAIL it (the 3a defect class, reproduced on purpose);
(b) locally neuter the one-modifier rule — only the stacking scenario reds, nothing else.

**✓ BOTH REPRODUCED 2026-08-09.** (a) the seeded `%guided`-works row failed alone (1 failed, 10
passed). (b) neutering the one-modifier throw in command-parser.ts and rebuilding reddened exactly
`modifier-stacking-rejects` (1 failed, 9 passed) — distinct mutation, distinct failure. Sources
restored and re-verified clean after each.

#### Rows added during Tier 0.5 execution

| #      | Status                            | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Depends | Verify                                                                                                                                                                                                                               |
| ------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0.5.6  | ☑ LANDED 2026-08-11               | **PREMISE FALSIFIED, defect BIGGER than recorded, now fixed.** The row said "`+` rejects, `?` does not". Measured 2026-08-11: **neither** was enforced. `+` only looked enforced because its scenario omitted `text:` and died on the fixture's `word_count` script ("Missing required field: text") — row 0.5.12's wrong-reason class hiding inside this row. With `text:` supplied, `+` AND the documented conditional form both ran and returned success with the operator silently dropped. Separately the `?` scenario probed `>>a ? >>b`, a bare `?` the registry pattern does not match and the tokenizer deliberately ignores so natural language parses — it measured argument-text fall-through, not the operator. **Fix**: `RESERVED_OPERATORS` derived from the registry `status` field + `rejectReservedOperators()` in `command-parser.ts`, consuming tokenizer output so the existing exclusions (quoted `+`, chain precedence, bare `?`) are inherited rather than re-derived. `known_divergence` deleted                                                                                   | —       | ✓ both rows assert the distinctive message; 3 distinct mutations → 3 distinct single-row failures; 55/55 claims, 2048/2048 unit                                                                                                      |
| 0.5.7  | ☑ LANDED 2026-08-11               | **`%framework` had a scenario but no negative row** — correct. Its stated reason was not: **`%framework` takes NO value.** It is boolean (`VALID_MODIFIERS` → `framework: true`; tool description documents it bare), so "with and without its argument" had no valid arm. Measured: `%framework:x` → `Parse error`, `%framework x` → `Unknown prompt "x"`. Landed 3 rows — bare form now asserts the claimed EFFECT via `text_contains: 'C.A.G.E.E.R.F'` rather than `ok: true` (which cannot see a modifier that parses and does nothing), plus both value forms rejecting                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 0.5.1   | ✓ 3 scenarios; mutation (`framework: false` in `buildModifiers`) reddens exactly `modifier-framework`                                                                                                                                |
| 0.5.9  | ☑ LANDED 2026-08-11               | **CLAUDE.md said "10 action handlers"; the router dispatches 11** and `system-control/handlers/` holds 11 files — re-measured, the finding held exactly. Fixed at all 5 sites (CLAUDE.md ×2, `docs/architecture/overview.md` ×3) and the CLAUDE.md table row now ENUMERATES the 11 rather than restating a bare count, so the claim is self-checking — a bare number is what drifted unnoticed. Also corrected `gate`→`gates` in the overview's illustrative lists to match the actual dispatch key                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | —       | ✓ count + enumeration match the router dispatch set                                                                                                                                                                                  |
| 0.5.10 | ☑ LANDED 2026-08-11               | **Premise held; isolation delivered, and it exposed a real defect plus two divergences.** Driver now supports a doc-level `workspace: isolated` mode: a second server on a throwaway `MCP_WORKSPACE` holding a COPY of the bundled tree, so create/update/delete/rollback write there and never into the repo. **This mattered — a probe run WITHOUT the workspace config.json wrote `probe_rb` straight into `server/resources/prompts/examples/`**, confirming `MCP_WORKSPACE` alone does not redirect prompt writes; the workspace `config.json` does. 7 mutating rows landed in `workspace-and-mutations.yaml`. **Defect found and FIXED**: `resource_manager(action:"reload")` reported "All prompts refreshed from disk" and served the PRE-update body — `fullServerRefresh` → `loadAndProcessData` → `loadPromptData` never cleared the PromptLoader file cache, while its sibling `reloadPromptData` (watcher path) always did. Only the debounced watcher applied changes, ~4s later. One line in `data-loader.ts`; falsified by reverting it (reds exactly `prompt-update-is-live-after-reload`) | 0.5.2   | ✓ 72 scenarios green; isolation verified by a clean `git status` on `server/resources/` after a full run                                                                                                                             |
| 0.5.11 | ☑ LANDED 2026-08-11               | **The corpus fixture had three unrelated failure modes, not one.** `reference_demo` declares `text` as REQUIRED, embeds a `{{script:word_count}}` tool, and pulls `{{ref:shared_intro}}` — it is the demonstrate-every-feature prompt, so any of the three could redden a row that named something else. Created `examples/minimal_prompt` via `resource_manager` (no arguments, no tools, no includes; its description forbids adding any) and migrated **38 of 39** uses. Reuse of an existing zero-arg prompt was considered and rejected — see implementation notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 0.5.1   | ✓ only `named-arguments` keeps `reference_demo`, because its claim IS argument passing; upgraded from `ok: true` to `text_contains: 'hello world'` so it observes the argument arriving                                              |
| 0.5.12 | ☑ LANDED 2026-08-11               | **A negative scenario can pass for the wrong reason — and six did.** All six bare `rejects: true` rows asserted only THAT the call failed, so any unrelated failure on the same input satisfied them; `operator-plus-reserved` is the proven case (green for two months on the fixture's missing-argument error while `+` was in fact accepted). Each now asserts a substring only its own claim produces, and the class is closed STRUCTURALLY: `rejects` is deleted from the driver and `loadCorpus()` throws on it by name, so a seventh cannot be written                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 0.5.2   | ✓ zero bare rejections remain; seeded `rejects: true` and empty-`expect` rows each fail at load with an explanatory message; disabling reserved-operator enforcement now reddens the `+` row, which the old fixture could not detect |
| 0.5.13 | ◐ PARTIAL 2026-08-11              | **Landed**: `gate_verdict` structured object AND legacy string, both asserting `Progress 2/3` (a gated resume returns success without advancing, so `ok:` is blind here). The legacy-string row is the dated retirement measurement CLAUDE.md's retirement clause needs — it must be deleted in the same commit that deletes the string branch. Also landed the C8 divergence as a self-retiring row. **NOT landed, and deliberately**: `force_restart` and `gate_action` — neither can be asserted falsifiably today, see rows 0.5.16 and 0.5.17                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 0.5.2   | ✓ corpus 58; falsification: supplying the verdict makes the divergence row RED, proving the exception self-retires                                                                                                                   |
| 0.5.14 | ☑ ALREADY COVERED (row was stale) | **Re-measured 2026-08-11: all 8 declared frameworks already have scenarios** — `5w1h`, `focus`, `liquescent`, `radiant`, `scamper`, `verify` in `frameworks.yaml`, `cageerf` + `react` in `prompt-engine-surface.yaml`. The row's "6 of 8 unexercised" was true when written and was closed by the B-series work without the row being updated. **The "infinite user frameworks" concern is structurally moot**: `resources/frameworks/` is fully git-tracked (8 dirs), and user-created frameworks live in the operator-local tree that CI never checks out — the corpus can only ever see the bundled set                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 0.5.1   | ✓ 8 declared = 8 scenarios. Residual risk is a NEW bundled framework shipping untested — see 0.5.18                                                                                                                                  |
| 0.5.15 | ☑ LANDED 2026-08-11               | **Decision taken: reject, and the reasoning that justified the exemption had expired.** Chain precedence suppressed the `parallel` token so `>>a --> >>b + >>c` ran as a 2-step chain with `+` swallowed into argument text, while the standalone form errored and `?` was rejected in the identical position. The precedence rule protects a chain from having its `+` consumed as a parallel STEP — which cannot happen while `+` is `status: reserved`, because no strategy may consume the token and `rejectReservedOperators` throws first. The suppression is now keyed on the registry status, so it returns automatically if `+` is ever implemented. Two unit tests encoded the old behaviour and were inverted with the reasoning recorded in place                                                                                                                                                                                                                                                                                                                                               | 0.5.6   | ✓ 2 rows: rejection inside a chain + `topic:"R3F + Visx"` still runs. Falsified by reverting the tokenizer guard — reds only the rejection row                                                                                       |
| 0.5.16 | ☑ LANDED 2026-08-11               | **FINDING WITHDRAWN — the parameter is observable; the row measured the one path where it is not.** A bare `command` already mints a new chain id, so `true` and absent are identical there — which is all the row tested. Re-measured 2026-08-11 on the resume path: `chain_id` + `force_restart:true` is REJECTED ("'force_restart=true' cannot be used together with 'chain_id'"), and a chain id carried in the COMMAND TEXT plus a resume payload resumes without the flag (`Progress 2/3`) but is looked up as a prompt name with it (`Unknown prompt`). Three rows landed, including the paired without-flag arm that makes the middle one mean something. The description — "Create a new chain execution (increments chain ID). Use `command`" — pointed at the dead path and was corrected at both sources                                                                                                                                                                                                                                                                                        | 0.5.13  | ✓ falsified 3 ways: removing the flag reds each of the two flag rows, adding it reds the paired arm                                                                                                                                  |
| 0.5.17 | ☑ LANDED 2026-08-11               | **FINDING FALSIFIED — `skip` works.** The row observed the same named gate at `attempt 1/3` after a skip and, correctly, declined to call it a defect because a sibling gate could explain it. It was a sibling gate: skipping the shell-verify gate hands off to the framework's own gates (content-structure, intent-quality, framework-compliance), whose fresh counter reads like a reset. Measured 2026-08-11 — after `gate_action:"skip"`, the next resume reaches `Execution complete` even though the gate's command is `exit 1` and can never pass. The row asserts COMPLETION rather than the intermediate response, because asserting the latter would measure which gate spoke next — the exact ambiguity that produced the finding                                                                                                                                                                                                                                                                                                                                                             | 0.5.13  | ✓ falsified by swapping `skip` for `retry` — the run no longer completes                                                                                                                                                             |
| 0.5.18 | ☑ LANDED 2026-08-11               | **`validate:conformance-coverage` added and wired into `validate:all`.** Cross-checks git-tracked `resources/frameworks/*` against the corpus, matching only comment-stripped text so a framework named in a YAML comment does not count as coverage (the exact false-pass `validate-readme.js` had). Word-bounded, so `react` is not satisfied by `reactivity`. Falsified end-to-end by creating a real 9th directory — gate exits 1 and names it — plus a 4-case `--self-test`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 0.5.14  | ✓ 8/8 exercised; a new bundled framework now cannot ship unexercised                                                                                                                                                                 |
| 0.5.19 | ☑ LANDED 2026-08-11               | **Three README-advertised constructs had ZERO scenarios**; all three now assert their EFFECT, not `ok`. `#` style → the style's own text (`systematic analysis`) reaches the response · `*` repetition → `Progress 1/2`, proving it UNFOLDS INTO A CHAIN rather than running once · `loop:true` → `Loop mode: autonomous retry`. Each would have passed an `ok: true` row while being silently dropped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 0.5.1   | ✓ corpus 61; removing the style scenario reds `validate:readme`                                                                                                                                                                      |
| 0.5.20 | ☑ LANDED 2026-08-11               | **README claimed "ships 120+ prompts across 17 categories"; the tarball holds 27 across 4.** Owner decision: correct the number AND reframe — the bundled set is "a starting library, not the ceiling: your AI writes new prompts and chains through `resource_manager` as it works". That is both true and the better claim, since 117/17 on the author's machine is EVIDENCE of the organic growth, not evidence of what ships. New gate `checkShippedPromptCount` recomputes from `git ls-files --cached --others --exclude-standard` (verified equal to `npm pack --dry-run`) so the number cannot drift again                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | E3      | ✓ seeding the old 120/17 figure reds the gate                                                                                                                                                                                        |
| 0.5.21 | ☑ LANDED 2026-08-11               | **`validate-readme`'s claim-coverage check was narrower than its name, in two ways.** (a) operator set was hardcoded `['-->','==>','::']` + `%modifiers`, so `#` and `*` — both in the README's own primitives table — were exactly the symbols it never looked for; now read from `operators.json`, the same registry the parser loads. (b) matching was `corpus.includes()` over whole files, so a symbol in a YAML COMMENT counted as coverage; now matches only `command:` values with comments stripped. Detection also restricted to CODE SPANS with an identifier requirement — the first rewrite flagged `#` on the README's own H1, since `#` is heading syntax                                                                                                                                                                                                                                                                                                                                                                                                                                    | 0.5.5   | ✓ caught `#` immediately on its first run — the defect it was written for                                                                                                                                                            |
| 0.5.22 | ☑ LANDED 2026-08-11               | **Made observable, and doing so exposed a real defect.** The response now publishes the RESOLVED budget — `Verify budget: N attempts / Ms timeout (preset: X)` — sourced from a new `state.gates.shellVerifyBudget` field written where presets expand. It needed its own field: `pendingShellVerification` is cleared by stage 17 the moment verification finishes, so every PASSING command had nothing left to report. **Defect found and FIXED**: `:fast` ran with a **300s** timeout, not the 30s the README claims. `symbolic-operator-parser` eagerly defaulted `timeout` at parse time, so `setupShellVerification`'s `config.timeout ?? preset.timeout` never reached the preset. `maxIterations` was left undefined and therefore worked — that asymmetry is exactly what hid it. `appendLoopHint` also printed the global default for every preset; it now reads the resolved budget. All three rows now assert their own README cell and are distinguishable from each other                                                                                                                    | 0.5.19  | ✓ falsified by reverting the parser fix — reds `gate-preset-fast` + `gate-preset-extended`, and `:full` correctly stays green since 300s was already its value                                                                       |
| 0.5.23 | ☐                                 | **FINDING — `resources/list` advertises URIs that `resources/read` cannot serve.** Ids containing a slash (nested prompt categories, e.g. `resource://prompt/deep_analysis/initial_scan`) are listed with no marking and 404 on read; `resource://prompt/minimal_prompt` reads fine in the same run, isolating the slash as the cause. A client that enumerates the surface and reads each entry fails on a subset with no way to predict which. Held as a self-retiring `known_divergence` row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 0.5.8   | the read handler matching multi-segment ids, OR list ceasing to advertise ids it cannot serve; then delete the divergence block                                                                                                      |
| 0.5.24 | ☐                                 | **FINDING — `confirm` is documented as delete's safety gate and is not read on that path.** Schema text: "Safety confirmation for delete operation." Measured 2026-08-11: delete WITHOUT `confirm` removes the prompt directory and reports success, while the SAME parameter is enforced for rollback in the same handler and in the same run — which rules out configuration. The description is currently false, not merely incomplete. Held as a self-retiring `known_divergence` row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 0.5.10  | enforcing `confirm` on delete (breaking → major bump, CLAUDE.md § Public API Contract) OR correcting the description to say only rollback enforces it                                                                                |
| 0.5.25 | ☐                                 | **`update` is eventually consistent, and nothing says so.** Post-fix, an explicit `reload` now applies immediately — but a bare `update` still is not live until the debounced watcher fires (~seconds), so update-then-execute serves the old body. Not filed as a defect: no doc claims immediacy, and the corpus works around it deterministically by forcing a reload. Worth a sentence in the tool description so callers do not discover it the way this tier did                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 0.5.10  | a documented statement of update's visibility semantics, or update triggering its own refresh                                                                                                                                        |
| 0.5.26 | ☐                                 | **FINDING — the `checkpoint` resource_type has no producer.** A quarter of the published `resource_type` enum returns "Checkpoint manager is not available" for every action, and no configuration changes that: the handler factory exists, is exported, and is called from nowhere. The error text promises an "enable" that does not exist, which is worse than an honest "not implemented". Held as a self-retiring divergence row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | A5      | inject the handler, OR remove `checkpoint` from the enum + contract; then delete the divergence block                                                                                                                                |
| 0.5.8  | ☑ LANDED 2026-08-11               | **The `resource://` surface was not merely uncovered — the docs overstated it.** `resources.registerWithMcp` defaults to **false** (`config/index.ts:186`), so on a stock server `resources/list` returns `{resources: []}` and every URI in `docs/reference/mcp-tools.md` answers "Resource not found". The existing `resources-list` row asserted `ok: true`, which passes on an EMPTY list — the adjacent-property shape again, and it is why nobody noticed. Docs now state the opt-in (both `mcp-tools.md` and `architecture/overview.md`); the shared row asserts the default via a new `resources_empty` mode; real reads are exercised on the isolated server, which enables the surface. Chain resume and gate-verdict round-trip were already closed by B4/0.5.13                                                                                                                                                                                                                                                                                                                                 | 0.5.2   | ✓ `resources_empty` on the default server + `resources_include`/read rows on the enabled one; both falsified                                                                                                                         |

**Cadence contract (the owner's "not repeated always")**: zero tokens ever (scripted client);
runs on full-route CI (rides test:e2e), the npm-publish gate, and on demand before engine/parser
merges. Never in pre-commit, never in the docs/hooks push routes, and token-bearing evaluation
(Maya-style roleplay, judge-quality grading) stays reserved for README reworks (3b) only.

### Tier 2 — Renderer + drift check

| #     | File                                   | Change                                                                                                                                                                                                    | ~Lines    | Depends | Verify                                                                                                     |
| ----- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| 2.1   | scripts/render-distributions.mjs (NEW) | reads targets; emits native package + per-client renders (manifest transform, `${PLUGIN_ROOT}`↔`${CLAUDE_PLUGIN_ROOT}` rewrite, hook mapping, opencode tsc)                                               | ~250      | 1.1–1.4 | **zero-diff render** vs current .claude-plugin/, .mcp.json, gemini-prompts, opencode-prompts working trees |
| 2.2   | same file, `--check` mode              | render to temp, byte-compare vs published target                                                                                                                                                          | ~40       | 2.1     | seeded mutation → check fails                                                                              |
| 2.3 ⚠ | validate-versions (owning script)      | **Premise narrowed 2026-08-09**: root plugin.json is ALREADY registered (row 1.5 landed it early — a versioned manifest with no gate drifts immediately). This row now covers only the RENDERED manifests | ~20 → ~14 | 2.1     | gate green                                                                                                 |

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

## Execution record — Tier 0 + Tier 1, 2026-08-09

**What was measured.** Every plan count was re-probed before executing; the held/falsified split
is in "Re-measured 2026-08-09" above. Two premises were falsified (0.1, 1.4) and both Step texts
were rewritten in place rather than overwritten, so the original reasoning stays legible.

**How 0.1's real defect was found — and why the plan's version was wrong.** The plan reasoned
from a grep (`import.meta.url`/`__dirname` writers) to a conclusion about runtime behavior. The
grep was accurate and the conclusion was not: those hits are all resource LOADERS, not state
writers, and the state writer chain (`getRuntimeStatePath` → `getRuntimeRoot` → `getWorkspace`)
was already clean. Running the packaged binary with `MCP_WORKSPACE` set — the plan's own Verify —
showed state and logs already landing in the workspace. The defect only appeared when reading
`getInstance`: a singleton, six call sites, one of which passes the resolved `dbPath`. The probe
that found it measured _where the file lands_; the probe that missed it measured _which tokens
appear_.

**Fix shape.** Two halves, deliberately: the composition root claims the singleton
(`claimStateDatabase`), and `getInstance` throws on a conflicting `dbPath`. The first makes the
path an invariant instead of an ordering accident; the second means any future call site that
disagrees says so instead of writing somewhere nobody reads.

**Substitutions and vacuous checks, recorded.**

| Check                        | Status at run                    | What was done                                                           |
| ---------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| 0.4 `validate:agent-plugins` | vacuous at Tier 0 (no manifests) | carried by `--self-test`; became live at 1.1/1.2 (2/2 schema-valid)     |
| 1.3 "renderer self-check"    | vacuous (renderer is Tier 2.1)   | substituted: `consumes`-path resolution + required-key check, 4 targets |
| 1.2 "server boots"           | runnable                         | booted via host-simulated `${PLUGIN_ROOT}`/`${PLUGIN_DATA}` expansion   |

**A gate that could not see the change.** `lint:ratchet` counts violations, not the number inside
one. Inlining 0.1's claim raised `initializeModules` cognitive complexity 63 → 64 with the ratchet
still green, because the function was already over the limit and the violation count was
unchanged. Measured by running eslint on the file before and after, then extracted to
`claimStateDatabase` to restore 63. **This blind spot is general and not specific to this tier**
— any addition inside an already-violating function is invisible to the ratchet.

**Test coverage, stated honestly.** The divergence guard has 3 tests and was falsified (neutering
the throw reddened exactly 1 of 3 — distinct mutation, distinct test). The new
`MCP_WORKSPACE` e2e test is a **regression guard, not a falsification**: it passes on the unfixed
code too, because the tracker ordering happened to work. It closes a real gap — the sibling test
covered `MCP_RUNTIME_ROOT`, a different branch — but it does not prove the fix. `claimStateDatabase`
itself is untested; row 1.9 owns that.

## Execution record — Tier 0.5, 2026-08-09

**The suite justified itself on its first run** by finding a divergence no human review had: `?` is
declared `reserved` in operators.json and the server accepts it (row 0.5.6). That is the same
shape as the 9 overstated README claims Tier 3a found by hand — a published claim the runtime does
not honor — and it was found mechanically, in seconds, at zero token cost.

**A red suite cannot ship, but suppressing the finding defeats the tier.** Resolved with an
inverted assertion: a `known_divergence` block keeps the scenario asserting the CLAIM, and the
driver asserts the divergence still PERSISTS. The day `?` is fixed, the row goes red as a
_satisfied_ exception naming itself for deletion. This is deliberately the opposite of `skip`,
which would go quiet forever — see `cleanup-standards.md` § A Suppression Outlives What It
Suppressed.

**One red row was MY defect, not the product's — worth recording because the failure mode is
generic.** `operator-gate` failed against the README's verbatim syntax, which read as a second
overstated claim. It was not: `reference_demo` embeds a `{{script:word_count}}` tool that requires
a `text` argument, so the scenario died on the fixture's own validation before the gate operator
was ever evaluated. **A conformance row that fails for a reason unrelated to its claim is worse
than no row** — it manufactures a false finding against the product. Diagnosed only after the
driver was changed to print the server's actual words on failure, which is now permanent.

**0.5.5 scope narrowed from the authored row, deliberately.** Authored as "every fenced README
syntax example maps to a scenario id"; implemented as **every symbolic CONSTRUCT the README
advertises has ≥1 scenario**. Fenced blocks are prose-shaped: two examples of `-->` are one claim,
so a per-block rule would demand duplicate scenarios while still missing a construct mentioned only
in a sentence. Measured surface: 7 constructs (`-->`, `::`, `==>`, `%clean`, `%lean`, `%judge`,
`%framework`), all now covered. Falsified by adding `%turbo` to the README — caught with a located,
named violation.

**Known limitation of 0.5.5, stated rather than discovered later**: it checks a construct is
PRESENT in the corpus, not that the corpus AGREES with the README about it. `%guided` appears in
the corpus as a rejection scenario, so a README claiming `%guided` works would pass this gate and
be caught only by the suite itself. The two checks are complementary; neither alone is sufficient.

### Tier 0.5b — Close the claim-coverage gaps (owner-directed 2026-08-09)

**Position**: immediately after 0.5, before Tier 2. Absorbs rows 0.5.6–0.5.14, which were filed
during 0.5's execution and are re-expressed here as three owner-named workstreams.

**RESUME-FROM-COLD STATE (rewritten 2026-08-11 — the 2026-08-09 version was stale in every count):**

- Corpus = **77 scenarios**, 6 files under `server/tests/e2e/conformance/`. Re-count with
  `npm run verify:claims`, which prints the total; never trust a per-file split written here.
- Driver = `server/tests/e2e/claims-conformance.test.ts`. Rides `test:e2e` on full-route CI and
  gates `npm-publish.yml`.
- **Two servers now.** A doc-level `workspace: isolated` key routes a file to a second server
  running against a throwaway COPY of the bundled tree (`MCP_WORKSPACE` + patched `config.json`),
  which is what makes create/update/delete/rollback safe to assert. `MCP_WORKSPACE` alone is NOT
  enough — without a workspace `config.json`, prompt writes land in the repo (measured).
- `expect:` supports `ok` / `error_contains` / `text_contains` / `tools_include` /
  `resources_include` / `resources_empty`. **`rejects:` was REMOVED** — the driver throws on it by
  name, because a bare "this failed" cannot distinguish its claim from any unrelated failure.
- `known_divergence` inverts the assertion so a fix reds the row. Three are live: nested
  `resource://` ids unreadable, `confirm` unread on delete, gated resume reporting silent success.
- **Fixture is `examples/minimal_prompt`** — zero arguments, no script tools, no `{{ref:}}`. One
  row still uses `reference_demo` because its claim IS argument passing (E1).
- Gates added by 0.5: `validate:conformance-coverage` (a bundled framework with no scenario fails)
  and `checkShippedPromptCount` inside `validate:readme`.
- **Commit state 2026-08-11**: `fix(runtime)` and `feat(execution)` LANDED (`8875ab42`,
  `d76f7414`). Three commits remain staged/prepared and are blocked by the adaptive-chain
  workstream's in-flight `eslint-ratchet.js` scope change, which fails `pre-commit` for everyone
  until its baseline is regenerated by that owner.

#### Workstream A — `resource_manager` remaining actions (OWNER-IN-LOOP, safety-gated)

**Why this is not just "add more scenarios".** `resource_manager` advertises 14 actions across 4
resource_types. `list` is covered. The rest — `create`, `update`, `delete`, `reload`, `inspect`,
`analyze_type`, `analyze_gates`, `guide`, `switch`, `history`, `rollback`, `compare`, `clear` —
include five that MUTATE the resource tree and `state.db`, and `state.db` is shared across every
project on the machine (CLAUDE.md § Runtime State). A careless scenario does not fail a test; it
deletes the owner's prompts or rolls back real `version_history` rows.

| #   | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Depends | Verify                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | ✓ 2026-08-09 **LANDED — was already overdue, not merely a prerequisite.** `startServerWithHttp` gained an optional `env` override (backwards-compatible; smoke suite unaffected, e2e 88/90); the driver spawns with a temp `MCP_RUNTIME_ROOT` and removes it in teardown. **Verified empirically: live `<repo>/runtime-state/state.db` mtime IDENTICAL across a full 44-scenario run.** Resources still point at the bundled tree, so only the writable roots moved | **Driver gains per-scenario workspace isolation.** Spawn with a temp `MCP_WORKSPACE` + `MCP_RUNTIME_ROOT` seeded from a fixture resource tree, torn down after. **MEASURED 2026-08-09: the suite ALREADY writes to a real shared `state.db`** — `startServerWithHttp` sets `MCP_WORKSPACE: PROJECT_ROOT`, and `<repo>/runtime-state/state.db` was modified 24s after a `verify:claims` run. So every conformance pass is appending `execution_records`/`arg_history` and mutating chain state in the developer's live database. That is benign today only because nothing asserted on it; it stops being benign the moment B2 or any A4 row lands                         | 0.5.2   | a mutating scenario runs twice with identical results; `<repo>/runtime-state/state.db` mtime UNCHANGED across a full `verify:claims` run |
| A2  | ✓ 2026-08-11                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **5 scenarios landed** on the shared server (read-only by construction): `guide`, `analyze_type`, `analyze_gates`, `gate inspect`, `framework inspect`. Each asserts a string only that action emits — `analyze_type` asserts the CLASSIFICATION (`single`), `gate inspect` asserts the gate's own guidance body — so no row can pass on a generic success banner. `list` had been the only one of 14 actions any scenario exercised                                                                                                                                                                                                                                      |
| A3  | ⚠ **SEQUENCE INVERTED — reassessed 2026-08-11**                                                                                                                                                                                                                                                                                                                                                                                                                     | The walkthrough was a gate on writing mutating scenarios, and it existed because there was no safe place to run them. Tier 0.5.10 built that place: a `workspace: isolated` corpus mode spawning a second server against a throwaway COPY of the bundled tree, so create/update/delete/rollback cannot reach the repo. Seven mutating scenarios landed against it, each asserting a substring measured from a real server. The walkthrough now guards nothing the isolation does not — **it survives only as the Workstream A owner acceptance pass** (tool descriptions steering a real LLM), which no corpus can observe and which is scheduled after 0.5 closes        |
| A4  | ✓ **DELIVERED 2026-08-11, out of order**                                                                                                                                                                                                                                                                                                                                                                                                                            | 7 mutating scenarios in `workspace-and-mutations.yaml`: create→inspect, update→version, update→reload→execute (hot-reload), rollback-requires-confirm, rollback-restores-content, delete-removes, delete-confirm (divergence). Verified against a measured probe transcript rather than the A3 walkthrough — same evidence, different producer. **Found two defects**: `reload` reported "refreshed from disk" while serving stale content (FIXED), and `confirm` is documented as delete's safety gate but is not read on that path (held as a divergence row, 0.5.24)                                                                                                   |
| A5  | ✓ **FINDING — closed as a divergence row 2026-08-11**                                                                                                                                                                                                                                                                                                                                                                                                               | `checkpoint` is one of four values in the published `resource_type` enum and **cannot succeed under any configuration**. Every action returns "Checkpoint manager is not available. Ensure checkpoint support is enabled" — but there is no such setting: `createCheckpointToolHandler` is defined and re-exported, and `rg` finds NO call site in `src/`; `ResourceManagerRouter.checkpointManager` is declared optional and never injected, so the guard at `router.ts:405` is unconditionally true. A reader with no producer, where the schema enum is the interface that decides it is a MISSING PRODUCER rather than a redundant channel. Row 0.5.26 tracks the fix |

#### Workstream B — Frameworks (owner: "most severe")

**Measured state, stated precisely so nobody re-derives it**: no framework DEFECT has been found.
`@CAGEERF` and `@ReAct` both succeed; `@NotARealFramework` rejects (and that row was disambiguated
so it rejects for the framework reason, not the fixture's). The severity is **coverage**: 2 of 8
ids exercised, and `FrameworkManager.getFramework(id)` is named in CLAUDE.md § Key Constraints as
the thing that must never be hardcoded — so a silent divergence here would be invisible.

| #   | Status       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Depends | Verify                                                        |
| --- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------- |
| B1  | ✓ 2026-08-09 | Scenario per framework id — all 8 now covered (`frameworks.yaml`, 7 new + `react`/`cageerf` already in `prompt-engine-surface.yaml`). **RESULT: all 8 PASS. No framework defect exists.** Unknown ids reject (disambiguated so the rejection is attributable to the framework, not the fixture)                                                                                                                                                                                                                                                                                                                      | —       | ✓ 44/44 `verify:claims`                                       |
| B2  | ✓ 2026-08-11 | **2 scenarios landed** on the isolated server, since `switch` persists to `kv_state`. One reads the state BACK (`5W1H Framework 🟢 ACTIVE`), the other proves the switch reaches EXECUTION (`operating under the 5W1H Framework`). Both matter: a registry that updated without the pipeline reading it passes the first and fails the second — the D6 shape. The correct call is `system_control(action:'framework', operation:'switch', framework:'…')`; the `operation` arg is required and its absence yields "Unknown framework operation: default". Both rows switch themselves, so they are order-independent |
| B3  | ✓ 2026-08-09 | Case-sensitivity pinned: `@CAGEERF` (upper, as the tool description shows) AND `@cageerf` (lower, as the directory holds) BOTH resolve. No divergence — recorded so the next reader does not re-derive it                                                                                                                                                                                                                                                                                                                                                                                                            | B1      | ✓ both casings green                                          |
| B4  | ✓ 2026-08-09 | **Driver needs `text_contains` to express a round-trip.** Landed at D5. **Necessary but not sufficient, measured at C0**: `text_contains` asserts on the last response's CONTENT, which still cannot COMPOSE request N+1 from response N — B2's read-back works because the args are known in advance, C1's resume is not. The missing half is `capture:` + `${...}`, now landed as **row C0**                                                                                                                                                                                                                       | 0.5.2   | ✓ a two-request scenario asserts on content, not just success |

#### Workstream D — `@` operator ergonomics (owner-directed 2026-08-09)

**Owner decisions**: (1) relax the trailing-space requirement; (2) retire `%framework`;
(3) **confirmed — `@` collides with the client in ALL harnesses** (file-picker / mention trigger),
which is the strongest argument yet for eventually changing the sigil.

| #   | Status                            | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Verify                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | ✓ 2026-08-09                      | `@` pattern relaxed `(?=\s\|$)` → `(?![A-Za-z0-9_-])`, so `@CAGEERF>>prompt` matches. Purely additive — strictly more permissive, spaced form unaffected. Changed in `operators.json` AND `hooks/prompt-suggest.py`                                                                                                                                                                                                                                                                                                                                                                                                                           | direct regex test: both forms match, `plain >>x` does not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D2  | ☐ **BLOCKED — premise falsified** | Retire `%framework`. **DO NOT EXECUTE AS WRITTEN.** The stated premise was that it duplicates `@`/active-framework selection. Measured: it does something else entirely — `execution-planner.ts:474` "`%clean` and `%lean` suppress the framework; `%framework` and `%judge` FORCE it" and `gate-set-resolver.ts:365` "`%clean` and `%framework` DROP EVERY GATE". So `@ID` picks WHICH framework; `%framework` forces injection on AND suppresses all gates — orthogonal axes. Retiring it deletes a force-on + gate-suppression capability and breaks 2 test files                                                                          | owner re-decides with this evidence; if still retiring, it is a removal from the reachable union → major bump per CLAUDE.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D3  | ✓ 2026-08-09                      | **`^` alias LANDED; `@` deprecated for next-major removal.** Additive and non-breaking — `^` is canonical (`operators.json` `symbol: "^"`, `deprecatedSymbols: ["@"]`, `deprecationNote` states the removal), `@` still parses. Sigil chosen by elimination: every other single char is taken by a harness or by us (`@` mention/file-picker, `/` commands, `!` bash, `#` our style operator + markdown heading, `%` our modifier prefix, `$` interpolation, `+`/`?` reserved). `^` is unclaimed by every harness, one char, keeps the prefix family with `#`/`%`, and `a^b` correctly does not match. **Four sites moved, not one** — see D6 | ✓ `verify:claims` 51/51 with falsification; `validate:all` 32/32; `test:e2e` 95/97; hooks pytest 30/30                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D4  | ☐                                 | **SSOT violation found while doing D1**: `hooks/prompt-suggest.py:201` hardcodes a byte-copy of the `@` regex, and `operators.json` declares only a `typescript` pattern — so the Python side is unmanaged drift that had to be moved by hand. Add a `python` pattern to the registry and have the hook derive from it                                                                                                                                                                                                                                                                                                                        | a gate fails when the two patterns diverge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D5  | ✓ 2026-08-09                      | **B4 landed**: driver gained `text_contains` (assert success AND content). Built because `ok: true` provably cannot see a silent no-op — see the finding below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `verify:claims` 47/47                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D6  | ✓ **CAUSE FOUND 2026-08-09**      | **The registry was never the operative path.** `operators.json` `framework.pattern` is consumed only for STRIPPING (`symbolic-operator-parser.ts:429`); the actual extraction is `parser-utils.ts:124` — a second, hardcoded `/(?:^                                                                                                                                                                                                                                                                                                                                                                                                           | \s)@([A-Za-z0-9_-]+)/g`with NO trailing lookahead, which is why`@SCAMPER>>x`parsed fine under the "strict" registry pattern and why reverting that pattern changed nothing. Two further hardcoded sites:`tool-routing.ts:16` `ALLOWED_PREFIX_TOKENS`and`response-assembler.ts:793/798` (footer rendering). **Both earlier diagnoses were wrong** — not framework persistence (`switchFramework`is never called from the pipeline) and not a stale build (esbuild inlines the JSON). D1's relaxation was real but INERT on its own. Now falsified properly: reverting`parser-utils.ts`reds exactly the 2`^` scenarios | ✓ distinct mutation → distinct failure |
| D9  | ☐                                 | **Four definitions of one operator — consolidate or gate.** `operators.json` (strip only), `parser-utils.ts:124` (real extractor), `tool-routing.ts:16` (routing allowlist), `response-assembler.ts` (rendering). A single `rg` for the registry pattern finds none of the other three, and D1 shipped a change that looked correct and did nothing. Either derive all four from the registry, or add a gate that fails when they diverge                                                                                                                                                                                                     | a mutation to the registry pattern alone must red something, or a gate names the divergence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D7  | ☐                                 | **Per-step framework switching — the owner's question.** MCP is NOT stateless (sessions + `kv_state`), so statelessness is not the blocker; and `@ID` is already PER-EXECUTION rather than persistent (D6 correction), so a per-step framework is architecturally possible today. UNVERIFIED: whether a CHAIN STEP definition can carry its own `@ID`, since a resume passes `chain_id` + `user_response` rather than a fresh command — the per-step command comes from the chain YAML                                                                                                                                                        | a 2-step chain with a different `@ID` per step: each step reflects ITS OWN framework, and the global active framework is unchanged afterwards                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D8  | ✓ 2026-08-09                      | **`%framework` documented** (owner-directed). MODIFIERS line in `tooling/contracts/prompt-engine.json` now reads `%clean (no injection/gates), %lean (gates only), %judge (preview), %framework (force framework, no gates)` and states the one-per-command rule. Cost +64 chars ≈ 16 tokens per call — accepted; it also lifts the one-modifier rule out of an error message into the description                                                                                                                                                                                                                                            | ✓ contracts regenerated; `verify:claims` 47/47                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**FINDING that raises D1's original severity.** `@CAGEERF>>prompt` did not error under the old
pattern — it **succeeded with the framework silently unapplied**. A user got a normal-looking
result and no signal that the framework never ran. That is why `ok: true` was the wrong assertion
and why D5 was needed; it is also worth asking whether an unmatched `@`-prefix should be a
rejection rather than a silent pass (candidate row, related to 0.5.6's `?` divergence — same
shape: a documented operator silently ignored).

#### Workstream C — Chain execution, restart, and gate verdicts

| #   | Status                                      | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Depends | Verify                                                                             |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| C0  | ✓ 2026-08-09                                | **Driver gains `capture:` + `${...}` binding — the round-trip primitive B4 could not supply.** `text_contains` (B4/D5) asserts on content but still cannot COMPOSE request N+1 from response N, and a resume is defined in terms of a `chain_id` only the server knows. Shape: `capture: {name: '<regex, one group>'}` on a request, matched against that response's TEXT (the footer is what a real client reads — `response-assembler.ts:658`); `${name}` interpolates into any later `args` string, walked recursively. **Two anti-false-pass properties are load-bearing, not polish**: an unmatched capture or an unbound `${...}` throws a distinct `ScenarioSetupError` that is re-thrown PAST the driver's catch, because that catch converts a throw into "the server rejected this" — which a `rejects:`/`error_contains:` row would have read as its claim being honored (rows 0.5.11/0.5.12, now structurally prevented for this class); and a failed capture never binds `""`, which would have produced a plausible request failing for a schema reason and blaming the wrong claim | 0.5.2   | 3 mutations → same 1 row reds, 51 untouched (see falsification record)             |
| C1  | ✓ 2026-08-09                                | Run a real multi-step chain end-to-end: execute → capture `chain_id` → resume with `chain_id` + `user_response` → confirm the step advanced. **LANDED** as `chain-lifecycle.yaml` / `chain-resume-advances-step`: `%clean >>quick_decision topic:"…"` → capture `chain-quick_decision#1` → resume → assert `text_contains: "Progress 2/3"`. Asserts the server's own progress counter, so a resume that silently re-served step 1 reds — which is exactly what the un-`%clean`ed variant does (row C8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —       | ✓ `verify:claims` 52/52; product mutation `currentStep = stepNumber` reds it alone |
| C2  | ⚠ **PREMISE FALSIFIED — closed 2026-08-11** | Asked to "restart an in-flight chain and confirm a NEW chain id". That is not a reachable state: `force_restart` + `chain_id` is REJECTED ("'force_restart=true' cannot be used together with 'chain_id'"), and a bare `command` already mints a new id, so on that path the flag is indistinguishable from its absence. Three rows landed instead, covering what the parameter actually does — the conflict rejection, suppression of a command-embedded resume, and the paired without-flag arm that makes the middle one falsifiable (plan row 0.5.16)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| C3  | ✓ 2026-08-11                                | **LANDED** as `chain-gate-verdict-structured`. Asserts `Progress 2/3`, not `ok:` — a gated resume returns success without advancing (see C8), so success is not evidence the verdict was honoured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| C4  | ✓ 2026-08-11                                | **LANDED** as `chain-gate-verdict-legacy-string` — the dated measurement CLAUDE.md's retirement clause needs. It must be deleted in the SAME commit that deletes the string branch, which is what makes the retirement observable instead of folklore                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| C5  | ✓ **all 3 arms — 2026-08-11**               | `skip` landed earlier (and falsified row 0.5.17). `retry` and `abort` landed now: retry asserts `Attempts: 0/1` — the counter moving BACKWARDS from the `1/1` in the preceding response — and abort asserts "No further verification will run". The three outcomes are textually distinct, which is what stops one arm passing for another's reason; swapping retry↔abort reds both                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| C6  | ✓ 2026-08-11                                | **The claim HOLDS — hypothesis was wrong, and that is the finding.** A malformed legacy verdict is rejected at the SCHEMA layer ("Gate verdict must follow format"), before any of the five regexes CLAUDE.md warns can fail to parse. Expected it to be silently accepted as a pass, given this tier's record; it is not. The row now guards that, and asserts the format requirement by name so it cannot be satisfied by an unrelated failure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| C7  | ✓ 2026-08-11                                | **Crutch removed by C3/C4.** `chain-resume-advances-step` still uses `%clean` deliberately — it isolates the resume claim from gate state, and that is the right shape for THAT row. What was missing was a gated counterpart, and the two `gate_verdict` rows are it: they drop `%clean` because the pending gate IS their claim. Both assert `Progress 2/3` rather than `ok:`, for the reason C8 records                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| C8  | ✓ **HELD AS A DIVERGENCE ROW 2026-08-11**   | **FINDING STANDS** and is now enforced rather than tracked: `chain-gated-resume-without-verdict` asserts the divergence PERSISTS, so the day a gated resume stops reporting silent success the row reds as a satisfied exception and must be deleted. Re-measured 2026-08-11, unchanged. `closed_by` names both acceptable fixes (a non-ok result, or amending the tool description to state the gate precondition)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

**Falsification record — C0/C1, 2026-08-09.** Three independent mutations, each run alone and
reverted; every one reddened `chain-resume-advances-step` and only it (1 failed / 51 passed / 52
total, from a 52/52 green baseline). The third is a PRODUCT mutation on purpose: driver mutations
prove the mechanism is load-bearing, but only a server mutation proves the assertion observes the
server rather than itself.

| Mutation                                                                   | Layer   | Reddened                     | Failure message proves                                              |
| -------------------------------------------------------------------------- | ------- | ---------------------------- | ------------------------------------------------------------------- |
| `applyCaptures` no longer writes the binding                               | driver  | `chain-resume-advances-step` | `"${chain_id}" is not bound` — capture is required                  |
| `bindValue` returns strings unsubstituted                                  | driver  | same, alone                  | server rejects literal `${chain_id}` on the `chain-…` pattern       |
| `manager.ts:1005` `currentStep = stepNumber + 1` → `= stepNumber`, rebuilt | product | same, alone                  | `→ Progress 1/3` where `2/3` was expected — the advance is observed |

**Two `ok: true` traps were eliminated rather than avoided.** (1) The un-`%clean`ed variant of this
exact scenario returns SUCCESS while parked at step 1 — filed as C8, and the reason the assertion
is the progress counter and not `ok`. (2) A `ScenarioSetupError` cannot be laundered into "the
server rejected this", so a future negative row using `capture:` cannot go green on a broken
capture.

**Gate for 0.5b**: `verify:claims` green with every row above landed or carrying a dated
`known_divergence`; `validate:all` green; A1's isolation proven before any A4 row merges.

**Ordering the owner named**: B (frameworks) → C (chain/restart/verdicts) → A (resource_manager,
after the joint walkthrough). A's mutating half is deliberately last because it is the only part
that can damage real state.

### CORRECTION to Probe hygiene — 26 TRACKED, not 119 usable (2026-08-09, same day)

The section below says a probe reporting "~20 prompts, 4 categories" was wrong. **That correction
was itself the wrong one, and the delegated agent caught it.** Both counts are real and measure
different populations:

- **119 `prompt.yaml` present** on the operator's disk.
- **26 TRACKED.** `server/resources/prompts/.gitignore` opens with "Ignore all user prompts except
  bundled prompts" — `*` plus a whitelist of `examples/ guidance/ codebase-setup/ workflow/`.
  `development/{tier_execute,strategicImplement}` have **0 tracked files**: absent from a CI
  checkout and from the npm tarball.

**For a corpus that runs in CI, TRACKED governs** — CI checks out tracked files only. So the
original probe was right for the question that mattered, and the "correction" replaced a true
statement about shipped prompts with a true statement about local ones. Row E2's premise is
falsified accordingly; `examples/quick_decision` was kept deliberately (tracked, script-free, one
required arg), not as a fallback to a demo fixture.

**The `.ignore` fix broke a gate, and that is my regression — not pre-existing.**
`validate:all` was 32/32 immediately before it and 30/32 after. `validate:no-methodology-vocab`
ripgreps the repo and had always used `.gitignore` as its implicit "shipped content" filter (its
own comments record this as row 0.8); the new `.ignore` widened its reach to 17 untracked
operator-local prompts. Fixed with `--no-ignore-dot` on both `rg` invocations, which honours
`.gitignore` but not `.ignore` — keeping interactive visibility and gate scope independent.
**The delegated agent reported this failure as pre-existing and not its own; it was neither.**
Verified by removing `.ignore` (gate green) and restoring it (gate red) before fixing.

| #   | Status                   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Verify                                                             |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| E5  | ✓ **CLEARED 2026-08-11** | The deleted-but-tracked plan path is gone and `validate:format` passes clean. **The blocking role moved, it did not disappear**: `validate:all` is now 33/34 on `plans:retire:check`, because `plans/adaptive-chain-runtime-p2-complexity-telemetry-2026-08-11.md` declares `status: done` while two documents still cite it — one of them this repo's own row 0.10. Same shape, same owner, same one-word fix (`done` → `reference`). Separately, that workstream's in-flight `eslint-ratchet.js` scope change currently blocks `pre-commit` for everyone |
| E6  | ☐                        | **Any gate whose scope is "shipped content" but whose mechanism is a filesystem walk has this bug latently.** `no-methodology-vocab` was only correct because `.gitignore` happened to align with "tracked". Audit the other `validate:no-*` scripts for the same implicit dependency                                                                                                                                                                                                                                                                      | each such gate enumerates via `git ls-files`, or documents why not |

### Probe hygiene — gitignore-filtered inventories (2026-08-09)

**`rg` and `fd` respect `.gitignore` by default, so they measure TRACKED files, not PRESENT
files.** A prompt-inventory probe reported "~20 prompts, 4 categories, `tier_execute` absent from
the bundled tree" and concluded the conformance suite could only see demo fixtures. Re-probed with
`fd -I`: **119 `prompt.yaml` files across 17 categories**, with
`resources/prompts/development/{tier_execute,strategicImplement}/` both present. The conclusion
drawn from the filtered probe — and passed into a subagent's brief — was false.

**Use `resource_manager` (`action: list` / `inspect`, `resource_type: prompt`) as the authoritative
resource inventory.** It is the server's own view, it is what the MCP surface actually exposes, and
it is not subject to VCS filtering. Filesystem globs are a proxy for it, and a lossy one.

**Fourth sighting of one failure shape** (see Growth capture): a probe measuring a property
ADJACENT to the intended one. Previously — grep for `import.meta.url` answered "who could bypass
the resolver" not "does anything"; `%framework` looked redundant by name; the operators.json
pattern looked operative while `parser-utils.ts:124` was. Here, "files rg can see" stood in for
"files that exist". The correction was cheap and available every time.

| #   | Status                                                  | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Verify                                                |
| --- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| E1  | ✓ **RESOLVED 2026-08-11, opposite of as written**       | The row wanted fixtures re-selected FROM the 119-prompt library; E3 measured why that is exactly wrong — those prompts are operator-local and absent from CI and the tarball. Row 0.5.11 took the correct form instead: created `examples/minimal_prompt` via `resource_manager` (zero arguments, no script tools, no `{{ref:}}`, description forbidding additions) and migrated 38 of 39 `reference_demo` uses to it. **One use deliberately remains** — the row whose claim IS argument passing needs a fixture that takes an argument; it is annotated as such in `prompt-engine-surface.yaml:37`. The `text:` trap is gone from every row that was not about arguments |
| E2  | ⚠ **PREMISE FALSIFIED**                                 | Chain fixture for Workstream C selected from the real library, not `examples/`. **DO NOT EXECUTE AS WRITTEN — E3 measures why.** The correction above is right that 119 prompts are PRESENT and wrong that they are available to CI. C1 therefore stayed on `examples/quick_decision` deliberately, and that is not a fallback to a demo fixture: it is script-free, takes one required argument, and is one of the 26 files that actually ship                                                                                                                                                                                                                            | a real chain starts, yields a `chain_id`, and resumes |
| E3  | ✓ **MEASURED AND ENFORCED 2026-08-11**                  | The finding held and is now mechanical rather than remembered. Counts re-measured: **117 present locally, 27 in the npm tarball** (`git ls-files --cached --others --exclude-standard`, verified equal to `npm pack --dry-run`). `validate-readme.js` gained `checkShippedPromptCount`, which recomputes the shipped figure and reds when the README drifts from it — that gate is what corrected the README's "120+ prompts" claim to the honest 27, reframed so the library's growth is attributed to `resource_manager` rather than the bundle                                                                                                                          |
| E4  | ✓ **FIXED by the adaptive-chain workstream 2026-08-11** | `validate-no-methodology-vocab.js` now derives its scope from `git ls-files` instead of walking the filesystem with `--glob` excludes. Its own comments record the reasoning this row asked for: `--glob` never filtered paths passed as arguments, and "the git-tracked set" IS the definition the walk was approximating. Verified 2026-08-11 — the gate passes and no longer reads operator-local prompts                                                                                                                                                                                                                                                               |

## Claim-coverage inventory (2026-08-09 — the "test everything it claims" sweep)

Enumerated from the machine-readable surfaces, not from reading prose. Corpus grew 14 → **37
scenarios** across three files in this pass.

| Claim surface                                 | Advertised           | Covered              | Row for the gap          |
| --------------------------------------------- | -------------------- | -------------------- | ------------------------ |
| Symbolic delimiters (`-->`, `==>`, `::`)      | 3                    | 3                    | —                        |
| Reserved operators (`+`, `?`)                 | 2                    | 2                    | 0.5.6 (`?` diverges)     |
| Modifiers (`%clean %lean %judge %framework`)  | 4 + stacking/unknown | 6                    | 0.5.7                    |
| `@framework` ids                              | 8                    | 2 + unknown-rejects  | 0.5.14                   |
| Gate presets (`:fast :full :extended`)        | 3                    | 3                    | —                        |
| Named arguments (`key:"value"`)               | 1                    | 1                    | —                        |
| `system_control` actions                      | **11** (not 10)      | 10 + unknown-rejects | 0.5.9 (doc miscount)     |
| `resource_manager` resource_types             | 4                    | 3 + unknown-rejects  | checkpoint via 0.5.10    |
| `resource_manager` actions                    | 14                   | 1 (`list`)           | 0.5.10                   |
| MCP `resources/list`                          | 1                    | 1                    | 0.5.8 (individual reads) |
| Chain resume / `gate_verdict` / `gate_action` | 4                    | 0                    | 0.5.13                   |
| Tool surface (3 tools present)                | 3                    | 3                    | —                        |

**What genuinely needs OWNER-MANUAL verification, and why** — everything above is scriptable
because the LLM is the client and a script plays that role. Three things are not:

| Not automatable here                    | Why                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Per-client install (Tiers 4–6)          | install-time behavior lives in the client, not this repo — already an owner gate                        |
| Delegation actually reaching a subagent | `==>` is asserted to parse and dispatch; whether a real subagent runs is the host's behavior            |
| Framework/gate output QUALITY           | "did CAGEERF improve the answer" is a judge question; the plan reserves token-bearing evaluation for 3b |

The distinction worth keeping: this suite proves the server **does what it says**, not that what it
says is **worth saying**. Only the second needs tokens, and it stays out of CI.

## Growth capture (chain Phase 4c)

- **Pattern, 3rd sighting → log to `~/.claude/observations.jsonl`**: "verify the defect SITE, not
  just the defect." Sighting 1 (2026-08-08): plan asserted `paths.ts` ignored `MCP_WORKSPACE`; it
  honored it. Sighting 2 (2026-08-09): plan asserted bypassing writers; there were none — the
  defect was singleton config precedence. Sighting 3 (2026-08-09): 1.4 asserted a missing export
  profile; the emitter already existed. **Common shape: a grep for a token that CO-OCCURS with the
  property, read as a measurement of the property.** The correction is cheap and was available
  every time — run the thing and look at what it produced.
- **New pattern — a ratchet cannot see growth inside an existing violation.** Recorded above.
  Worth promoting if it recurs: the per-file `npx eslint <path>` before/after diff is the probe.
- Memory update queued: the packaged-defect memory
  (`project_mcp_workspace_packaged_defect.md`) says "npm build writes state/logs package-relative,
  ignoring MCP_WORKSPACE". That is now measured false as a description of observable behavior and
  should be rewritten to the singleton-precedence diagnosis, or it will re-seed the same wrong
  premise into the next plan.

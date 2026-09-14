---
title: "Config contract consolidation — one owner for the shape of config.json"
date: 2026-09-11
status: active
tags: [config, schema, validation, cli, contracts]
---

# Config Contract Consolidation — One Owner For The Shape Of `config.json`

**Status**: ACTIVE — T0 rows 0.1–0.4 ✓ 2026-09-11, gate passed; 0.5 open (found executing 0.4). T1 next
**Owner**: minipuft
**Created**: 2026-09-11

## Why this exists

`config.json` has four authorities on its shape and no test that any two agree.

| Authority                                              | Governs                       | Checked against |
| ------------------------------------------------------ | ----------------------------- | --------------- |
| `server/config.schema.json` (577L, draft-07)           | editor hints + one CI check   | nothing         |
| `Config` + `DEFAULT_*` (`shared/types/core-config.ts`) | the shape the runtime reads   | nothing         |
| `validateConfigInput` (440L switch, 57 keys)           | what `cpm config set` accepts | nothing         |
| `adoptInertSpellings` + `validateAndSetDefaults`       | silent renames + defaulting   | nothing         |

**Root cause: there is no type for the on-disk shape.** `loadConfig` does
`JSON.parse(content) as Config` — an unchecked cast of the _file_ to the _resolved runtime_ type.
The two genuinely differ (`maxVersions`→`max_versions`, flat `frameworks.*Frequency/*Target`→
nested `injection.*`, `advanced.sessions`→`chainSessions`, `gates.directory`→`definitionsDirectory`).
Because no type expresses the file shape, the JSON Schema had to be hand-written, and nothing can
check it against anything. Every symptom below is that one fact leaking.

### Measured symptoms (2026-09-11, all probed with controls)

| #   | Symptom                                                                                                                                                                                                                                | Probe                                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Schema strictness is root-only: `additionalProperties:false` at root, unset in all subsections (**authored 26, measured 27** on 2026-09-11 — the plan undercounted by one; the count is now asserted by the gate rather than restated) | `gates.enabld`, `server.prot`, `resources.logs.maxEntrys`, `verification.isolation.tmeout` → all VALID; root `gatez` + `server.port:"nine"` → REJECTED                                             |
| S2  | Nothing validates at runtime — only `scripts/validate-config-schema.ts`, only against the repo's own file. A config at `MCP_CONFIG_PATH` is unchecked                                                                                  | `rg validateConfigAgainstSchema` → 1 script, 0 runtime callers                                                                                                                                     |
| S3  | CLI ↔ schema disagree on 23 of 75 keys (5 CLI-only, 18 schema-only)                                                                                                                                                                    | key-set diff; `frameworks.systemPromptTarget`, `gates.evaluation.defaultMode`, `versioning.maxVersions` → `Unknown configuration key` from `cpm config set`, all three present in the shipped file |
| S4  | `versioning` is spelled inversely on the two surfaces — schema camelCase, CLI snake_case, runtime snake_case, shim folds camel→snake                                                                                                   | `versioning.max_versions` ACCEPTED / `versioning.maxVersions` REFUSED by the CLI                                                                                                                   |
| S5  | `GET /health` reports `version: "1.0.0"`; package is `4.0.1`                                                                                                                                                                           | resolved `getServerConfig()` → `{"version":"1.0.0","port":9090}` — port from file, version from `DEFAULT_CONFIG`                                                                                   |
| S6  | 2 CLI-settable keys have zero readers: `gates.enforcePendingVerdict`, `resources.prompts.defaultRegistration`                                                                                                                          | `rg` → only the CLI's own allowlist + switch                                                                                                                                                       |
| S7  | Shipped file contradicts shipped schema: `logging.level:"debug"` vs schema default `info`; ships in `package.json` `files`                                                                                                             | read both                                                                                                                                                                                          |
| S8  | Shipped file carries inert `gates.mode:"on"` beside `gates.enabled:true` — undeclared, deleted at load, passes CI only because of S1                                                                                                   | schema key diff + `adoptInertSpellings`                                                                                                                                                            |
| S9  | `$id` is a non-fetchable GitHub path; `$schema` is relative, so it breaks under `MCP_CONFIG_PATH`/`MCP_WORKSPACE`; dialect is draft-07                                                                                                 | read both                                                                                                                                                                                          |

**Non-finding, kept so it is not re-derived:** `versioning.maxVersions`/`autoVersion` in the shipped
file are NOT dead — `adoptInertSpellings` folds them to snake_case before defaulting. Probed: a file
with `maxVersions: 7` resolves to `max_versions: 7`. The shim is load-bearing; do not delete it as
part of a cleanup.

**Correction to the first appraisal:** `unevaluatedProperties: false` is a no-op here. AJV 8.20 under
draft-07 with `strict: false` compiles and ignores it — probed `{a:{typo:1}}` still ACCEPTED. Per-section
`additionalProperties: false` is the working equivalent (this schema has no `allOf`/`$ref` composition).

## Intent Declaration

**Work Type**: refactor (with 2 embedded bug fixes: S5, S6)
**Confidence**: high for T0–T3, medium for T4, low for T5 (needs a ruling)
**Scope**: `server/config.schema.json`, `server/config.json`, `src/infra/config/`,
`src/cli-shared/config-input-validator.ts`, `src/shared/types/core-config.ts`,
`src/mcp/tools/system-control/handlers/config-action-handler.ts`. Risk: low through T3 —
no key shapes change. T5 is a major-version change.
**Problem Statement**: Four authorities, no agreement test, silent defaulting on typos →
one generated authority, strictness that fires, and a warning the operator sees.

## Existing Systems Audit

**Reuse before creation.** Nothing new gets built that these already do.

| Existing                                                                  | Reused how                                                                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `validateConfigAgainstSchema` (94L)                                       | Already returns `{valid, errors[]}` with AJV instance paths + an mtime-keyed compile cache. T1 is a caller, not a rewrite |
| `warnAnalysisSectionDeprecated` + `warnedAnalysisDeprecated`              | The warn-once-per-process pattern T1 must copy — hot reload re-enters `loadConfig`                                        |
| module-level `logger` (`createLogger(getDefaultLoggerConfig())`, line 15) | No chicken-and-egg: a logger exists before config loads. T1 needs no new wiring                                           |
| `system_control config validate` action                                   | The existing operator-facing surface for config health. T1's schema result lands here, not in a new action                |
| `scripts/validate-config-schema.ts`                                       | Already in `run-validation-suite.js:178`. Gains no new wiring; its strictness improves via T0                             |
| `adoptInertSpellings` table                                               | Already the migration mechanism. T2 adds entries; it does not build a second one                                          |

**New files**: one (`config-file-schema.ts`, T4) — justified inline at its row.

## Consequence Tracing

| Change                                   | READS                                                                                  | WRITES                                                                    | DECIDES                                        | VIEW/PROJECTION                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| per-section `additionalProperties:false` | `validate-config-schema.ts`; T1's runtime call                                         | hand edits; `cpm config set`; `system_control config set`                 | CI pass/fail; T1's warning                     | —                                               |
| schema validation at load                | `ConfigLoader.loadConfig`                                                              | —                                                                         | warning emission only — must NOT gate startup  | stderr (STDIO-safe); `config validate` response |
| `server.version` (S5)                    | `mcp/http/api.ts:144` (`/health`), `runtime/application.ts:386`, `config-utils.ts:405` | `DEFAULT_CONFIG.server`; `cpm config set server.version`                  | `config-utils` marks config invalid when falsy | HTTP `/health` JSON body                        |
| removing 2 zero-reader CLI keys (S6)     | none                                                                                   | `config-operations.ts:430,437`; `config-input-validator.ts:55,38,154,161` | —                                              | `cpm config list` output                        |

`/health`'s `version` field is a consumer-observable HTTP response value. It is not named in
CLAUDE.md §Public API Contract (which lists MCP tool surface, CLI surface, resource formats,
hook contract, symbolic command language). Treated as out-of-contract here — see OQ-2.

## Implementation Table

Status vocabulary: `☐ (as of <date> · flips when <observation>)` · `✓ <date> · <receipt>` · `⊘ (verified <date> · <reason>)` · `✗ KILLED (<date> · <reason> · revives if <observation>)`.
Row ids compile to node ids (`0.1` → `t0-1`); `Depends` holds row ids within the tier.

### T0 — Make the gate that exists actually fire

| #   | Status                                                                                                                                                                              | File                                | Change | Depends  | Task                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | ✓ 2026-09-11 · `server/config.json` — `gates.mode` gone, `logging.level: info`                                                                                                      | `server/config.json`                | Edit   | —        | Delete inert `gates.mode:"on"` (S8) and ship `logging.level: "info"` (S7, R3). Must precede 0.3 or 0.3 fails CI                                                                                 |
| 0.2 | ✓ 2026-09-11 · `server/config.schema.json` — all 3 declared, each marked DEPRECATED with its OQ (DEV-T0-2)                                                                          | `server/config.schema.json`         | Extend | —        | Declare `server.version`, `gates.enforcePendingVerdict`, `resources.prompts.defaultRegistration` — the CLI-writable keys that would otherwise fail 0.3 (S3). Provisional; T2 decides their fate |
| 0.3 | ✓ 2026-09-11 · `server/config.schema.json` — 27/27 strict                                                                                                                           | `server/config.schema.json`         | Extend | 0.1, 0.2 | Per-section `additionalProperties:false` (S1). NOT `unevaluatedProperties` — proven no-op under draft-07/AJV 8.20                                                                               |
| 0.4 | ✓ 2026-09-11 · `server/scripts/validate-config-schema.ts` 8/8 · `package.json` self-test script · `scripts/run-validation-suite.js` converse flipped + `reads` corrected (DEV-T0-3) | `scripts/validate-config-schema.ts` | Extend | 0.3      | Self-test with a positive control. Without it 0.3 is an unverified claim                                                                                                                        |

| 0.5 | ☐ (as of 2026-09-11 · flips when a typecheck gate reads `scripts/` and a deliberate type error there fails it) | `tsconfig.json` / `package.json` | Extend | 0.4 | **Found executing 0.4 (notes GAP-1).** `tsconfig.json` is `include: ["src/**/*"]` and `tsconfig.test.json` adds only `tests/**/*`, so NOTHING typechecks `scripts/` — 58 validation scripts CI depends on. `tsx` transpiles without checking, so a green script proves nothing about its types. 0.4 was verified with a substituted tsconfig; that substitution is the workaround, not the fix |

### T1 — Warn at load, keep serving

| #   | Status                                                                                                                         | File                                | Change | Depends | Task                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1 | ☐ (as of 2026-09-11 · flips when `loadConfig` emits a named warning for a nested typo and still returns a config)              | `src/infra/config/index.ts`         | Extend | T0      | Call `validateConfigAgainstSchema` after parse, **before** `validateAndSetDefaults` — defaulting erases the absent/wrong distinction. `logger.warn` per error path; warn-once via a field mirroring `warnedAnalysisDeprecated` (hot reload re-enters `loadConfig`) |
| 1.2 | ☐ (as of 2026-09-11 · flips when the loader exposes the last validation result without re-validating)                          | `src/infra/config/index.ts`         | Extend | 1.1     | Store the result on the loader so 1.3 projects it rather than re-running AJV                                                                                                                                                                                       |
| 1.3 | ☐ (as of 2026-09-11 · flips when `system_control config validate` returns schema errors alongside the existing per-key result) | `handlers/config-action-handler.ts` | Extend | 1.2     | The action already exists; this is what makes the warning survive startup scrollback (R4)                                                                                                                                                                          |
| 1.4 | ☐ (as of 2026-09-11 · flips when a test asserts one warning for a misspelled-key config and zero for a clean one)              | `tests/unit/config/`                | Create | 1.1     | Positive control is the clean-config case — without it the test cannot show the probe fires                                                                                                                                                                        |

### T2 — Reconcile the CLI against the schema (23 keys)

| #   | Status                                                                                                                                   | File                                                | Change | Depends       | Task                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | ☐ (as of 2026-09-11 · flips when `cpm config set` accepts every `frameworks.*` and `gates.evaluation.*` key present in the shipped file) | `src/cli-shared/config-input-validator.ts`          | Extend | T1            | Add the 18 schema keys the CLI refuses (S3)                                                                                                                                                     |
| 2.2 | ☐ (as of 2026-09-11 · flips when both `versioning` spellings set the same value and camelCase is what gets written)                      | `config-input-validator.ts`, `adoptInertSpellings`  | Edit   | 2.1           | camelCase canonical (R5); snake_case stays accepted via the existing shim (S4)                                                                                                                  |
| 2.3 | ☐ (as of 2026-09-11 · flips when neither key appears in the CLI allowlist or switch)                                                     | `config-input-validator.ts`, `config-operations.ts` | Delete | 2.1           | Remove `gates.enforcePendingVerdict` + `resources.prompts.defaultRegistration` — zero readers (S6). Same class the shim header records as already retired for ten subsystems. See OQ-3          |
| 2.4 | ☐ (as of 2026-09-11 · flips when a gate fails when a key exists on one surface and not the other)                                        | `scripts/`                                          | Extend | 2.1, 2.2, 2.3 | Agreement gate: CLI key set ≡ schema leaf key set, minus a declared exception list with reasons. Two-direction, like `validate:domain-ownership`. Without it T2 re-drifts on the next key added |

### T3 — Make the schema reachable (independent of T0–T2; may run in parallel)

| #   | Status                                                                                                           | File                        | Change | Depends | Task                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------- | --------------------------- | ------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | ☐ (as of 2026-09-11 · flips when the `$id` URL returns the schema)                                               | `server/config.schema.json` | Edit   | —       | `$id` → a fetchable raw URL; nothing resolves the current GitHub path (S9)                                                         |
| 3.2 | ☐ (as of 2026-09-11 · flips when a config loaded from `MCP_CONFIG_PATH` outside the server root still validates) | `server/config.json`        | Edit   | 3.1     | `$schema` → the absolute `$id`. The relative fallback in the validator stays for offline use                                       |
| 3.3 | ☐ (as of 2026-09-11 · flips when a `docs/` page owns `config.json` and states the precedence chain)              | `docs/`                     | Create | 3.1     | No page owns it today — 10 guides mention it, none documents it. Precedence (defaults → file → `LOG_LEVEL`/`PORT`) is undocumented |

### T4 — One generated authority (R6: TS-first)

| #   | Status                                                                                                                  | File                                | Change     | Depends | Task                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1 | ☐ (as of 2026-09-11 · flips when `ConfigFile` exists and describes the on-disk shape, not the resolved one)             | `src/shared/types/config-file.ts`   | **Create** | T2      | **The only new file.** `ConfigFile` = on-disk shape, distinct from `Config` = resolved runtime shape. Cannot extend `Config`: they describe different objects, and conflating them is the root cause. Also carries the schema's non-TS constraints (`minimum`, enum descriptions, defaults) as JSDoc the generator reads |
| 4.2 | ☐ (as of 2026-09-11 · flips when no `as Config` cast remains in `loadConfig`)                                           | `src/infra/config/index.ts`         | Edit       | 4.1     | `JSON.parse(...) as Config` → `normalize(parsed: ConfigFile): Config`, a typed function. The unchecked cast is what let all four authorities drift                                                                                                                                                                       |
| 4.3 | ☐ (as of 2026-09-11 · flips when `config.schema.json` regenerates byte-identical and a hand edit fails the drift check) | generator script                    | Create     | 4.1     | Emit the schema from `ConfigFile` via `ts-json-schema-generator` (R6). `validate:config-schema` becomes a drift check like `validate:contracts`                                                                                                                                                                          |
| 4.4 | ☐ (as of 2026-09-11 · flips when the CLI key list is generated and T2.4's exception list is empty or deleted)           | `config-input-validator.ts`         | Edit       | 4.3     | Generate the allowlist from the same source, retiring the hand-maintained switch                                                                                                                                                                                                                                         |
| 4.5 | ☐ (as of 2026-09-11 · flips when `config.json` carries a `version` and the shim can branch on it)                       | `config.json`, `config.schema.json` | Extend     | 4.1     | Add `version`. This is what makes `adoptInertSpellings` retirable — today its condition ("one full major cycle") has no way to detect a file's era                                                                                                                                                                       |

### T5 — Deferred to the next major (`config.json` is in the Public API Contract)

| #   | Item                                                                                      | Why deferred                                        |
| --- | ----------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 5.1 | Flatten-fix `frameworks.*Frequency/*Target` → nested `injection.{...}.{frequency,target}` | Key reshape = breaking. Needs 4.5's `version` first |
| 5.2 | `advanced.sessions` → a name that says `chainSessions`                                    | same                                                |
| 5.3 | Delete `adoptInertSpellings` + the `analysis` section                                     | Its own stated retirement condition                 |
| 5.4 | Split packaged default from user config (generated on first run)                          | Changes install-time behavior — see OQ-4            |

## Rulings (defaulted — flip any of these and I'll re-cut the table)

| #   | Ruling                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Warn-then-serve, not fail-fast (operator ruling, 2026-09-11)                                                                                                                                                                                                                                                                                                                                   |
| R2  | Per-section `additionalProperties:false` under draft-07; NO dialect bump. `unevaluatedProperties` is a proven no-op here and 2020-12 buys nothing this schema uses                                                                                                                                                                                                                             |
| R3  | `logging.level` ships as `info` (row 0.1). Devs use `LOG_LEVEL=debug` — the env var is already read at `index.ts:358`, so no new override mechanism is needed                                                                                                                                                                                                                                  |
| R4  | The schema warning surfaces in BOTH stderr and `system_control config validate` — a startup warning scrolls away under STDIO                                                                                                                                                                                                                                                                   |
| R5  | `versioning` canonical spelling is camelCase; snake_case stays accepted via the existing shim                                                                                                                                                                                                                                                                                                  |
| R6  | T4 SSOT is the TS `ConfigFile` type; `config.schema.json` becomes generated from it via `ts-json-schema-generator` (operator ruling, 2026-09-11). Chosen over schema-first because T4.2's `ConfigFile → Config` normalizer is the change that fixes the root cause, and having both its input and output types compiler-checked is what makes that mapping verifiable rather than another cast |

## Open Questions

| #    | Question                                                                              | Default if unanswered                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-1 | ~~Generation direction for T4~~                                                       | ✓ RESOLVED 2026-09-11 → R6: TS `ConfigFile` → generated schema                                                                                                                        |
| OQ-2 | ~~`server.version` (S5)~~                                                             | ✓ RULED 2026-09-11 to its default → notes R7: read from `package.json`, drop from the config surface. Implemented in T2; T0 declares it so the two surfaces stay consistent meanwhile |
| OQ-3 | ~~The 2 zero-reader CLI keys (S6)~~                                                   | ✓ RULED 2026-09-11 to its default → notes R8: delete, in T2.3. Same interim reasoning as OQ-2                                                                                         |
| OQ-4 | Does T5 get scheduled against a specific major, or declared permanently out of scope? | Left unscheduled; T4.5's `version` key is what makes scheduling it possible later                                                                                                     |

## Completion Criteria

| Tier | Criterion                                                             | Validation                                                                                                                                                                                                                             |
| ---- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T0   | ✓ PASSED 2026-09-11 — a nested typo fails CI; the shipped file passes | Self-test 8/8, falsified twice (strip one section → reported it; swap all 27 for `unevaluatedProperties` → reported all 27). `typecheck` 0 · `lint:ratchet` 0 · `typecheck:tests:ratchet` 0 · `validate:all` 58/58 · `test:all` exit 0 |
| T1   | A nested typo loads, serves, and emits exactly one named warning      | `tests/unit/config/` (1.4) with a clean-config positive control                                                                                                                                                                        |
| T1   | `system_control config validate` reports schema errors                | drive the action; observe the response                                                                                                                                                                                                 |
| T2   | CLI key set ≡ schema leaf key set modulo a declared exception list    | new agreement gate (2.4) + its self-test                                                                                                                                                                                               |
| T3   | `$schema` resolves from a config outside the server root              | load a config from `MCP_CONFIG_PATH` in a temp dir; observe validation still runs                                                                                                                                                      |
| T4   | `config.schema.json` regenerates byte-identical from `ConfigFile`     | drift check, same shape as `validate:contracts`                                                                                                                                                                                        |
| all  | Repo gates                                                            | `npm run typecheck && lint:ratchet && typecheck:tests:ratchet && test:all`, plus `validate:arch` for 4.1's new file                                                                                                                    |

## Sources & Inspiration

| Field                    | What                                                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reference implementation | `tooling/contracts/*.json` → `src/mcp/contracts/schemas/_generated/` — this repo's existing answer to "who owns a schema". R6 rules the other way for config (TS-first): a generated contract JSON has no normalizer to type-check, whereas T4.2's does |
| Reference implementation | `warnAnalysisSectionDeprecated` (`infra/config/index.ts:815`) — the warn-once-at-load shape T1.1 copies verbatim                                                                                                                                        |
| Reference implementation | `validate:contracts` / `validate:domain-ownership` — the two-direction drift-gate shape T2.4 and T4.3 copy                                                                                                                                              |
| Prior decision           | `adoptInertSpellings` header (`infra/config/index.ts:48-65`) — records the same defect class across ten subsystems and its retirement condition                                                                                                         |
| Constraint               | CLAUDE.md §Public API Contract — `config.json` is in-contract, which is what puts T5 behind a major bump                                                                                                                                                |
| Constraint               | CLAUDE.md §Validation Gates — a new step goes into `validate:all` first, which CI runs whole                                                                                                                                                            |
| Open unknowns            | OQ-1..OQ-4 above                                                                                                                                                                                                                                        |

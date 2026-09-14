---
title: "Hermetic validation routes — checks read what CI and a fresh install read"
date: 2026-09-14
status: active
tags: [ci, scripts, config, validation]
---

# Hermetic Validation Routes

**Status**: ACTIVE — planned 2026-09-14; two workers dispatch from `fix/hermetic-validation-routes`
**Owner**: minipuft
**Created**: 2026-09-14
**Predecessor**: `plans/readme-install-path-2026-09-13.md` rows 3.7, 3.8 and 3.9, superseded here.

## Now (2026-09-14)

Two workers run in parallel on their own branches cut from `fix/hermetic-validation-routes`, which is
`fix/readme-install-path` with `origin/main` (#275) merged in. The planner merges each handoff into the
initiative branch, runs the full suite and the live drives once, and opens one PR. This PR stacks on the
README install-path PR: after that PR squash-merges, the initiative branch is rebased onto `main` before
its own PR opens.

## Why this exists

The README install-path work found three places where a check or a startup path answers with the
operator's environment instead of the state CI or an installed user has:

- CI runs the CONTRIBUTING-commands and plan-row-tracking checks only when the scope is exactly `docs`.
  A documentation edit that rides with a `hooks/**` change classifies `hooks` and skips both.
- Four scripts spawn the built server spreading `process.env` outside `validate:hermetic-child-env`,
  which walks `server/tests/e2e` only. One of them, `capture-tool-schemas.mjs`, writes the committed
  `server/tests/snapshots/mcp-input-schemas.json` while inheriting `MCP_CONFIG_PATH`.
- A set `MCP_CONFIG_PATH` naming a missing file produced no error and the same catalog in the one
  indirect observation made so far (2026-09-13, through `verify:mcp`, server stderr not captured).

## Rulings (planner, 2026-09-14 — carried from the owner's instruction of 2026-09-13)

| #   | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Routing, not new checks.** Every step that exists for documentation-only changes runs on both lightweight routes (`!= 'full'`), mirroring the projection and README-charter steps. CLAUDE.md's scope table says what each route runs; `AGENTS.md` is re-rendered from it                                                                                                                                              |
| R2  | **One scrub list.** The e2e helper and every server-spawning script consume one list. A shared import is preferred; a gate failing on two differing lists is acceptable where TypeScript/ESM boundaries forbid the import, recorded with the reason. `validate:hermetic-child-env` widens to `server/scripts`                                                                                                           |
| R3  | **A set config path that cannot be used refuses startup** on STDIO and Streamable HTTP, before serving, non-zero exit, stderr only. The message names the variable or flag, the value, the resolved absolute path, what is wrong, and what is expected (a readable JSON config file, or unset it to use the packaged default at its path). Scope is every explicit config-path source: `MCP_CONFIG_PATH` and `--config` |
| R4  | **Listed under ⚠ BREAKING CHANGES**, following `[Unreleased]`'s precedent "a gate criterion that cannot be enforced now fails to load instead of auto-passing"                                                                                                                                                                                                                                                          |
| R5  | **Opus / high for both workers, not Fable.** The problems are specified; what remains open is approach (sharing a list across TS tests and `.mjs` scripts; a refusal that holds on both transports). Fable is the tier for a wrong-problem read and degrades on step-shaped briefs                                                                                                                                      |

## Dispatch

| Worker | Rows    | Tier / effort | Failure shape it guards                                                             | Branch                                   | File bound |
| ------ | ------- | ------------- | ----------------------------------------------------------------------------------- | ---------------------------------------- | ---------- |
| A      | 1.1–1.4 | opus / high   | wrong approach — one list across TS and ESM, a gate that must keep its e2e coverage | `fix/hermetic-validation-routes--env`    | ≤ 14 files |
| B      | 1.5–1.7 | opus / high   | wrong approach — startup refusal with transport parity and a breaking-change entry  | `fix/hermetic-validation-routes--config` | ≤ 14 files |

Neither worker spawns subagents. Neither pushes, opens a PR, or edits this plan; each returns the five-heading
handoff and the planner writes back.

---

## Tier 1

| #   | St                                                                                                                                                                          | Change                                                                                                                                                                                                 | Worker | Verification                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | ☐ (as of 2026-09-14 · flips when both documentation steps in `.github/workflows/ci.yml` parse with `!= 'full'` and CLAUDE.md's scope table names what the hooks route runs) | CI runs the CONTRIBUTING-commands and plan-row-tracking steps on every lightweight route; CLAUDE.md's scope table and the rendered `AGENTS.md` say so                                                  | A      | parsed step conditions; the classifier's scope for `hooks/gate-enforce.py` + `CONTRIBUTING.md`; `node scripts/sync-project-guidance.js --check`         |
| 1.2 | ☐ (as of 2026-09-14 · flips when every server spawn in `server/scripts` and the e2e helper builds its environment from one list)                                            | One scrub list, consumed by `server/tests/e2e/helpers/child-env.ts` and every server-spawning script, each keeping its deliberate overrides                                                            | A      | an enumeration of spawn sites with the list each uses                                                                                                   |
| 1.3 | ☐ (as of 2026-09-14 · flips when removing the list from `capture-tool-schemas.mjs` makes `validate:hermetic-child-env` exit 1 naming that file)                             | `validate:hermetic-child-env` covers server-spawning scripts and keeps its e2e coverage                                                                                                                | A      | the named positive control, and the gate's existing self-test                                                                                           |
| 1.4 | ☐ (as of 2026-09-14 · flips when a scrubbed capture of the tool schemas has been diffed against the committed snapshot and the result recorded here)                        | Prove whether the committed schema snapshot was captured under an operator environment                                                                                                                 | A      | a capture with `MCP_CONFIG_PATH` and `MCP_RESOURCES_PATH` exported in the calling shell, diffed against `server/tests/snapshots/mcp-input-schemas.json` |
| 1.5 | ☐ (as of 2026-09-14 · flips when STDIO and HTTP each exit non-zero on a missing `MCP_CONFIG_PATH` with the ruled message, and a valid path still boots and is honoured)     | Startup refusal for an unusable explicit config path                                                                                                                                                   | B      | a spawned server per transport through `buildServerEnv` overrides; a mutation restoring the silent fallback fails the test                              |
| 1.6 | ☐ (as of 2026-09-14 · flips when every documented mention of `MCP_CONFIG_PATH` and `--config` states the refusal)                                                           | `[Unreleased]` ⚠ BREAKING CHANGES entry; CLAUDE.md §Environment (paths), `docs/guides/custom-resources.md`, `docs/reference/mcp-tools.md`, `server/README.md`, and the `server/src/index.ts` help text | B      | an enumeration of mentions before and after                                                                                                             |
| 1.7 | ☐ (as of 2026-09-14 · flips when `MCP_RESOURCES_PATH`, `MCP_WORKSPACE` and `MCP_RUNTIME_ROOT` pointing at missing paths each have a measured behavior recorded here)        | Measure the other path variables; do not change them                                                                                                                                                   | B      | a spawned server per variable, stderr and exit captured                                                                                                 |

**Gate (PR boundary)**: inside `server/`, `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:all && npm run validate:all` green on the merged initiative branch, plus a live drive of the refusal on both transports.

## Open questions

| #    | Question                                                                                                               | Default                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| OQ-1 | If row 1.4 finds the committed snapshot differs under a scrubbed capture, does the corrected snapshot land in this PR? | **Yes.** A committed artifact encoding an operator's configuration is the defect this plan exists for |

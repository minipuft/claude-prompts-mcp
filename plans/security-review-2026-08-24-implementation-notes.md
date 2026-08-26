---
title: "Security review — implementation notes"
plan: security-review-2026-08-24.md
date: 2026-08-24
status: active
tags: [security, implementation-notes]
---

# Security Review — Implementation Notes

Created before the first tier runs, so deviations land as they happen rather than being
reconstructed at the end.

## Rulings

| ID  | Date       | Ruling                                                                                                                                                                                                                                                                                              |
| --- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | 2026-08-25 | **Posture is shared/distributed, not personal.** `server/package.json` is `private: false`, published as `claude-prompts` v4.0.1 with four fleet consumers, and LLMs hold `resource_manager` access. Owner named npm consumers and agent-authored gates as real ingestion paths.                    |
| R2  | 2026-08-25 | **The control is an allowlist, not a binary off-switch.** `shell_verify` is load-bearing — the owner describes it as "almost the hooks layer for our server". A blunt disable is the wrong shape; the operator declares which commands may run, and anything undeclared is refused.                 |
| R3  | 2026-08-25 | **Unopted-in `shell_command` refuses the gate, names the setting, and keeps serving.** Not degrade-to-advisory: a gate reporting as passed while having verified nothing is the exact defect CHANGELOG already records fixing. Not refuse-to-start: one hostile gate must not take the server down. |
| R4  | 2026-08-25 | **Elicitation is defence in depth, never the primary control.** See the analysis below — an autonomous client can answer it programmatically, which is precisely our threat.                                                                                                                        |

### R4 rationale — "can we secure it like the clients do?"

The owner asked whether this is the same class of problem clients solve, and whether their
mechanism transfers. It is the same class. The mechanism only half transfers.

MCP defines **elicitation** (`elicitation/create`, spec 2025-06-18): a server may request
user confirmation through the client. That is the protocol analogue of Claude Code's
permission prompt. Three findings bound how much it can carry:

1. It is a **client capability** — clients MUST declare `elicitation`. OpenCode, one of
   this repository's four fleet consumers, has it as an open feature request, so it cannot
   present one today.
2. Docker's MCP governance documentation states the limit directly: it is _"a confirmation
   guardrail for human-driven clients … **an autonomous MCP client can respond to an
   in-protocol elicitation programmatically**"_. Our threat is indirect injection steering
   an agent. That agent can approve its own elicitation. The control is blind to exactly
   the attack it would be deployed against.
3. A client that cannot elicit must fail closed, not fall through.

**Why the client's model is stronger, and what actually transfers.** Claude Code can
enforce a prompt because it _is_ the trust boundary and owns the UI — a human is
definitionally present. A server has no user; it can only ask the client to ask. But the
client's model is not the prompt: `permissions.allow` is an **allowlist evaluated before
any prompt**, and the prompt is only the fallback for what the allowlist does not cover.
The allowlist half is the half a server can own alone, because it is authored by the
operator in config rather than arriving inside content. That is R2.

Layering, strongest first:

| Layer                        | Enforced by            | Covers                        | Fails against                                      |
| ---------------------------- | ---------------------- | ----------------------------- | -------------------------------------------------- |
| Command allowlist            | this server, alone     | every client, every transport | an operator who allowlists something broad         |
| Refusal + named setting (R3) | this server, alone     | every client                  | nothing — it is the floor                          |
| Elicitation                  | the client, if capable | human-driven clients          | autonomous clients; clients lacking the capability |
| Client hooks (PreToolUse)    | Claude Code only       | Claude Code sessions          | Codex, OpenCode, Gemini consumers                  |

## Deviations

| ID       | Tier | Authored premise                                               | Measured evidence                                                                                                                                                                                                                                                             |
| -------- | ---- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-T1-1 | 1.1  | `gate-schema.ts` at `src/engine/gates/gate-schema.ts`          | Path is `src/engine/gates/core/gate-schema.ts`. Line numbers (359, 116, 120, 122) were all exact — only the directory drifted                                                                                                                                                 |
| DEV-T1-2 | 1.1  | C3 anchored at `infra/config/index.ts:188`                     | `:188` is `DEFAULT_RESOURCES_CONFIG.gates.enabled` (do gate _resources_ load). The gate _system_ default is `DEFAULT_GATES_CONFIG.enabled` at `:170`. Both `true`, so C3 stands; the citation was wrong                                                                       |
| DEV-T1-3 | 1.1  | C4: `shell_env` is author-controlled, framed as leakage        | Refined. `buildSafeEnvironment` filters the _parent_ env through `SAFE_ENV_ALLOWLIST` before every spawn, so outbound leakage is already handled. The author's `shell_env` is merged last, unfiltered — that is _injection_, and it survives the allowlist. Raised as row 1.6 |
| DEV-T1-4 | 1.2  | "place a gate, run a prompt" implies the gate must be selected | Stronger than authored: the gate ran **without being named** and with **no `gate_verdict`**. Placing the file is the whole exploit                                                                                                                                            |
| DEV-T1-5 | 1.4  | Script tools need "the same treatment" as `shell_verify`       | They do not. The script path passes an argv **array**, never reaching `sh -c`, and already refuses unless `confirm: false`. The repo held the right control on the weaker sink and none on the stronger one                                                                   |
| DEV-T1-6 | 1.2  | —                                                              | **Probe harness defect, self-inflicted.** A stray `config.json` left in `MCP_WORKSPACE` from an earlier arm was auto-discovered by the server and hung every subsequent `tools/call`. Three "results" recorded before this was caught were vacuous — see the ledger           |

## Findings ledger

Format is defined in the plan. `SUSPECTED` never reports as `CONFIRMED`.

| ID  | Class                  | Status             | Summary                                                                                                                                                                                                                                                                             |
| --- | ---------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Elevation of privilege | CONFIRMED          | `shell_verify` runs an author string via `sh -c` (`process.ts:381`)                                                                                                                                                                                                                 |
| C2  | Elevation of privilege | CONFIRMED          | Gate with no `activation` is always active; warning only (`gate-schema.ts:359`)                                                                                                                                                                                                     |
| C3  | Configuration          | CONFIRMED          | Gate system on by default (`infra/config/index.ts:188`)                                                                                                                                                                                                                             |
| C4  | Elevation of privilege | CONFIRMED          | `shell_command` unconstrained; `shell_working_dir`/`shell_env` author-controlled                                                                                                                                                                                                    |
| C5  | Documentation          | CLOSED             | `CLAUDE.md:247` claimed the server does not execute shell commands; it does. Rewritten 2026-08-25 to state the capability and name its control                                                                                                                                      |
| C6  | Configuration          | CONFIRMED          | 5 of 25 shipped gates carry no `activation` block, so "always active" is the shipped norm for 20% — a hostile gate omitting it looks ordinary                                                                                                                                       |
| C7  | Elevation of privilege | CLOSED             | `shell_verify` had no allowlist and the operator had no dial. Closed 2026-08-25 by `MCP_SHELL_VERIFY_ALLOWLIST`, enforced in `shell-verify-executor.ts` at the single point both authoring channels converge                                                                        |
| C8  | Configuration          | CONFIRMED          | `script-definition-loader.ts:475` fell back to `confirm ?? false` while the constant it reads documents "secure by default" and the schema declares `.default(true)`. Dead today, one edit from live. Fixed 2026-08-25                                                              |
| C9  | Tampering              | CONFIRMED → CLOSED | Prompt `category` reached `path.join` with no format rule while prompt `id` had carried an allowlist regex since it was written. The asymmetry is the defect: per-field validation protects the fields someone remembered                                                           |
| C10 | Tampering              | CONFIRMED → CLOSED | Gate `id` had no format rule at all; a traversing id wrote outside the root AND reported "Registered in the gate registry — ready to use now"                                                                                                                                       |
| S3  | Information disclosure | SUSPECTED          | The prompt write receipt prints `Resource root:` from configuration rather than from the actual write target — pre-fix it named the real root while writing to `/tmp`. Closed 2026-08-25: `resource_root` IS the value containment guards, so the claim is now guaranteed (row 2.6) |
| S4  | Injection              | SUSPECTED          | Chain step-output re-render. Direct argument SSTI is REFUTED (`{{ 7*7 }}` renders literally), and captured step output takes the same context-value path, settled 2026-08-25 (row 2.5)                                                                                              |
| S2  | Configuration          | SUSPECTED          | `gates.enabled=false` may only narrow the advertised `inputSchema` rather than stop execution: the master switch short-circuits `GateService.getGuidanceText`, but `20-gate-review-stage.ts:168` loads gate definitions directly. Unprobed — row 1.5                                |
| S1  | Tampering              | CONFIRMED → CLOSED | Path traversal — reproduced 2026-08-25 on TWO vectors (prompt `category`, gate `id`), both arbitrary file write as the server user with the tool reporting success. Closed by `shared/utils/path-containment.ts` asserted at every resource write site                              |

## Validation ledger

| Date       | Tier | Command                                                                  | Result                                                                                       |
| ---------- | ---- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 2026-08-24 | —    | plan authored; no probes run yet                                         | —                                                                                            |
| 2026-08-25 | 1.2  | live STDIO probe, gate with no `activation`, benign marker               | **marker written** — arbitrary execution from a dropped file, gate unnamed, no verdict       |
| 2026-08-25 | 1.2  | three arms with `MCP_CONFIG_PATH` set                                    | **VACUOUS** — server hung; stray workspace `config.json`. Discarded, not recorded as results |
| 2026-08-25 | 1.3  | 3-arm re-drive (none / exact / unrelated), each asserted `calls=2`       | refused / executed / refused — the dial works and is not a blanket unlock                    |
| 2026-08-25 | 1.3  | channel-2 arms (`:: verify`), incl. `echo *` vs `echo hi > file`         | refused / refused / executed — metacharacter rule holds                                      |
| 2026-08-25 | 1.3  | `jest tests/unit/gates/shell-command-allowlist.test.ts`                  | 25/25 pass                                                                                   |
| 2026-08-25 | 1.x  | `npm run typecheck` · `typecheck:tests:ratchet`                          | pass · 367 errors, no regressions                                                            |
| 2026-08-25 | 2.1  | live probe: prompt `category` + gate `id` traversal, benign files        | **both wrote outside the resource root**; tool reported success both times                   |
| 2026-08-25 | 2.1  | same two probes after the fix, plus a legitimate-create positive control | both refused, escape dir empty, all 3 calls answered; legitimate creates unaffected          |
| 2026-08-25 | 2.2  | argument value `{{ 7*7 }}` through a live prompt render                  | rendered literally — direct-path SSTI refuted                                                |
| 2026-08-25 | 2.4  | grep for checksum/integrity/signature/approve/trusted/fingerprint        | zero hits in `modules/resources/`, `modules/prompts/`                                        |
| 2026-08-25 | 2.x  | `npm run test:ci`                                                        | 213 suites, 2762 passed                                                                      |
| 2026-08-25 | 2.x  | `npm run validate:all`                                                   | 48/48 after fixing an import-order ratchet regression my scripted edit introduced            |
| 2026-08-25 | 1.x  | `npm run validate:all`                                                   | 45/48 → after fixes: lint:ratchet OK, knip-ratchet OK, plan-row-tracking OK                  |

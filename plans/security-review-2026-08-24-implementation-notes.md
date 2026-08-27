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

| ID  | Date       | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | 2026-08-25 | **Posture is shared/distributed, not personal.** `server/package.json` is `private: false`, published as `claude-prompts` v4.0.1 with four fleet consumers, and LLMs hold `resource_manager` access. Owner named npm consumers and agent-authored gates as real ingestion paths.                                                                                                                                                                                                                |
| R2  | 2026-08-25 | **The control is an allowlist, not a binary off-switch.** `shell_verify` is load-bearing — the owner describes it as "almost the hooks layer for our server". A blunt disable is the wrong shape; the operator declares which commands may run, and anything undeclared is refused.                                                                                                                                                                                                             |
| R3  | 2026-08-25 | **Unopted-in `shell_command` refuses the gate, names the setting, and keeps serving.** Not degrade-to-advisory: a gate reporting as passed while having verified nothing is the exact defect CHANGELOG already records fixing. Not refuse-to-start: one hostile gate must not take the server down.                                                                                                                                                                                             |
| R5  | 2026-08-25 | **Instruction-surface poisoning is accepted and documented, not fixed.** A prompt is instruction by definition; sanitising prompt text into inertness would not be this product. `cleanup-standards.md`'s dial test does not apply — there is no behaviour anyone would choose between. What was owed was the STATEMENT, now in `CLAUDE.md` §Instruction surface. Bounded by two facts: the HTTP route serving the same fields is credential-gated, and Tier 1 closed the chain's terminal step |
| R4  | 2026-08-25 | **Elicitation is defence in depth, never the primary control.** See the analysis below — an autonomous client can answer it programmatically, which is precisely our threat.                                                                                                                                                                                                                                                                                                                    |

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

| ID       | Tier | Authored premise                                                 | Measured evidence                                                                                                                                                                                                                                                                                                                                                                      |
| -------- | ---- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-T1-1 | 1.1  | `gate-schema.ts` at `src/engine/gates/gate-schema.ts`            | Path is `src/engine/gates/core/gate-schema.ts`. Line numbers (359, 116, 120, 122) were all exact — only the directory drifted                                                                                                                                                                                                                                                          |
| DEV-T1-2 | 1.1  | C3 anchored at `infra/config/index.ts:188`                       | `:188` is `DEFAULT_RESOURCES_CONFIG.gates.enabled`. The gate _system_ default is `DEFAULT_GATES_CONFIG.enabled` at `:170`. Both `true`, so C3 stands; the citation was wrong                                                                                                                                                                                                           |
| DEV-T1-3 | 1.1  | C4: `shell_env` is author-controlled, framed as leakage          | Refined. `buildSafeEnvironment` filters the _parent_ env, so outbound leakage is handled. The author's `shell_env` merges last, unfiltered — that is _injection_, and it survives the allowlist. Row 1.6                                                                                                                                                                               |
| DEV-T1-4 | 1.2  | "place a gate, run a prompt" implies the gate must be selected   | Stronger than authored: the gate ran **without being named** and with **no `gate_verdict`**. Placing the file is the whole exploit                                                                                                                                                                                                                                                     |
| DEV-T1-5 | 1.4  | Script tools need "the same treatment" as `shell_verify`         | They do not. The script path passes an argv **array**, never reaching `sh -c`, and already refuses unless `confirm: false`. The repo held the right control on the weaker sink and none on the stronger one                                                                                                                                                                            |
| DEV-T1-6 | 1.2  | —                                                                | **Probe harness defect, self-inflicted.** A stray `config.json` left in `MCP_WORKSPACE` was auto-discovered and hung every subsequent `tools/call`. Three "results" recorded before this was caught were vacuous                                                                                                                                                                       |
| DEV-T1-7 | 1.3  | A per-command allowlist is sufficient                            | Incomplete. 21 existing executor tests failed because they exercise process mechanics with metacharacter-heavy commands, surfacing the real gap: an operator who accepts the risk had no way to say so, and a dial with no accept position gets routed around. Added `UNSAFE_ALLOW_ALL`                                                                                                |
| DEV-T1-8 | 1.x  | `validate:all` is the gate that catches regressions              | It does not run the unit suite. All 48 steps passed while 21 tests were failing; only `npm run test:ci` caught it                                                                                                                                                                                                                                                                      |
| DEV-T2-1 | 2.1  | S1 authored as "grep found no guard"                             | Half wrong, and the wrong half mattered. Prompt `id` HAS a guard; my discovery grep searched for the _shape of guard I expected_ (`../`, `normalize`) rather than for whatever constrains the id                                                                                                                                                                                       |
| DEV-T2-2 | 2.1  | One traversal vector ("resource ids")                            | Two, and the id was not one of them. The unguarded fields were prompt `category` and gate `id`                                                                                                                                                                                                                                                                                         |
| DEV-T2-3 | 2.1  | Fix = tighten the id/category rules                              | Rejected as the sole fix. Per-field rules enumerate known vectors; a containment assertion on the RESOLVED path holds for vectors nobody enumerated. Both shipped, assertion as the guarantee                                                                                                                                                                                          |
| DEV-T2-4 | 2.1  | `getFrameworkDir` is the single framework chokepoint             | Nearly. `framework-lifecycle-processor.ts` rebuilds the path itself, so guarding only the helper would have left the delete open                                                                                                                                                                                                                                                       |
| DEV-T3-1 | 3.2  | —                                                                | **Truncation produced a clean false negative.** The first line-jumping pass capped probe output at 3k across 40 prompts and reported no marker anywhere. At 400k it appeared in three of four surfaces                                                                                                                                                                                 |
| DEV-T3-2 | 3.x  | The escalation chain ends in RCE                                 | No longer. Tier 1's allowlist closed the terminal step, so it ends in a gate that refuses. Re-graded on PAYOFF, not reachability                                                                                                                                                                                                                                                       |
| DEV-T3-3 | 3.4  | Pointing readers at `inspect` is sufficient                      | Wrong, caught only by driving it. A bare `inspect` returns metadata; bodies sit behind `detail:"full"`. The first pointer would have sent every reader to a call that does not answer them                                                                                                                                                                                             |
| DEV-T3-4 | 3.5  | `title` is token waste, so drop it                               | Re-framed against the SDK's own example (`registerPrompt('review-code', { title: 'Code Review' })`). The field is the human display label and this repo already authors those names — misuse, not size                                                                                                                                                                                 |
| DEV-T4-1 | 4.2  | The plan carried `state.db` scope as "known, already documented" | Re-measuring falsified the documentation in the PESSIMISTIC direction — it claimed wider exposure than exists. A carried-in "already known" item is an inventory like any other                                                                                                                                                                                                        |
| DEV-T4-2 | 4.1  | Secret leakage is plausible and needs a fix                      | Refuted. `SAFE_ENV_ALLOWLIST` is default-deny, so the server's own credentials are excluded by construction rather than by any rule naming them — which is why a test now pins them                                                                                                                                                                                                    |
| DEV-T4-3 | 4.x  | Anchored string edits to this file are reliable                  | **They are not, and this file lost content because of it.** Prettier reformats markdown table padding, so fixed-spacing anchors silently stopped matching and `str.replace` no-opped without error. Tier 2/3/4 findings were reported as recorded while the file was unchanged. Caught by `git status` showing no diff. Every edit here now asserts, or rewrites the section wholesale |
| DEV-T5-1 | 5.1  | Tier 5 produces "the prompt AND the skill"                       | Only the prompt. `/security` already exists with `security.md` as its rule; a second artifact over the same domain is the parallel-system shape this repo's standards forbid. The capability-dial material extended the existing rule instead                                                                                                                                          |
| DEV-T5-2 | 5.2  | "second sighting reached" is the promotion bar                   | Only for extending an existing domain rule. CLAUDE.md's bar for promotion is THREE independent sightings — the positive-control pattern clears it (4, two from prior sessions); the capability-dial one does not, and is recorded as a second-sighting extension rather than dressed up as a promotion                                                                                 |

## Findings ledger

Format is defined in the plan. `SUSPECTED` never reports as `CONFIRMED`.

| ID  | Class                  | Status                    | Summary                                                                                                                                                                       |
| --- | ---------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Elevation of privilege | CONFIRMED                 | `shell_verify` runs an author string via `sh -c` (`process.ts:381`)                                                                                                           |
| C2  | Elevation of privilege | CONFIRMED                 | Gate with no `activation` is always active; warning only (`core/gate-schema.ts:359`)                                                                                          |
| C3  | Configuration          | CONFIRMED                 | Gate system on by default (`infra/config/index.ts:170`)                                                                                                                       |
| C4  | Elevation of privilege | CONFIRMED                 | `shell_command` unconstrained; `shell_working_dir`/`shell_env` author-controlled                                                                                              |
| C5  | Documentation          | CLOSED                    | `CLAUDE.md:247` claimed the server does not execute shell commands; it does. Rewritten 2026-08-25                                                                             |
| C6  | Configuration          | CONFIRMED                 | 5 of 25 shipped gates carry no `activation` block, so "always active" is the shipped norm for 20%                                                                             |
| C7  | Elevation of privilege | CLOSED                    | `shell_verify` had no allowlist and the operator had no dial. Closed by `MCP_SHELL_VERIFY_ALLOWLIST` at the single point both authoring channels converge                     |
| C8  | Configuration          | CLOSED                    | `script-definition-loader.ts` fell back to `confirm ?? false` against a constant documenting "secure by default". Dead today, one edit from live. Fixed                       |
| C9  | Tampering              | CONFIRMED → CLOSED        | Prompt `category` reached `path.join` with no format rule while prompt `id` had one. The asymmetry is the defect                                                              |
| C10 | Tampering              | CONFIRMED → CLOSED        | Gate `id` had no format rule at all; a traversing id wrote outside the root AND registered in the gate registry                                                               |
| C11 | Tool poisoning         | CONFIRMED (accepted)      | 4 prompt fields reach the client LLM unreviewed and unattributed; a workspace-authored prompt is indistinguishable from a bundled one                                         |
| C12 | Line jumping           | CONFIRMED → partly closed | MCP `prompts/list` carries every `description` at connect (accepted). `list detail:"full"` returned every `systemMessage` — closed by 3.4                                     |
| C13 | Line jumping           | CONFIRMED → CLOSED        | `list detail:"full"` returned 139,824 bytes of instruction bodies, ~83% of the response. Removed; `inspect detail:"full"` still serves them                                   |
| C14 | Correctness            | CONFIRMED → CLOSED        | `registry.ts` registered `title: prompt.id`, byte-identical to the name for 34/34. The SDK documents `title` as the human display label — misuse, not merely duplication      |
| C15 | Information disclosure | REFUTED                   | No secret leakage across tool responses, STDIO logger, 95KB log file, `state.db`, or any workspace file — 3 markers incl. `MCP_CATALOG_READ_TOKEN`, positive-control verified |
| C16 | Documentation          | CONFIRMED → CLOSED        | `CLAUDE.md` claimed `kv_state` was the only `workspace_id` writer and that rollback history is machine-global. Both false. Corrected, superseded claim kept visible           |
| C17 | Configuration          | CONFIRMED                 | `workspace_id` is indexed, written by 4 tables, and read by ZERO queries — writers without readers, the case `sqlite-persistence.md` forbids. Row 4.3                         |
| S1  | Tampering              | CONFIRMED → CLOSED        | Path traversal — two vectors reproduced, both arbitrary file write with the tool reporting success. Closed by `shared/utils/path-containment.ts`                              |
| S2  | Configuration          | SUSPECTED                 | `gates.enabled=false` may only narrow the advertised `inputSchema` rather than stop execution. Unprobed — row 1.5                                                             |
| S3  | Information disclosure | REFUTED                   | Write receipt named a root it did not verify. `resource_root` IS the value containment guards, so the claim is now guaranteed (row 2.6)                                       |
| S4  | Injection              | REFUTED                   | Chain step-output re-render. Values reach Nunjucks as data on both the argument and chain paths; pinned by `template-value-is-data.test.ts` (row 2.5)                         |

## Validation ledger

| Date       | Tier | Command                                                                              | Result                                                                                       |
| ---------- | ---- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 2026-08-24 | —    | plan authored; no probes run yet                                                     | —                                                                                            |
| 2026-08-25 | 1.2  | live STDIO probe, gate with no `activation`, benign marker                           | **marker written** — arbitrary execution from a dropped file, gate unnamed, no verdict       |
| 2026-08-25 | 1.2  | three arms with `MCP_CONFIG_PATH` set                                                | **VACUOUS** — server hung; stray workspace `config.json`. Discarded, not recorded as results |
| 2026-08-25 | 1.3  | 3-arm re-drive (none / exact / unrelated), each asserted `calls=2`                   | refused / executed / refused — the dial works and is not a blanket unlock                    |
| 2026-08-25 | 1.3  | channel-2 arms (`:: verify`), incl. `echo *` vs `echo hi > file`                     | refused / refused / executed — metacharacter rule holds                                      |
| 2026-08-25 | 1.3  | `jest tests/unit/gates/shell-command-allowlist.test.ts`                              | 25/25 pass                                                                                   |
| 2026-08-25 | 2.1  | live probe: prompt `category` + gate `id` traversal, benign files                    | **both wrote outside the resource root**; tool reported success both times                   |
| 2026-08-25 | 2.1  | same two probes after the fix, plus a legitimate-create positive control             | both refused, escape dir empty, all 3 calls answered; legitimate creates unaffected          |
| 2026-08-25 | 2.2  | argument value `{{ 7*7 }}` through a live prompt render                              | rendered literally — direct-path SSTI refuted                                                |
| 2026-08-25 | 2.3  | 6 raw-block cases (nested, unclosed, whitespace-control) + positive control          | all pass — containment holds and is not a blanket refusal                                    |
| 2026-08-25 | 2.4  | grep for checksum/integrity/signature/approve/trusted/fingerprint                    | zero hits in `modules/resources/`, `modules/prompts/`                                        |
| 2026-08-25 | 2.5  | `template-value-is-data.test.ts` incl. constructor SSTI payload                      | values never evaluated; template-authored `{{ 7*7 }}` still yields 49                        |
| 2026-08-25 | 3.2  | 4 discovery surfaces read with markers, output cap raised to 400k                    | 3 of 4 carry prompt text with no invocation; `detail:"full"` carried `systemMessage`         |
| 2026-08-25 | 3.4  | live drive of `list detail:"full"` after the change                                  | 0 body blocks, 37 pointers; catalogue ~167KB → 27.7KB                                        |
| 2026-08-25 | 3.4  | mutation check: re-added the `systemMessage` emission                                | 1 test failed, reverted clean — the assertion is load-bearing                                |
| 2026-08-25 | 3.5  | live drive of `prompts/list`                                                         | title==name for 0/34; titles now human-readable                                              |
| 2026-08-25 | 4.1  | 3 marker secrets, 4 calls (2 error paths), 5 sinks scanned                           | 0 hits; positive control finds `test_default` + bogus id in the log                          |
| 2026-08-25 | 4.2  | grep every `workspace_id` write and every query filtering on it                      | 4 writers, 0 readers; `version_history` isolates on `tenant_id` instead                      |
| 2026-08-25 | —    | `npm run typecheck` · `typecheck:tests:ratchet`                                      | pass · 367 errors, no regressions (ratchet caught +2 that `typecheck` cannot see)            |
| 2026-08-25 | —    | `npm run test:ci`                                                                    | 215 suites, 2782 passed                                                                      |
| 2026-08-25 | —    | `npm run validate:all`                                                               | 48/48                                                                                        |
| 2026-08-25 | 5.1  | `resource_manager create` + `inspect` of `>>security_review` against the live server | created, `refresh_status: loaded`, resolves                                                  |
| 2026-08-25 | 5.2  | `~/.claude/scripts/check-rules.sh`                                                   | 15 files passed size, 0 failures; `dev-workflow.md` condensed back under its soft limit      |
| 2026-08-25 | 5.2  | `git commit` in `~/.claude` staging ONLY the two rule files                          | `f0f567c`; the other session's 15 modified / 10 deleted files left untouched                 |

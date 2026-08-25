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

| ID  | Tier | Authored premise | Measured evidence |
| --- | ---- | ---------------- | ----------------- |
| —   | —    | —                | —                 |

## Findings ledger

Format is defined in the plan. `SUSPECTED` never reports as `CONFIRMED`.

| ID  | Class                  | Status    | Summary                                                                                                                                       |
| --- | ---------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Elevation of privilege | CONFIRMED | `shell_verify` runs an author string via `sh -c` (`process.ts:381`)                                                                           |
| C2  | Elevation of privilege | CONFIRMED | Gate with no `activation` is always active; warning only (`gate-schema.ts:359`)                                                               |
| C3  | Configuration          | CONFIRMED | Gate system on by default (`infra/config/index.ts:188`)                                                                                       |
| C4  | Elevation of privilege | CONFIRMED | `shell_command` unconstrained; `shell_working_dir`/`shell_env` author-controlled                                                              |
| C5  | Documentation          | CONFIRMED | `CLAUDE.md:247` claims the server does not execute shell commands; it does                                                                    |
| C6  | Configuration          | CONFIRMED | 5 of 25 shipped gates carry no `activation` block, so "always active" is the shipped norm for 20% — a hostile gate omitting it looks ordinary |
| S1  | Tampering              | SUSPECTED | Path traversal on resource ids — grep found no guard, unprobed (Tier 2.1)                                                                     |

## Validation ledger

| Date       | Tier | Command                          | Result |
| ---------- | ---- | -------------------------------- | ------ |
| 2026-08-24 | —    | plan authored; no probes run yet | —      |

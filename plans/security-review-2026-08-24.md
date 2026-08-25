---
title: "Security review: trust boundaries, resource ingestion, and execution capability"
date: 2026-08-24
status: active
tags: [security, threat-model, gates, resources, transport]
---

# Security Review: Trust Boundaries, Resource Ingestion, and Execution Capability

## Why this exists

An HTTP transport review on 2026-08-24 (`97bc5598`) found four unauthenticated mutation
routes beside one carefully token-gated read route, and a server binding every interface
while its own startup log printed `http://localhost:PORT`. Neither was visible by reading
the file. Both appeared the moment the server was started and the requests were issued.

That review then surfaced something the transport fix does not touch: **the sharpest
surface in this repository is not transport-specific at all.** `shell_verify` gates route
an author-supplied string through `sh -c`, and that path is identical over STDIO and
HTTP. Hardening the listener did nothing to it.

This review exists to answer one question the codebase currently answers only by
accident: **what is allowed to become code here, and who is allowed to author it?**

## The governing decision (blocks everything else)

**Deployment posture determines what counts as a vulnerability.** The same behaviour is a
feature or a critical finding depending on this answer, so it is settled first and every
finding below is graded against it.

| Posture                                                                                                                      | Who authors resources           | `shell_verify` reads as                             |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------- |
| **Personal** — operator authors their own prompts and gates                                                                  | the operator                    | a feature; ground-truth verification they asked for |
| **Shared / distributed** — resources may arrive from a pack, a cloned repo, skills-sync, or an LLM acting on content it read | anyone upstream of the operator | arbitrary code execution                            |

`cleanup-standards.md` §Parity Gates Are Debt is the test for whether a capability gate is
warranted rather than deferred debt: _"Would anyone ever legitimately CHOOSE the old
behaviour?"_ Here, yes — a personal user genuinely wants shell verification. So a
capability dial is the correct shape, and it must state the evidence that flips it.

**Open ruling OQ-1**: default posture. Recommendation is **fail closed** (execution
capability off unless opted in), because the failure is asymmetric: a personal user who
wants it hits one clear error and sets one variable, while a user who never knew it
existed silently runs someone else's code.

## Trust boundary map

The boundary is not the transport. It is **where content becomes instruction or code**.

```
  authored elsewhere                 ingested                    becomes
  ─────────────────────              ────────                    ───────
  prompt / gate / framework  ──▶  resources/**  overlay  ──▶  instruction to client LLM
  pack, cloned repo,              (workspace beats               ▲
  skills-sync source              bundled)                       │  tool poisoning
                                       │                          │  rug pull
                                       ▼                          │
                                 gate evaluation  ──────────▶  sh -c   ← CODE
                                       │
                                 script tools    ──────────▶  python3 / bash   ← CODE

  LLM with resource_manager ──▶ creates/updates the same resources ──▶ same two sinks
```

Two sinks turn content into code, and both are reachable from either transport. The MCP
client spawning the server (STDIO) or reaching it over a port (HTTP) changes _who can
knock_, not _what executes_.

## Threat model

STRIDE for the classical surfaces, plus the MCP-specific classes the general model does
not name. Sources reviewed 2026-08-24: OWASP Threat Modeling Process (use/abuse cases,
qualitative risk questions), Snyk MCP security, HackTricks AI-MCP-Servers, and the
ecosystem papers it cites.

| Class                               | Shape in this repository                                                                                                                                                                                                          | Status                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Tool poisoning**                  | A prompt's `systemMessage`/`userMessageTemplate` IS instruction to the client LLM. A poisoned prompt is the direct analogue of a poisoned tool description, and `GET /api/v1/catalog/prompts/:id` now serves exactly those fields | ☐ not assessed                                    |
| **Rug pull**                        | Resources hot-reload and carry version history. A prompt approved once can change afterwards with no re-approval and no name change                                                                                               | ☐ not assessed                                    |
| **Line jumping**                    | Injection that lands at listing time, before any invocation — `resource_manager` discovery output and prompt descriptions                                                                                                         | ☐ not assessed                                    |
| **Indirect injection → second bug** | The documented escalation path: attacker content steers the agent into `resource_manager`, which writes a gate, which reaches `sh -c`. This is the concrete chain, not a hypothetical                                             | ☐ not assessed                                    |
| **Elevation of privilege**          | `shell_verify` → `sh -c`; script tools → `python3`/`bash`                                                                                                                                                                         | ✓ **confirmed reachable** (below)                 |
| **Tampering**                       | Path traversal on resource ids into file writes                                                                                                                                                                                   | ☐ suspected, unverified                           |
| **Information disclosure**          | `state.db` shared across projects; four tables declare scope columns no writer populates, so their rows are global                                                                                                                | ✓ known, already documented in CLAUDE.md          |
| **Information disclosure**          | Secrets in logs — fixed for HTTP request headers, never audited for the STDIO logger or script env                                                                                                                                | ☐ partially closed                                |
| **Spoofing / Repudiation**          | Deferred: no multi-user identity model exists, so neither has meaning until posture is settled                                                                                                                                    | ✗ out of scope, revisit if posture becomes shared |

### Qualitative risk questions (OWASP)

Applied to every finding, because they separate "real" from "interesting":

1. Can it be exploited without local file access?
2. Can it be automated?
3. Does it require the operator to do something they would plausibly do anyway?

The `shell_verify` chain answers **no / yes / yes** — file placement is required, but
installing a prompt pack is exactly the plausible act.

## Confirmed before this plan (carried in, evidence attached)

| #   | Finding                                                                                                                   | Evidence                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| C1  | `shell_verify` executes an author-supplied string through a shell                                                         | `process.ts:381` returns `['sh', ['-c', command]]` for a string command |
| C2  | A gate with no `activation` block is **always active** — and that is a warning, not an error                              | `gate-schema.ts:359-360`                                                |
| C3  | The gate system is **on by default**                                                                                      | `infra/config/index.ts:188` — `gates: { enabled: true }`                |
| C4  | `shell_command` has no allowlist, sandbox, or confirmation; `shell_working_dir` and `shell_env` are author-controlled too | `gate-schema.ts:116` — `z.string().optional()`                          |
| C5  | **CLAUDE.md states the opposite of the code.** `CLAUDE.md:247` says "the server does not execute shell commands". It does | reproduce C1                                                            |

C5 is the finding that compounds the others: it is the sentence a reader consults when
deciding how far to trust a third-party gate, and it is false.

## Execution plan

Each tier ends with findings **reproduced against a running server**, never asserted from
reading. The transport review is the precedent: both of its findings were invisible to
inspection and obvious to a probe.

### Tier 0 — Posture ruling

| #   | St  | Work                                                                    | Verify                                              |
| --- | --- | ----------------------------------------------------------------------- | --------------------------------------------------- |
| 0.1 | ☐   | Settle OQ-1 (default posture, fail-open vs fail-closed) with the owner  | Ruling recorded in implementation notes             |
| 0.2 | ☐   | Correct `CLAUDE.md:247` — the client-work boundary claim is false today | C5 no longer reproduces as a doc/code contradiction |

### Tier 1 — Execution capability

| #   | St  | Work                                                                                                     | Verify                                                                |
| --- | --- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1.1 | ☐   | Enumerate every path from authored content to process execution                                          | Each named with file:line; no `exec`/`spawn` unaccounted for          |
| 1.2 | ☐   | Prove the chain end to end: place a gate with no `activation`, run a prompt, observe the command execute | Reproduction recorded; benign marker command, never a destructive one |
| 1.3 | ☐   | Design the capability dial per the Tier 0 ruling, with its retirement condition stated                   | Opt-in respected; refusal names the setting                           |
| 1.4 | ☐   | Same treatment for script tools (`RUNTIME_COMMANDS`)                                                     | Consistent with 1.3 rather than a second unrelated gate               |

### Tier 2 — Resource ingestion

| #   | St  | Work                                                                                          | Verify                                                            |
| --- | --- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 2.1 | ☐   | Path traversal: can a resource id escape the resources root on create/update/delete/rollback? | Probe with `../` ids; assert refusal, not just absence of a crash |
| 2.2 | ☐   | Template injection: can an argument reach Nunjucks as expression rather than data?            | Probe SSTI payloads through the argument parser                   |
| 2.3 | ☐   | Script reference escape: does `{% raw %}` handling hold under nesting and unclosed blocks?    | Existing fix covers documented cases; probe the edges             |
| 2.4 | ☐   | Rug pull: can an approved resource change under the client with no signal?                    | Establish whether any integrity signal exists at all              |

### Tier 3 — Instruction surface (tool poisoning)

| #   | St  | Work                                                                           | Verify                                                               |
| --- | --- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| 3.1 | ☐   | Treat prompt content as tool metadata: what reaches the client LLM unreviewed? | Enumerate the fields; `systemMessage` is the sharpest                |
| 3.2 | ☐   | Line jumping: what lands at discovery/listing time before any invocation?      | Enumerate listing-time text                                          |
| 3.3 | ☐   | Decide what, if anything, is owed here — this may be inherent to the product   | Explicit ruling, including "accepted, documented" as a valid outcome |

### Tier 4 — Disclosure

| #   | St  | Work                                                                                   | Verify                                           |
| --- | --- | -------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 4.1 | ☐   | Audit the STDIO logger and script env for secret leakage, as was done for HTTP headers | Probe with a marker secret; grep every sink      |
| 4.2 | ☐   | Re-grade the known `state.db` cross-project scope gap against the settled posture      | Either a finding or an accepted documented limit |

### Tier 5 — Capture

| #   | St  | Work                                                                       | Verify                                                        |
| --- | --- | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 5.1 | ☐   | Build the security-review prompt and skill **from this review's material** | Derived from real findings, not from a generic checklist      |
| 5.2 | ☐   | Feed the transferable rules upstream                                       | Second sighting reached; `security.md` already took the first |

## Findings ledger format

Every finding carries these, or it is not a finding:

```
ID · title
  class:        STRIDE category or MCP class
  boundary:     which trust boundary it crosses
  posture:      does it survive the Tier 0 ruling, or is it posture-dependent?
  reproduce:    exact commands, against a running server
  status:       CONFIRMED (reproduced) | SUSPECTED (read-only evidence) | REFUTED
  risk:         the three OWASP questions, answered
```

`SUSPECTED` is a first-class state and must not be reported as though confirmed. Today's
transport review produced one such: path traversal, where grep found no guard — that is
absence of evidence, not evidence of absence, and Tier 2.1 exists to settle it.

## Non-goals

- Penetration testing anything not in this repository.
- A multi-user authorization model. Posture may make it relevant; it is not in scope here.
- Removing `shell_verify`. The capability is wanted; the question is who may author it.
- Codifying the review method before the review runs — Tier 5 is deliberately last, and
  CLAUDE.md's own promotion rule is why.

## Risks to this plan

| Risk                                                           | Mitigation                                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Probing execution paths runs real commands                     | Benign markers only (`echo`, touch a temp file); never a destructive payload; isolated workspace |
| A posture ruling that arrives late invalidates earlier grading | Tier 0 blocks; nothing is graded before it                                                       |
| Findings inflate into a generic OWASP list                     | The ledger format requires a reproduction; anything unreproduced is `SUSPECTED` and labelled     |
| Review stalls on breadth                                       | Tiers are ordered by the confirmed chain first, speculation last                                 |

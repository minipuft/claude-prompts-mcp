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

| Class                               | Shape in this repository                                                                                                                                                                                                          | Status                                                                                                                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tool poisoning**                  | A prompt's `systemMessage`/`userMessageTemplate` IS instruction to the client LLM. A poisoned prompt is the direct analogue of a poisoned tool description, and `GET /api/v1/catalog/prompts/:id` now serves exactly those fields | ✓ **confirmed, ACCEPTED** — 4 fields reach the model unreviewed; ruled inherent (Tier 3.3)                                                                                              |
| **Rug pull**                        | Resources hot-reload and carry version history. A prompt approved once can change afterwards with no re-approval and no name change                                                                                               | ✓ **confirmed** — no integrity or approval signal exists at all (Tier 2.4)                                                                                                              |
| **Line jumping**                    | Injection that lands at listing time, before any invocation — `resource_manager` discovery output and prompt descriptions                                                                                                         | ✓ **CONFIRMED; partly closed** — `prompts/list` still carries every `description` at connect (accepted, 3.3). `list detail:"full"` no longer returns instruction bodies (closed by 3.4) |
| **Indirect injection → second bug** | The documented escalation path: attacker content steers the agent into `resource_manager`, which writes a gate, which reaches `sh -c`. This is the concrete chain, not a hypothetical                                             | ⚠ **server half confirmed; payoff downgraded** — the agent-steering half is a client property, not reproducible here. Terminal step closed by Tier 1 (Tier 3)                           |
| **Elevation of privilege**          | `shell_verify` → `sh -c`; script tools → `python3`/`bash`                                                                                                                                                                         | ✓ **confirmed reachable** (below)                                                                                                                                                       |
| **Tampering**                       | Path traversal on resource ids into file writes                                                                                                                                                                                   | ✓ **CONFIRMED then CLOSED** — two vectors reproduced, containment assertion landed (Tier 2.1)                                                                                           |
| **Information disclosure**          | `state.db` shared across projects; four tables declare scope columns no writer populates, so their rows are global                                                                                                                | ✓ **re-graded (4.2): accepted limit, and the doc was WRONG** — `version_history` is workspace-scoped; the real defect is a written-but-never-read `workspace_id` (row 4.3)              |
| **Information disclosure**          | Secrets in logs — fixed for HTTP request headers, never audited for the STDIO logger or script env                                                                                                                                | ✓ **CLOSED (4.1)** — no leak across 5 sinks, positive-control verified; `SAFE_ENV_ALLOWLIST` is default-deny and the server's own credentials are now test-pinned                       |
| **Spoofing / Repudiation**          | Deferred: no multi-user identity model exists, so neither has meaning until posture is settled                                                                                                                                    | ✗ out of scope, revisit if posture becomes shared                                                                                                                                       |

### Qualitative risk questions (OWASP)

Applied to every finding, because they separate "real" from "interesting":

1. Can it be exploited without local file access?
2. Can it be automated?
3. Does it require the operator to do something they would plausibly do anyway?

The `shell_verify` chain answers **no / yes / yes** — file placement is required, but
installing a prompt pack is exactly the plausible act.

## Confirmed before this plan (carried in, evidence attached)

Every anchor below was **re-measured on 2026-08-25** before Tier 1 executed. Authored-vs-measured
is shown where they diverged; the corrections are kept visible rather than silently applied,
because the pattern of drift is the reusable part.

| #   | Finding                                                                                                                   | Evidence (re-measured 2026-08-25)                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | `shell_verify` executes an author-supplied string through a shell                                                         | ✓ exact — `process.ts:381` returns `['sh', ['-c', command]]`                                                                                                                                                                                                                               |
| C2  | A gate with no `activation` block is **always active** — and that is a warning, not an error                              | ✓ line exact, **path drifted**: authored `gate-schema.ts:359`, measured `engine/gates/core/gate-schema.ts:359-360`                                                                                                                                                                         |
| C3  | The gate system is **on by default**                                                                                      | ⚠ **wrong anchor.** `index.ts:188` is `DEFAULT_RESOURCES_CONFIG.gates.enabled` (whether gate _resources load_). The gate _system_ default is `DEFAULT_GATES_CONFIG.enabled` at **`index.ts:170`**. Both are `true`, so the finding stands and only the citation was wrong                  |
| C4  | `shell_command` has no allowlist, sandbox, or confirmation; `shell_working_dir` and `shell_env` are author-controlled too | ✓ lines exact (`core/gate-schema.ts:116`, `:120`, `:122`). Refined: `buildSafeEnvironment` filters the _parent_ env, so this is author _injection_, not credential _leakage_ — see 1.6                                                                                                     |
| C5  | **CLAUDE.md states the opposite of the code.** `CLAUDE.md:247` says "the server does not execute shell commands". It does | ✓ exact, still present at `CLAUDE.md:247`                                                                                                                                                                                                                                                  |
| C6  | 5 of 25 shipped gates carry no `activation` block                                                                         | ✓ exact — **but only when the property is measured correctly.** A first probe counted all 27 gate YAML files and reported 7; two of those (`config/shell-presets.yaml`, `config/verdict-patterns.yaml`) are configuration, not gate definitions. Counting `gate.yaml` files gives 25 and 5 |
| C7  | `shell_verify` had **no allowlist, and the operator had no dial at all**                                                  | ✓ closed by 1.3 — `MCP_SHELL_VERIFY_ALLOWLIST`, enforced at `shell-verify-executor.ts`                                                                                                                                                                                                     |

C5 is the finding that compounds the others: it is the sentence a reader consults when
deciding how far to trust a third-party gate, and it is false.

**C6's drift is the reusable lesson, not its number.** The authored count was right and the
first re-measurement was wrong, because the probe measured _files matching `*.yaml` under
`resources/gates`_ while the claim was about _gate definitions_. A probe for a token that merely
co-occurs with the property answers a different question — and here it would have manufactured
a false correction to a correct plan.

## Where this work lives (read first after a compaction)

|                           |                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Worktree                  | `/home/minipuft/Applications/claude-prompts-mcp-security` — created via `npm run worktree:create`, hooks verified live |
| Branch                    | `security/review-execution`, based on the plan commit                                                                  |
| Main checkout             | `/home/minipuft/Applications/claude-prompts-mcp`, parked on `main` and clean — do not work there                       |
| This plan, as a PR        | #246 (plan only; the review itself is not in it)                                                                       |
| Related open PRs          | #245 transport hardening (breaking), #247 worktree session guidance                                                    |
| Rulings + findings ledger | `plans/security-review-2026-08-24-implementation-notes.md` — R1–R4, C1–C6, S1                                          |
| Tier 0                    | closed. **Tier 1.1 is the next action**: enumerate every content-to-execution path with file:line                      |

Probes run against a server started from this worktree, in an isolated
`MCP_WORKSPACE`, with benign marker commands only — never a destructive payload. Set a
non-default `PORT`: the main checkout may be running one.

## Execution plan

Each tier ends with findings **reproduced against a running server**, never asserted from
reading. The transport review is the precedent: both of its findings were invisible to
inspection and obvious to a probe.

### Tier 0 — Posture ruling

| #   | St                  | Work                                                                    | Verify                                                                                                                                                                                                                          |
| --- | ------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | ✓ DONE (2026-08-25) | Settle OQ-1 (default posture) with the owner                            | R1–R4 recorded in implementation notes: posture is **shared/distributed**; control is an **allowlist, not an off-switch**; unopted-in `shell_command` refuses that gate and keeps serving; elicitation is defence in depth only |
| 0.2 | ✓ DONE (2026-08-25) | Correct `CLAUDE.md:247` — the client-work boundary claim is false today | Rewritten to state that the server DOES execute shell commands and to name the control that bounds them. C5 no longer reproduces as a doc/code contradiction                                                                    |

### Tier 1 — Execution capability

| #   | St                                                   | Work                                                                                                                               | Verify                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | ✓ DONE (2026-08-25)                                  | Enumerate every path from authored content to process execution                                                                    | `spawn` occurs **exactly once** in `src/` (`shared/utils/process.ts:422`). Full map below; every `exec` hit is `RegExp.exec` or `sqlite.exec`, neither of which spawns a process                                                         |
| 1.2 | ✓ DONE (2026-08-25)                                  | Prove the chain end to end: place a gate with no `activation`, run a prompt, observe the command execute                           | Reproduced against a live server, benign marker only. **The gate was never named in the request and no verdict was submitted** — see the reproduction block below                                                                        |
| 1.3 | ✓ DONE (2026-08-25)                                  | Design the capability dial per the Tier 0 ruling, with its retirement condition stated                                             | Allowlist landed at the single convergence point; 3-arm probe + 25 unit tests. Refusal names `MCP_SHELL_VERIFY_ALLOWLIST`; `UNSAFE_ALLOW_ALL` is the explicit accept-the-risk position. Retirement condition stated in the module header |
| 1.4 | ✓ DONE (2026-08-25)                                  | Same treatment for script tools (`RUNTIME_COMMANDS`)                                                                               | **No second gate was needed**: the script path never reaches `sh -c` and is already fail-closed on `confirm`. One latent fail-open fallback removed instead — see the asymmetry note                                                     |
| 1.5 | ☐ (as of 2026-08-25 · flips when this row is probed) | (as of 2026-08-25 · flips when a probe drives a chain with `gates.enabled=false` and observes whether `shell_command` still runs)  | Settle whether the gate master switch actually stops execution, or only hides the three gate parameters from the advertised `inputSchema`                                                                                                |
| 1.6 | ☐ (as of 2026-08-25 · flips when this row is probed) | (as of 2026-08-25 · flips when `shell_working_dir`/`shell_env` are either constrained or explicitly accepted as author-controlled) | The allowlist bounds the command string only. An allowlisted command can still be pointed at any directory and handed any environment by the same author                                                                                 |
| 1.7 | ☐ (as of 2026-08-25 · flips when this row is probed) | (as of 2026-08-25 · flips when the unknown-extension branch either refuses or is documented as intended)                           | `EXTENSION_TO_RUNTIME` falls back to the `shell` runtime for any unrecognised extension (`script-executor.ts:330`), so an unknown file type is handed to `bash`                                                                          |

#### 1.1 — the execution map (measured 2026-08-25)

One sink, two authoring channels, and they converge before it:

```
  gate.yaml pass_criteria[].shell_command   ─┐
  (any file the resources overlay reads)     │
                                             ├─▶ ShellVerifyExecutor.execute
  inline  :: verify:"..."  in the command   ─┘   (shell-verify-executor.ts:65)
  (parsed at symbolic-operator-parser.ts:330)             │
                                                          ▼
                                              executeProcess (process.ts:342)
                                                          │
                                              resolveCommand (process.ts:379)
                                                          │
                                        string ──▶ ['sh', ['-c', command]]   ◀── C1
                                                          │
                                                    spawn (process.ts:422)
                                                          ▲
  script tool: [interpreter, scriptPath] ─────────────────┘
  (script-executor.ts:154 — argv ARRAY, so it never takes the `sh -c` branch)
```

| Path                          | Reaches the sink via                                                   | Constraint before this tier                         |
| ----------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| Gate `shell_command`          | `gate-shell-verify-runner.ts:138` ← `20-gate-review-stage.ts:168`      | none beyond "non-empty"                             |
| Inline `:: verify:"..."`      | `17-shell-verification-stage.ts:96`                                    | none beyond "non-empty"                             |
| Gate `script_tool` criterion  | `script-tool-criterion-runner.ts:102`                                  | **already refuses unless `confirm: false`** (`:92`) |
| Script tool (inline/pipeline) | `08-script-execution-stage.ts:264`, `prompt-reference-resolver.ts:319` | `confirm` + interpreter fixed by `RUNTIME_COMMANDS` |

`buildSafeEnvironment` (`process.ts:169`) filters the **parent** environment through
`SAFE_ENV_ALLOWLIST` before every spawn, so credentials do not leak outward by default.
It does not constrain the author's own `shell_env`/`tool.env`, which is merged last and
unfiltered — that is row 1.6, not a leak.

#### 1.2 — the reproduction

```bash
# isolated workspace, benign marker only
mkdir -p /tmp/mcp-security-probe/gates/probe-always-active
cat > /tmp/mcp-security-probe/gates/probe-always-active/gate.yaml <<'YAML'
id: probe-always-active
type: validation
pass_criteria:
  - type: shell_verify
    shell_command: "id -un > /tmp/mcp-security-probe/MARKER_EXECUTED.txt; echo ok"
YAML
# no activation: block; the gate is NOT named in either call
MCP_WORKSPACE=/tmp/mcp-security-probe node server/dist/index.js --transport=stdio
#   call 1: prompt_engine  command=">>deep_analysis"  inputs={topic:"probe"}
#   call 2: prompt_engine  chain_id="chain-deep_analysis#1"  user_response="scan complete"
cat /tmp/mcp-security-probe/MARKER_EXECUTED.txt   # -> minipuft
```

What this establishes beyond C1–C4, and what makes it worse than the plan assumed:

- the gate ran **without being named** in the request — placing the file is sufficient;
- it ran on a plain chain advance, with **no `gate_verdict` submitted** and no confirmation;
- `resource_manager … action:"list"` reported it as one of 26 gates, all enabled, with **no
  warning that it carries no `activation`** — the validator's warning (C2) never reaches a caller.

After 1.3, the same two calls leave the marker uncreated. Three arms, each confirmed
non-vacuous by asserting both calls returned (`calls=2`) rather than trusting the absent file:

| Arm                                           | Marker   |
| --------------------------------------------- | -------- |
| no `MCP_SHELL_VERIFY_ALLOWLIST`               | refused  |
| the exact command allowlisted                 | executed |
| an unrelated command allowlisted (`npm test`) | refused  |

Channel 2 (`:: verify:"echo hi > …"`) behaves identically, and a `echo *` prefix entry does
**not** admit it, because the `>` forces an exact match.

#### 1.4 — the asymmetry, which is the actual finding

The script-tool path is **not** a second instance of the same hole:

- it passes an argv **array** (`[interpreter, scriptPath]`), so `resolveCommand` never takes
  the `sh -c` branch — no shell metacharacter interpretation at all;
- the interpreter is chosen from the fixed `RUNTIME_COMMANDS` map, which is itself an allowlist;
- the gate-side entry point already **refuses** unless the tool declares `confirm: false`,
  with a message naming why (`script-tool-criterion-runner.ts:92`).

So the repository already contained the control shape R2/R3 describe — applied to the _weaker_
sink and absent from the _stronger_ one. The only change owed here was removing a latent
fail-open: `script-definition-loader.ts:475` read `?? DEFAULT_EXECUTION_CONFIG.confirm ?? false`,
and `ExecutionConfig.confirm` is optional, so that final `?? false` contradicted both the
constant's own "secure by default" comment and the schema's `.default(true)`. It is now `?? true`.
Dead today (the constant is `true`), one edit from live.

### Tier 2 — Resource ingestion

| #   | St                  | Work                                                                                          | Verify                                                                                                                                                                                                                                                                   |
| --- | ------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2.1 | ✓ DONE (2026-08-25) | Path traversal: can a resource id escape the resources root on create/update/delete/rollback? | **S1 CONFIRMED on two vectors, both now closed.** Reproduced live with benign files; refused after the fix with the escape target empty and all three calls answered. See the reproduction below                                                                         |
| 2.2 | ✓ DONE (2026-08-25) | Template injection: can an argument reach Nunjucks as expression rather than data?            | **REFUTED.** `{{ 7*7 }}` supplied as an argument rendered literally. Pinned by `tests/unit/execution/template-value-is-data.test.ts`, including a constructor-reaching SSTI payload and a positive control proving the negatives are not vacuous                         |
| 2.3 | ✓ DONE (2026-08-25) | Script reference escape: does `{% raw %}` handling hold under nesting and unclosed blocks?    | **HOLDS.** 6 cases added to `script-reference-resolver.test.ts`: closed block, unclosed block, nested opener, closed-then-unclosed, whitespace-control spelling (`{%- raw -%}`), plus a positive control proving containment is not a blanket refusal                    |
| 2.4 | ✓ DONE (2026-08-25) | Rug pull: can an approved resource change under the client with no signal?                    | **No integrity or approval signal exists.** Zero hits for checksum/integrity/signature/approve/trusted/fingerprint across `modules/resources/` and `modules/prompts/`. The only hashing is observability — see below                                                     |
| 2.5 | ✓ DONE (2026-08-25) | Chain step-output re-render (split from 2.2)                                                  | **REFUTED by construction and by test.** `chain-operator-executor.ts:471` assigns captured output to `templateContext['previous_step_output']` — a context VALUE, never concatenated into the template string — then renders once. Same mechanism 2.2 refutes            |
| 2.6 | ✓ DONE (2026-08-25) | Write receipt reports a root it does not verify it wrote under                                | **Closed by construction, by 2.1's fix.** `resource_root` is `getResolvedPromptsDirectory()` — the exact value passed to `assertPathInside` — so the receipt's claim is now guaranteed rather than asserted. It was true-but-misleading only while escapes were possible |

#### 2.1 — the reproduction (S1, settled)

Two vectors, both arbitrary file write as the server user, reachable by any caller of
`resource_manager` — which includes an agent acting on content it merely read.

| Vector            | Guard before                                                | Result                                                                                                    |
| ----------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| prompt `id`       | `/^[a-zA-Z][a-zA-Z0-9_-]*$/` (`prompt/utils/validation.ts`) | **refused** — S1 does not hold here                                                                       |
| prompt `category` | length ≤50 only; **no format rule**                         | **wrote outside the root** and reported `✅ Prompt Created`                                               |
| gate `id`         | **none at all**                                             | **wrote outside the root**, listed the escaped paths as "Files created", and "Registered in the registry" |

```bash
# benign marker files only, isolated workspace
resource_manager resource_type:prompt action:create id:"probeWhere"   category:"../../../../../../../tmp/mcp-sec-escape/viacat" …
# -> ✅ Prompt Created … Resource root: …/server/resources/prompts
ls /tmp/mcp-sec-escape/viacat/probewhere/   # prompt.yaml  user-message.md
```

The receipt naming a root it had not written under is what makes this hard to notice from the
tool surface alone; it is row 2.6.

**The fix is a containment assertion, not another field rule.** Prompt ids were already safe
because someone had added a regex; category and gate id were unsafe because nobody had. Adding
two more regexes would protect exactly the two vectors found and leave the next path-bearing
parameter unprotected. `shared/utils/path-containment.ts` asserts the property that actually
matters — the RESOLVED path is inside the root — at each write site, so an unenumerated vector
still cannot escape. `validateCategoryName` also gained the missing format rule, for the better
error message rather than as the guarantee.

Guarded sites: `prompt/operations/file-operations.ts` (both dir constructions),
`gate-file-writer.ts`, `gate-lifecycle-processor.ts` (delete), `framework-file-writer.ts`
(`getFrameworkDir`, the single chokepoint for framework read/write/delete), and
`framework-lifecycle-processor.ts` (which rebuilds the path instead of calling that helper, so a
guard on the helper alone would have left it open).

#### 2.4 — what exists instead of an integrity signal

`resource-change-tracker.ts` computes sha256 over resource content and records
`resource_changes` with a `previousHash`. That **detects** change after the fact; it is
observability, not approval. There is no signed, pinned, or approved state for a resource, so a
prompt or gate approved once can change afterwards with no re-approval and no name change, and
nothing consulted at execution time would object.

Grading this against the posture (R1, shared/distributed) is deliberately left to Tier 3.3,
which owns the "accepted, documented" outcome — the same question shaped differently.

### Tier 3 — Instruction surface (tool poisoning)

| #   | St                  | Work                                                                           | Verify                                                                                                                                                          |
| --- | ------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | ✓ DONE (2026-08-25) | Treat prompt content as tool metadata: what reaches the client LLM unreviewed? | Four fields enumerated below. `systemMessage` is the sharpest, as authored                                                                                      |
| 3.2 | ✓ DONE (2026-08-25) | Line jumping: what lands at discovery/listing time before any invocation?      | **Three surfaces confirmed by untruncated probe.** `resource_manager list detail:"full"` returns every prompt's `systemMessage` in one call, with no invocation |
| 3.3 | ✓ DONE (2026-08-25) | Decide what, if anything, is owed here — this may be inherent to the product   | **RULED: accepted, documented.** Serving prompt text to a client LLM IS the product; what was owed is the statement, now in `CLAUDE.md` §Instruction surface    |

| 3.4 | ✓ DONE (2026-08-25) | Discovery amplification: `list detail:"full"` returned every prompt's instruction bodies | **Bodies removed from the catalogue.** Measured: 139,824 bytes (~35k tokens) no longer returned by one listing call — the response went ~167KB → 27.7KB, an 83% cut. `inspect` + `detail:"full"` still returns both. 6 unit tests, mutation-checked |
| 3.5 | ✓ DONE (2026-08-25) | `prompts/list` sent `title` byte-identical to `name` for 34/34 prompts | **`title` now carries the human name.** `registry.ts` passed `prompt.id`; the SDK's own example registers `'review-code'` with `title: 'Code Review'`, so this was a misuse of the field, not just waste. Measured after: title==name for **0/34**. 2 unit tests |

#### 3.1 — the instruction surface, measured

| Field                   | Reaches the client                                      | Reviewed by anything? |
| ----------------------- | ------------------------------------------------------- | --------------------- |
| `systemMessage`         | on invocation, and via `list detail:"full"` without one | no                    |
| `userMessageTemplate`   | on invocation                                           | no                    |
| `description`           | **at connect**, via MCP `prompts/list`                  | no                    |
| argument `description`s | **at connect**, via MCP `prompts/list`                  | no                    |

Nothing sanitises, marks, or attributes any of it. A workspace-authored prompt and a
bundled one are indistinguishable in the payload the model receives, which is what makes
this the direct analogue of a poisoned tool description.

#### 3.2 — the reproduction (line jumping)

A prompt was created carrying distinct markers in `description` and `system_message`, then
four discovery surfaces were read with **no invocation of that prompt**. Output limits were
raised to 400k first, because a 3k truncation had produced a clean-looking false negative on
the first pass:

| Surface                               | `description` | `systemMessage` |
| ------------------------------------- | ------------- | --------------- |
| `tools/list`                          | no            | no              |
| `prompts/list` (MCP standard)         | **yes**       | no              |
| `resource_manager list detail:"full"` | **yes**       | **yes**         |
| `resource_manager inspect`            | **yes**       | no              |

`prompts/list` is the one that matters most for reach: MCP clients typically fetch it at
connect, so a poisoned `description` lands in the model's context automatically, with no
user action beyond having the server configured.

#### 3.4 / 3.5 — what the catalogue owed

3.3 accepted the per-prompt instruction surface as inherent. These two are the parts that
were **not** inherent, and both were closed:

|                        | before                                                         | after                                                                          |
| ---------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `list detail:"full"`   | ~167KB, every prompt's `systemMessage` + `userMessageTemplate` | 27.7KB, metadata + a pointer                                                   |
| `prompts/list` `title` | `prompt.id` — identical to `name`, 34/34                       | `prompt.name` — `Codebase Protocol Initialization` vs `codebase_protocol_init` |

The listing cut is worth more than its byte count suggests. A `systemMessage` is not a
description: 10 of 11 shipped ones are second-person instruction, so a catalogue was
returning role assignments the model is not executing. Removing them fixes an exposure and
an ambiguity with one change.

**One correction caught in the live drive.** The first pointer read
`action:"inspect", id:"…"` — but a bare `inspect` returns metadata only; the bodies sit
behind `detail:"full"`. The pointer would have sent readers to a call that does not answer
them. Verified against a running server before and after, not from reading.

**Alternative rejected for 3.5**: dropping `title` entirely saves ~775 bytes rather than
spending +222 to carry real names. Rejected because the field is not waste, it was
_misused_ — the SDK documents it as the human display label, and this repo already authors
those names and had simply never sent them. Revisit if a token budget ever makes 222 bytes
matter more than every client losing readable prompt labels.

#### 3.3 — the ruling

**Accepted and documented, not fixed.** A prompt is instruction by definition; a server that
sanitised prompt text into inertness would not be this product. The `cleanup-standards.md`
test for a real dial does not apply — there is no behaviour here anyone would choose between.

What was actually missing was the statement. A reader deciding whether to install a
third-party prompt pack had nothing in the docs telling them the pack's `systemMessage`
becomes instruction to their model, or that a single listing call hands it over. That is now
`CLAUDE.md` §Instruction surface.

Two things bound the acceptance, and both are load-bearing:

- the HTTP route serving the same fields **is** credential-gated (`MCP_CATALOG_READ_TOKEN`,
  503 when unset, 401 on a bad token, authenticated before it looks the prompt up). The MCP
  surface is ungated by design, because the operator chose the client;
- the escalation chain's terminal step is closed as of Tier 1. A poisoned gate can still
  reach the model as text, but it can no longer reach `sh -c`.

#### Threat-model row settled: indirect injection → second bug

Tier 1.2 proved the second half (content → `sh -c`). The first half — attacker content
steering an agent into calling `resource_manager` — is a property of the CLIENT's agent, not
of this server, and is not reproducible here; claiming it either way from this repository
would be evidence about nothing.

What changed is the payoff rather than the reachability. Before Tier 1, that chain ended in
arbitrary code execution. It now ends in a gate that refuses and names the setting, so the
residual harm is instruction-surface poisoning — which is 3.1/3.2, and accepted above.

### Tier 4 — Disclosure

| #   | St                  | Work                                                                                                                          | Verify                                                                                                                                                                               |
| --- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1 | ✓ DONE (2026-08-25) | Audit the STDIO logger and script env for secret leakage, as was done for HTTP headers                                        | **No leak found**, across 5 sinks, with a positive control proving the scan works. Server's own credentials now covered by a test                                                    |
| 4.2 | ✓ DONE (2026-08-25) | Re-grade the known `state.db` cross-project scope gap against the settled posture                                             | **Accepted limit — and the documentation was wrong in the pessimistic direction.** `version_history` IS workspace-scoped; the real defect is a written-but-never-read `workspace_id` |
| 4.3 | ☐                   | (as of 2026-08-25 · flips when `workspace_id` is either read by a scoped query or dropped from the four tables that write it) | An indexed column with writers and zero readers. `sqlite-persistence.md` already states the rule — _scope reads and writes together_ — and nothing enforces it                       |

#### 4.1 — the leakage probe

Three marker secrets were placed in the server's environment, including the one credential
the server genuinely reads (`MCP_CATALOG_READ_TOKEN`), then four calls were driven — two
normal, two error paths, since error messages are a classic leak sink.

| Sink                         | `MCP_CATALOG_READ_TOKEN` | generic key | `AWS_SECRET_ACCESS_KEY` |
| ---------------------------- | ------------------------ | ----------- | ----------------------- |
| tool responses (stdout)      | 0                        | 0           | 0                       |
| STDIO logger (stderr)        | 0                        | 0           | 0                       |
| `logs/mcp-server.log` (95KB) | 0                        | 0           | 0                       |
| `runtime-state/state.db`     | 0                        | 0           | 0                       |
| any file in the workspace    | 0                        | 0           | 0                       |

**The null result is not vacuous.** The same scan finds `test_default` and the bogus prompt
id `no_such_prompt_zzz` in the log file, so it can observe what is there; and the four calls
returned real responses including both error paths.

What makes this hold is `SAFE_ENV_ALLOWLIST` (`shared/utils/process.ts`), which is
**default-deny**: a child receives only the ~30 named variables. That means the server's own
secrets are excluded by construction rather than by a rule anyone wrote about them — which is
precisely why a test now pins it. Adding an `MCP_*` entry later would look harmless and would
hand the catalog credential to every `shell_verify` command, including one authored in a
third-party gate.

Author-supplied `shell_env` / `tool.env` still merge last, unfiltered. That is injection, not
disclosure, and it remains row 1.6.

#### 4.2 — the re-grade, and a documentation correction

The gap is real but **narrower than `CLAUDE.md` described**, and the description was wrong in
both halves. Measured 2026-08-25:

| CLAUDE.md claimed                                                | Measured                                                                                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| "`kv_state` is the only table that writes `workspace_id`"        | False. `version_history:168`, `execution-record-store:143`, and `run-registry:192` all write it                                                     |
| "rollback history is shared across every project on the machine" | False. Every `version_history` query filters `tenant_id`, which `resolveContinuityScopeId` resolves to `workspaceId ?? organizationId ?? 'default'` |

The actual defect is the inverse of the documented one: `workspace_id` has **writers and no
readers** — zero queries in those three modules filter on it. An indexed column that is
written and never consulted is worse than an absent one, because the next person to add a
scoped query will reasonably assume it is authoritative. `.claude/rules/sqlite-persistence.md`
already states the violated rule (_scope reads and writes together_, and _a green
phantom-column gate proves a writer NAMES a column, not that anything consults it_), so this
is drift between the rule and the handbook summarising it, not a missing rule. Raised as 4.3.

**Graded against R1 (shared/distributed): accepted, documented limit.** The residual exposure
is a process that resolves no workspace sharing the `'default'` bucket with every other such
process. `CLAUDE.md` now says so, and keeps the superseded claim visible — a security claim
that overstates exposure gets discounted wholesale once a reader checks one instance of it.

### Tier 5 — Capture

| #   | St                                                   | Work                                                                       | Verify                                                        |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 5.1 | ☐ (as of 2026-08-25 · flips when this row is probed) | Build the security-review prompt and skill **from this review's material** | Derived from real findings, not from a generic checklist      |
| 5.2 | ☐ (as of 2026-08-25 · flips when this row is probed) | Feed the transferable rules upstream                                       | Second sighting reached; `security.md` already took the first |

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

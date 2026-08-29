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
| Tier 0                    | closed. Tiers 0–4 and 6 closed. **Rows 1.7 and 1.8 are the next actions**; 1.6 closed 2026-08-29                       |

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

| #   | St                  | Work                                                                                                              | Verify                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | ✓ DONE (2026-08-25) | Enumerate every path from authored content to process execution                                                   | `spawn` occurs **exactly once** in `src/` (`shared/utils/process.ts:422`). Full map below; every `exec` hit is `RegExp.exec` or `sqlite.exec`, neither of which spawns a process                                                                                                                                                                                     |
| 1.2 | ✓ DONE (2026-08-25) | Prove the chain end to end: place a gate with no `activation`, run a prompt, observe the command execute          | Reproduced against a live server, benign marker only. **The gate was never named in the request and no verdict was submitted** — see the reproduction block below                                                                                                                                                                                                    |
| 1.3 | ✓ DONE (2026-08-25) | Design the capability dial per the Tier 0 ruling, with its retirement condition stated                            | Allowlist landed at the single convergence point; 3-arm probe + 25 unit tests. Refusal names `MCP_SHELL_VERIFY_ALLOWLIST`; `UNSAFE_ALLOW_ALL` is the explicit accept-the-risk position. Retirement condition stated in the module header                                                                                                                             |
| 1.4 | ✓ DONE (2026-08-25) | Same treatment for script tools (`RUNTIME_COMMANDS`)                                                              | **No second gate was needed**: the script path never reaches `sh -c` and is already fail-closed on `confirm`. One latent fail-open fallback removed instead — see the asymmetry note                                                                                                                                                                                 |
| 1.5 | ✓ DONE (2026-08-27) | Settle whether the gate master switch stops execution or only hides parameters                                    | **Neither. It was inert.** Probe: gates Disabled, `status` confirming `Disabled`, marker still written. Root cause was NOT in the gate code — see C18. Fixed, re-probed, 3 arms behave                                                                                                                                                                               |
| 1.6 | ✓ DONE (2026-08-29) | Constrain `shell_working_dir` / `shell_env` per ruling R7 — and close the CLASS, not the two fields the row named | **Reproduced live, then closed on 3 arms.** Pre-fix, an operator allowlisting exactly `git status` ran the gate author's `git`. Env keys that redirect resolution are refused with no opt-out; directories are contained to operator-declared roots. New gate `validate:spawn-input-guards`, falsified on both axes. See below                                       |
| 1.7 | ✓ DONE (2026-08-29) | Refuse an unclassified extension instead of handing it to `bash`, per ruling R8                                   | **Reproduced live on 3 arms.** Pre-fix a `.rb` tool ran as bash through the real pipeline; post-fix it refuses naming the extension and the fix; declaring `runtime: shell` still runs it. Anchor drifted: authored `script-executor.ts:330`, measured `:348` (`resolveRuntime`)                                                                                     |
| 1.8 | ✓ DONE (2026-08-29) | `shell_command` becomes argv; a bare string fails to load (BREAKING, ruling R8)                                   | **Reproduced live on 3 arms.** With `echo *` allowlisted, `["echo", "ok; touch …"]` printed the semicolon and created nothing; a string `shell_command` fails at LOAD with the migration in the message; `["sh","-c",…]` under `sh *` still runs, which is both the positive control and the documented residual. ⚠ **The row's second claim was wrong** — see below |
| 1.9 | ✓ DONE (2026-08-29) | Drive the script-tool half of 1.6 live                                                                            | **Both halves reproduced.** `tool.env` setting `PATH` ran the author's `bash` pre-fix and refuses now; `tool.workingDir` escaped the tool directory pre-fix and refuses now. The row existed because 1.6 produced two vacuous greens — and this run produced a third, caught the same way                                                                            |

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

#### 1.6 — the reproduction, and the site the row did not name

**The row named two fields; the defect has a shape, and the shape had a second site.** Phase 1
enumerated by shape — _an author-supplied value reaching a spawn's env or cwd unfiltered_ — and
found script tools carry the same two holes, one of them sharper than either gate field:

| Site                | env                                                                                                          | cwd                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| gate `shell_verify` | `shell_env` merged last, unfiltered                                                                          | `shell_working_dir` passed through with no root at all                                                       |
| gate `shell_verify` | `shell_response_env_var` lets the author name the KEY too — `PATH` mirrors the agent response                | —                                                                                                            |
| script tool         | `tool.env` + `request.env` unfiltered, **and `findRuntimeCommand` probes that PATH to pick the interpreter** | `join(tool.toolDir, tool.workingDir)` — `join` resolves `..`, the exact defect 2.1 fixed for resource writes |

The reproduction is deliberately built on an operator who did everything right:

```bash
# isolated workspace, benign markers only
# MCP_SHELL_VERIFY_ALLOWLIST = 'git status' + 'touch CWD_MARKER'   (exact entries, no wildcard)
#   attacker-bin/git          -> writes /tmp/mcp-sec-16/MARKER_PATH_HONOURED.txt
#   gate probe-env-override:  shell_command "git status"
#                             shell_env PATH=/tmp/…/attacker-bin:/usr/bin:/bin
#   gate probe-cwd-escape:    shell_command "touch CWD_MARKER"
#                             shell_working_dir /tmp/…/elsewhere
# drive: >>deep_analysis, then advance the chain until gate review runs
```

| Arm                                                       | PATH marker | CWD marker  |
| --------------------------------------------------------- | ----------- | ----------- |
| pre-fix                                                   | **written** | **written** |
| post-fix, no `MCP_SHELL_VERIFY_ALLOWED_DIRS`              | refused     | refused     |
| post-fix, `MCP_SHELL_VERIFY_ALLOWED_DIRS=/tmp/mcp-sec-16` | refused     | written     |

Arm 3 is what makes arms 1–2 mean anything: the env refusal has no opt-out (R7) while the
directory refusal is a dial the operator can turn, and both behave as ruled. All five calls
answered in every arm, so the server keeps serving (R3).

**Two probe defects were found before any conclusion was drawn, and each had already produced a
clean green.** First, the fixture gates failed schema validation (`description` is required) and
never loaded — pre-fix and post-fix builds looked identical, which reads as "already safe".
Second, once that was fixed, `shell_command: "echo ok"` still showed nothing, because `echo` is a
shell BUILTIN and never consults `PATH`. A probe whose payload cannot observe the property
answers a different question; only running the pre-fix build as a positive control exposed both.

**What each field gets, and why they differ.** R7 splits by mechanism, not by how dangerous a
field sounds:

| Field               | Control                                                       | Because                                                       |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| `shell_env`         | denied keys **refused, no opt-out**                           | they decide what the allowed command MEANS                    |
| `shell_working_dir` | contained to `MCP_SHELL_VERIFY_ALLOWED_DIRS` + the server dir | only WIDENS reach; a hard block pushes operators to allow-all |

`buildSafeEnvironment` **throws** on a denied key rather than stripping it, so a sink added later
cannot reopen the class by forgetting the check. It screens `additionalEnv` (the unit of work)
and deliberately NOT `baseEnv` (the constructing operator's own configuration) — a first cut
screened both and was caught by three integration tests pinning an embedder's right to set the
PATH its own interpreters resolve on. That asymmetry now has a test of its own.

The containment check returns the RESOLVED directory and the executor spawns in exactly that
value. A first cut checked `resolve(defaultRoot, workingDir)` and passed the raw string to
`spawn`, which resolves a relative path against the SPAWNING process instead — the check and the
spawn would have measured different directories.

#### 1.6 — the gate, and a gate that was blind to itself

`validate:spawn-input-guards` requires every `src/` caller of `executeProcess` to guard both
inputs. Falsified 2026-08-29 on each axis independently.

Its approximation is per FILE, not per call — sound exactly while a file spawns once. Rather than
document that and hope someone notices the day it stops holding, **the gate fails when a file
gains a second spawn**, which turns an undetectable blind spot into a reported condition. Also
falsified: adding a second `executeProcess` call makes it report. `cleanup-standards.md` is the
reason — a stated limitation with no detector is a permanent one.

Closing this surfaced a **satisfied blind spot in a neighbouring gate**.
`validate:documented-options` matches `process.env['MCP_*']` literally, so a module reading its
variable through a named constant was invisible to it — meaning `MCP_SHELL_VERIFY_ALLOWLIST`,
shipped and enforced since 2026-08-25, had **never been checked by that gate at all**. Found only
because documenting a sibling variable in `docs/` happened to trip it. The gate now also matches
an `MCP_*` name held in a source constant, and was falsified by renaming a documented variable to
one nothing defines.

#### 1.7 — the ruling applied, and what it deliberately does not do

R8 is precise about the target: the `shell` RUNTIME builds an argv array (`bash script.sh`)
and carries the same risk posture as `python script.py`. The defect was `shell` being the
**silent default** for files nobody had classified, announced at debug level only. So the
capability stays and only the default goes.

| Arm                              | Result                                       |
| -------------------------------- | -------------------------------------------- |
| pre-fix, `runtime: auto`, `.rb`  | **ran as bash** through the live pipeline    |
| post-fix, `runtime: auto`, `.rb` | refused, message naming `.rb` and `runtime:` |
| post-fix, `runtime: shell`       | runs                                         |

Arm 3 is the one that distinguishes a refusal from a removal. Without it the first two would
hold equally against an executor that had simply dropped `shell`.

**Anchor drift**: authored `script-executor.ts:330`, measured `:348`. The row's claim was
otherwise exact.

**A discovered gap, fixed in the same pass.** The valid-runtime vocabulary was written out
FOUR times with nothing linking the copies — the `ScriptRuntime` type, the `ScriptRuntimeSchema`
zod enum, a `validRuntimes` array on the `resource_manager` create path, and implicitly in
`RUNTIME_COMMANDS`. Adding a runtime meant finding all four, and a missed one would accept a
value nothing could run. Now one `SUPPORTED_RUNTIMES` in `shared/types/automation.ts`, with the
others derived. `validate:arch` chose the placement: `shared` is the only layer all three
consumers may import a value from, and it rejected both of the first two attempts.

Also split one message that reported two different failures identically. An unknown runtime
NAME is an author error fixable by reading the list; a known runtime whose interpreter is
missing is an operator's host problem. Both said "No interpreter found", which sent the first
one to look at their PATH.

#### 1.9 — the script-tool half of 1.6, driven

Opened when 1.6 landed, because only the gate sink had been driven end to end. Closed the same
day the harness for 1.7 made it cheap:

| Arm                                               | Pre-fix                             | Post-fix |
| ------------------------------------------------- | ----------------------------------- | -------- |
| `tool.env` sets `PATH` to a directory it controls | the author's `bash` **ran**         | refused  |
| `tool.workingDir: ../../../../../elsewhere`       | **escaped**, marker written outside | refused  |

**And this run produced its own vacuous green.** The first working-directory control used six
`..` where five were needed, so the pre-fix build failed on a nonexistent directory and the
escape read as "already contained". Third such defect in this tier, each one found only by
running the pre-fix build. The pattern is stable enough to state plainly: in this codebase a
probe is not trusted until the arm that SHOULD trip it has been seen to trip.

#### 1.8 — the row's own claim, corrected

The row said argv makes "the `sh -c` branch unreachable from a gate" and that "the Tier 1
allowlist becomes an exact match rather than a prefix-plus-metacharacter check". **Both are
overstated, and the correction is the reusable part.**

| The row claimed                         | What is true                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sh -c` becomes unreachable from a gate | It does not. `shell_command: ["sh", "-c", "…"]` is expressible. What argv removes is **shell PARSING of the author's string**                                 |
| the allowlist becomes an exact match    | Only for the argv shape. The inline `:: verify:"…"` channel still supplies a string, so `resolveCommand`'s string branch and the metacharacter rule both stay |

**Scope ruled by the owner 2026-08-29 (R13): gate YAML only.** The threat this review actually
reproduced is a dropped FILE (Tier 1.2), and that is the channel that stops parsing. The inline
operator is typed into an invocation by whoever is driving the server — a different and weaker
position — so converting it would have meant writing a tokenizer, breaking documented README and
framework syntax, for the weaker half of the threat.

What argv genuinely buys is worth stating exactly, because it is the repository's own established
argument: the allowlist was checking TEXT, and a prefix entry like `npm *` could only be defended
by ENUMERATING shell metacharacters. Argv is the structural version — the same move Tier 2.1 made
when it chose `assertPathInside` over more field regexes. `["npm","test"]` cannot become two
commands, so the prefix entry is sound by construction rather than by the completeness of a
character list.

| Arm                                                | Result                                                         |
| -------------------------------------------------- | -------------------------------------------------------------- |
| `["echo", "ok; touch …"]`, allowlist `echo *`      | ran; `;` printed as a literal; **marker absent**               |
| `shell_command: "echo legacy"` (string)            | **fails to LOAD**, message carries the migration               |
| `["sh","-c","echo ok; touch …"]`, allowlist `sh *` | marker **written** — the residual, and the probe's own control |

Arm 3 does double duty: it proves the probe can observe a chained `touch` at all (so arm 1's
absent marker is a real negative), and it demonstrates the residual honestly rather than letting
the docs imply a guarantee that does not hold.

**Blast radius, measured before starting**: 12 `src/` sites, 31 test sites, 1 shipped gate
(`test-suite`). The test migration was mechanical — plain commands became argv, and the ones
genuinely needing shell semantics became explicit `["sh","-c",…]`, which is now visible in the
test rather than implied by the string form.

Two things the compiler and the suite caught that reading would not have:

- `.nonempty()` in zod 4 infers `string[]`, not `[string, ...string[]]`, so the tuple type the
  spawn boundary wants is asserted once, at one place, after two prior checks establish it.
- an automated rewrite turned an empty-command test's `''` into `["sh","-c",""]`, silently
  changing what it asserted. Caught by the suite, not by review.

**One flake attributed, not relaxed.** A 1000 ms timeout assertion measured 3031 ms against a
`< 3000` bound. It passed 3/3 in isolation, so it is suite contention under `--runInBand`, not a
consequence of spawning `sleep` directly instead of through `sh`. The bound was left alone.

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

| #   | St                                                                                                | Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Verify                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1 | ✓ DONE (2026-08-25)                                                                               | Audit the STDIO logger and script env for secret leakage, as was done for HTTP headers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **No leak found**, across 5 sinks, with a positive control proving the scan works. Server's own credentials now covered by a test                                                    |
| 4.2 | ✓ DONE (2026-08-25)                                                                               | Re-grade the known `state.db` cross-project scope gap against the settled posture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **Accepted limit — and the documentation was wrong in the pessimistic direction.** `version_history` IS workspace-scoped; the real defect is a written-but-never-read `workspace_id` |
| 4.3 | ✗ KILLED (2026-08-27 · premise falsified twice · revives if one scope column per table is chosen) | Re-measured under 6.7: `workspace_id` has FOUR readers, not zero — `SqliteStateStore` filters on it in three queries, `run-registry` compares it to refuse a cross-workspace handoff claim, `execution-record-store` projects it, `v_execution_status` selects it. The row as written cannot be done because what it describes is not true. What IS true is a different, larger question: `tenant_id` isolates `version_history`/`execution_records`/`resource_changes` while `workspace_id` sits beside it redundant, and `tenant_id` carries three incompatible meanings. That is a schema decision, not a defect to patch — recorded here, not carried as an open row |

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

### Tier 6 — Scope-key unification (C18)

C18 was raised as a novel finding while closing row 1.5. It is not one: it is a **missed site of
`plans/reference/sqlite-layer-remediation-2026-08-03.md` Tier 4.1** ("stop truncating"), which
fixed `execution-context.ts` on 2026-08-03, verified with `validate:no-phantom-columns`, and
retired. The identical expression survived in three sibling producers. Row 4.3 is downstream of
this, not independent.

Owner rulings 2026-08-27: fix BOTH layers (R9) · accept the isolation reset, no migration (R10) ·
new fourth gate member AND repair the charter that let a layer go unowned (R11) · carry here (R12).

| #   | St                  | Work                                                                           | Verify                                                                                                                                                                                            |
| --- | ------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 | ✓ DONE (2026-08-27) | Unify precedence so `resolveContinuityScopeId` reads `continuityScopeId` first | Chain is now continuity → workspace → organization → `'default'`, matching the union form `run-registry` already used                                                                             |
| 6.2 | ✓ DONE (2026-08-27) | Stop truncating in `serving-unit-scope.ts`, plus a launch-default fallback     | Probe: with gates disabled `tools/list` now returns `[]` gate params, was `[gates, gate_verdict, gate_action]`                                                                                    |
| 6.3 | ✓ DONE (2026-08-27) | Same for `prompt-executor.ts`; all four producers now call one shared helper   | `buildIdentityScope()` is the single producer; the other three sites were collapsed onto it                                                                                                       |
| 6.4 | ✓ DONE (2026-08-27) | Fourth family member owning the PRODUCER layer                                 | `validate:scope-producers`, wired into `validate:all` (49 steps). **Falsified**: restoring the truncating expression at both survivors made it report both. Its one exception audits load-bearing |
| 6.5 | ✓ DONE (2026-08-27) | Repair the family instruction                                                  | Charter in both siblings now names four ORDERED layers and says: if no member owns the layer, add one — do not force it into the nearest                                                          |
| 6.6 | ✓ DONE (2026-08-27) | Record the accepted isolation reset                                            | `CLAUDE.md` states what re-derives and why no backfill was written                                                                                                                                |
| 6.7 | ✓ DONE (2026-08-27) | Re-measure row 4.3                                                             | **Premise was wrong twice.** Not zero readers — four, one security-bearing. Real state: `tenant_id` isolates three tables while `workspace_id` sits redundant. See 4.3                            |

### Tier 5 — Capture

| #   | St                  | Work                                                                       | Verify                                                                                                                                                             |
| --- | ------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5.1 | ✓ DONE (2026-08-25) | Build the security-review prompt and skill **from this review's material** | `>>security_review` created via `resource_manager` (rule 1: MCP tooling only) and verified by `inspect` against the live server. Every section traces to a finding |
| 5.2 | ✓ DONE (2026-08-25) | Feed the transferable rules upstream                                       | Two promotions committed to `~/.claude` (`f0f567c`); `check-rules.sh` 15 files passed, 0 failures                                                                  |

#### 5.1 — what the prompt encodes, and where each part came from

Not a generic OWASP checklist. Every phase is something this review learned by getting it wrong
first:

| Prompt section                                                  | Earned by                                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Phase 0 posture blocks everything                               | R1 — the same `shell_verify` is a feature or an RCE depending on who authors gates |
| "the boundary is where content becomes code, not the transport" | Tier 1.1 — one `spawn`, two authoring channels, both transports                    |
| `SUSPECTED` as a first-class state                              | S1 — "grep found no guard" was half wrong, and the real vectors were different     |
| Probe rule 1: name the property                                 | C6 — counted `*.yaml` instead of gate definitions                                  |
| Probe rule 2: null needs a control                              | Tier 1 vacuous greens + Tier 3.2 truncation false negative                         |
| Probe rule 3: refusal ≠ verified negative                       | The allowlist's `refused` flag                                                     |
| Probe rule 4: re-measure carried-in items                       | DEV-T4-1 — "already documented" was false in the pessimistic direction             |
| Phase 3 dial test + "accepted, documented"                      | R2/R3 and Tier 3.3                                                                 |
| Phase 4 close the loop on the docs                              | C5 and C16, both false handbook claims                                             |

It lands **untracked**, in the operator's personal collection, per the ruling recorded in
`CLAUDE.md` §Resource tracking. That is the expected outcome of authoring through the sanctioned
MCP path, not an oversight.

**No separate skill was created.** `/security` already exists and `security.md` is its rule; a
second artifact covering the same domain would be the parallel-system shape this repo's own
standards forbid. The capability-dial material went into the existing rule instead — which is
what 5.2 is.

#### 5.2 — what was promoted, with sighting counts

| Destination                       | Pattern                                    | Sightings                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/.claude/rules/dev-workflow.md` | **A null result needs a positive control** | **4**, two from prior sessions: a gate green 11/11 on a dead action; a test surviving a mutation via early-return; three vacuous "switch blocked it" results; a truncated marker search |
| `~/.claude/rules/security.md`     | **Capability dials**                       | **2** — the transport review gave this file its Local Listener Checklist; this review is the second                                                                                     |

The counts are stated because CLAUDE.md's promotion rule is 3 independent sightings. The
`dev-workflow` pattern clears it. The `security.md` addition is a **second-sighting extension of
an existing domain rule**, not a promotion to CLAUDE.md — the weaker bar the plan's own row 5.2
anticipated. Recording the difference matters more than the outcome: a pattern promoted at two
sightings and presented as three is how a rule set fills with guesses.

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

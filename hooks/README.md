# Claude Prompts Hooks

Behavior guardrails for Claude when using the prompt engine. Catches missed `>>` syntax, forgotten chain continuations, and skipped gate reviews.

## Quick Start

```bash
# Add the marketplace (first time only)
/plugin marketplace add minipuft/minipuft-plugins

# Install the plugin (includes hooks)
/plugin install claude-prompts@minipuft
```

Hooks activate automatically. Type `>>analyze` and watch the suggestion appear.

### Python interpreter resolution

Installed hooks run through `python-hook-runner.cjs` instead of invoking a Python command
directly. The plugin already requires Node.js, so the runner can select a Python 3 interpreter for
the host platform without adding shell-specific branches to each hook:

- Windows: `py -3`, then `python3`, then `python`
- macOS and Linux: `python3`, then `python`

The runner advances to the next candidate only when a command is absent. Once an interpreter starts,
the hook's exit status is returned unchanged; a failing hook is not retried with another Python
installation. If no candidate exists, the runner exits 127 and prints the installation requirement.

The direct `python3 hooks/*.py` commands below are contributor-side tests, not the installed plugin
contract.

## Why Hooks?

| Problem                          | Hook                    | Result                                 |
| -------------------------------- | ----------------------- | -------------------------------------- |
| Model ignores `>>analyze` syntax | `prompt-suggest.py`     | Suggests correct MCP call              |
| Forgets to continue chain        | `post-prompt-engine.py` | Injects `[Chain] Step 2/5` reminder    |
| Skips gate review                | `post-prompt-engine.py` | Prompts an object `gate_verdict`       |
| Malformed verdict parameter      | `gate-enforce.py`       | Names the required object shape        |
| Chain lost after compaction      | `compact-recovery.py`   | Re-injects chain state post-compaction |
| Step paused to talk it through   | every hook              | One pause directive, no continue CTA   |

## Hooks Reference

### `prompt-suggest.py` (UserPromptSubmit)

Triggers on every user message. Detects `>>prompt` syntax and suggests the correct `prompt_engine` call. The framework operator is `^` (`^CAGEERF >>analyze`); the hook still detects `@` as a deprecated alias and renders either as `^`.

Annotations preserve whole slash-qualified references and typed case; display resolves through
the authored catalog ID. Quoted markers and delimiters do not create invocations or chain previews.

A server built-in (`>>status`, `>>help`, `>>listprompts`, `>>gates`, …) has no catalog row and is
routed to `prompt_engine` like a known prompt, never reported as unknown; the list lives in
`lib/builtin_commands.py` and `tests/test_builtin_commands_parity.py` pins it to the server parser.

**Output:**

```text
[>>] diagnose | scope:"auth" [chain:3steps, ^CAGEERF]
[Chain Workflow] 3 steps:
  1. initial_scan: Initial Scan (1/3)
  2. deep_dive: Deep Dive (2/3)
  3. synthesis: Synthesis (3/3)
```

### `post-prompt-engine.py` (PostToolUse)

Triggers after `prompt_engine` calls. Tracks chain state and pending gates.

Blocking-unknown holds use the server's resolution exits in both hook directives, including
recovered holds with no issued step. Ordinary reviews retain their gate-verdict directive.

**Output:**

```text
[Chain] Step 2/5 - call prompt_engine to continue
[Gate] code-quality
  Submit: gate_verdict={"overall":"PASS","rationale":"<reason>"}
  Use FAIL for unmet criteria; follow the returned server template for applicable report fields.
```

The tracker clears its saved run only on terminal evidence for that run. An abort clears it only
when the reply's `structuredContent.run_control` says `cancelled` for the tracked chain (and the
tracked run id, when both are known); `release-incomplete` and `not-applied` keep it, because the
reply text of a failed abort can read like an applied one. Error and refusal responses retain the
state for recovery. Agent subcalls do not change the parent's tracker.

**How Claude Code hands this hook an MCP result.** Measured with Claude Code 2.1.299 (headless):
an ordinary step arrived as a list of content blocks, and a pause or resume as a JSON string of
the `structuredContent` object, with no `structuredContent` key, no `content` and no `isError`.
Every hook reads `tool_response` through `lib/session_state.read_tool_response`, which accepts
those shapes (plus a dict and Bash's `{stdout, stderr}`), and `tests/test_tool_response_reads.py`
fails on a direct read anywhere else. Other hosts' payloads are not claimed here.

**Conversation pause.** The tracker records a pause only from a `conversation_control` packet
whose outcome is `paused`, `already-paused`, `claimed` or `resumed`, and stores the run's exact
identity (run UUID, chain id, organization, workspace, continuity scope), the pause and what the
run owes. A `refused` packet changes nothing. It never stores the reply text or the structured
`message`, which carry the recovery token. A reply for a different chain does not overwrite a
tracked pause. While a pause is tracked, every hook renders one directive (`Workflow paused for
conversation at step N of M: <chain>. Discuss with the user; resume explicitly …`, from
`format_pause_directive`) in place of the continue, fix and verdict instructions.

Only an **owned** pause (a live server holds it and the identity matches exactly) grants any
exemption. A **retained** pause (its server stopped; the run waits in `state.db`) gets the claim
guidance instead; an **unconfirmed** one (no refresh could confirm it) gets the resume and abort
calls, which the server checks. Neither is adopted or resumed by a hook.

### `gate-enforce.py` (PreToolUse)

Blocks `prompt_engine` calls that violate gate discipline:

| Check             | Trigger                                                                                        | Denial Message                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Invalid verdict   | Non-object `gate_verdict`, invalid overall or missing rationale                                | "gate_verdict requires an object with overall PASS or FAIL and a non-empty rationale."                                                    |
| Pending gate      | `chain_id` carrying NO resolution parameter while a gate is open                               | "Gate review required: ... submit gate_verdict. If the gate cannot be satisfied, these parameters also resolve it: {exits}."              |
| Paused on unknown | `chain_id` carrying NO resolution parameter while the run is hard-paused on a blocking unknown | "Chain paused: blocking unknown interrupt. The run issued no step and no gate_verdict clears this hold. Resolve it with one of: {verbs}." |
| Paused for talk   | Any workflow call on a run this conversation holds paused (owned pause, exact identity)        | The pause directive above: discuss, then resume or abort explicitly.                                                                      |

Run controls always reach the server, which decides them: `gate_action` `pause`, `resume` or
`abort`, `handoff:true` and `claim_token`. `retry`, `skip` and `accept_alternative` work the run,
so a paused run denies them. The paused check runs before the pending-gate check.

The pending-run check accepts every **resolution parameter** the server accepts — `gate_verdict`
and `gate_action` (retry/skip/abort/pause/resume/accept_alternative) — read from
`lib/_generated/resolution_verbs.py`, which `server npm run generate:contracts` emits from
parameters flagged `resolvesPendingRun` in `tooling/contracts/prompt-engine.json`. Never hardcode
the verb list in the hook: a hardcoded model can deny `gate_action: "abort"` and trap a pending
gate. If the generated module is missing or unreadable the check fails open — the server enforces gates
authoritatively.

`gate_verdict` is an object with `overall:"PASS"` or `overall:"FAIL"` and a rationale. Honest FAIL
submissions reach the server's authoritative judgment; the hook does not grade them. Applicable
`per_gate`, `reminders` and semantic evaluation follow the returned server template. String verdict
parameters are refused. Returned response text and delegated-worker text protocols are separate.

**Two holds, one rule.** A run can also be held by the reserved synthetic review
`__unknown_interrupt__`, raised when a blocking unknown lands on a run that declared
`budget.pauseOnBlocking`. It reaches the same check by the same route (one pending review, one
`pending_gate` field) but is denied with different prose, because it accepts different exits: a
paused run issues **no step**, so no `gate_verdict` clears it and there is nothing to answer. The
verbs the denial names are the ones the SERVER printed in its own interrupt section —
`lib/session_state.py` captures them off the response (`interruptVerbs` extraction pattern) and
falls back to the generated parameter names when it has none, which is the path compact recovery
takes. Every human-facing surface renders the synthetic id as `blocking unknown interrupt`
(`session_state.label_gate_ids`, used by `db_reader` too); the raw dunder never reaches a caller.
Covered by `tests/test_unknown_interrupt_hold.py`, including a mutation probe that drops
`gate_action` from the generated set and asserts `resume` is then denied.

**Test manually:**

```bash
# Honest FAIL verdict - should allow (exit 0, no output)
echo '{"tool_name": "prompt_engine", "tool_input": {"gate_verdict": {"overall":"FAIL","rationale":"bad code"}}}' \
  | python3 hooks/gate-enforce.py

# PASS verdict - should allow (exit 0, no output)
echo '{"tool_name": "prompt_engine", "tool_input": {"gate_verdict": {"overall":"PASS","rationale":"looks good"}}}' \
  | python3 hooks/gate-enforce.py
echo $?  # Output: 0
```

### `delegation-enforce.py` (PreToolUse) and `ralph-stop.py` (Stop)

While this conversation owns an exact pause of a delegated run, `delegation-enforce.py` makes no
delegation demand and leaves its state untouched, so the demand returns on resume. `ralph-stop.py`
lets the turn end for that one paused run and leaves its shell-verification rows byte-identical;
every other check still runs: the client's own verification row, other runs' rows, and a row it
cannot attribute, which blocks with a diagnostic. It reads a workflow's row by the bound run's
`workflow-run-<run UUID>` key and exact scope, never another conversation's row. This was
measured with hook fixtures and the PostToolUse payload above, not with a native Stop event.

### `compact-recovery.py` (SessionStart, matcher: "compact")

Re-injects active chain state after compaction. Recovery is scoped to the chain THIS conversation recorded (via the PostToolUse chain tracker in `hooks-state.db`); the server's `state.db` refreshes that specific chain and never substitutes another client's chain, since several clients' MCP servers can share one `state.db`. Outputs a continuation directive to stdout, which Claude Code adds to post-compaction context. Replaces the former `pre-compact.py` (PreCompact), which was a side-effects-only event that could not inject context. A paused run is restored as paused, with the pause directive and never a continue instruction.

## Configuration

### Output Format

Set in your config file (`config.jsonc`, or `config.json`) — hooks read the file the server reads,
in its order: `MCP_CONFIG_PATH`, then the project's `.claude-prompts/` (under `CLAUDE_PROJECT_DIR`,
else the working directory), then `MCP_WORKSPACE`, then `${CLAUDE_PLUGIN_DATA}`, then the packaged
`server/` directory, trying `config.jsonc` before `config.json` in each directory and using the
first file found (see [Which File Is Read](../docs/reference/configuration.md#which-file-is-read));
an unreadable or malformed file falls back to the default below rather than making a hook refuse
to run:

```json
{
  "hooks": {
    "expandedOutput": true
  }
}
```

| Mode               | Setting | Example                               |
| ------------------ | ------- | ------------------------------------- |
| Expanded (default) | `true`  | Multi-line with full argument details |
| Compact            | `false` | `[>>] diagnose \| scope:"auth"`       |

### hooks.json

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/python-hook-runner.cjs\" \"${CLAUDE_PLUGIN_ROOT}/hooks/prompt-suggest.py\""
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*prompt_engine*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/python-hook-runner.cjs\" \"${CLAUDE_PLUGIN_ROOT}/hooks/post-prompt-engine.py\""
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*prompt_engine*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/python-hook-runner.cjs\" \"${CLAUDE_PLUGIN_ROOT}/hooks/gate-enforce.py\""
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "compact",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/python-hook-runner.cjs\" \"${CLAUDE_PLUGIN_ROOT}/hooks/compact-recovery.py\""
          }
        ]
      }
    ]
  }
}
```

## Architecture

```text
hooks/
├── hooks.json              # Claude Code hooks config
├── python-hook-runner.cjs  # Cross-platform Python 3 interpreter selection
├── prompt-suggest.py       # UserPromptSubmit - syntax detection
├── post-prompt-engine.py   # PostToolUse - chain/gate tracking
├── gate-enforce.py         # PreToolUse - gate verdict enforcement
├── compact-recovery.py     # SessionStart("compact") - chain state recovery
├── delegation-enforce.py   # PreToolUse - delegated-step demand
├── ralph-stop.py           # Stop - shell-verification loop enforcement
└── lib/
    ├── cache_manager.py    # Prompt/gate metadata queries (via SQLite resource_index)
    ├── db_reader.py        # Read-only SQLite access to state.db
    ├── hook_state_store.py # SQLite-backed session state (hooks-state.db)
    ├── session_state.py    # Chain/gate state tracking (delegates to hook_state_store)
    └── workspace.py        # MCP_WORKSPACE resolution
```

### Chain-token grammar and generated patterns

Preserve the complete raw chain token, including every namespace segment and run suffix:
`chain-implementation_plan/plan_table#1`. Shortening it to a root or basename changes the run
identity. Do not normalize, alias or URI-encode `chain_id`; any URI encoding belongs to its
transport boundary. Structured returned IDs take precedence where the response provides them.

`server/src/shared/utils/resource-ids.ts` owns accepted-reference syntax separately from canonical
authoring. `server/src/shared/utils/chain-id-codec.ts` composes it into `CHAIN_ID_PATTERN_SOURCE`
and the strict `CHAIN_ID_PATTERN`. Hook text extraction derives from that source and matches a
complete token rather than accepting a valid prefix of a malformed one.

From `server/`, run `npm run generate:contracts` to regenerate both
`hooks/lib/_generated/extraction-patterns.json` and `extraction_patterns.py`.
`lib/session_state.py` uses the generated Python twin when JSON is unavailable; neither artifact
is a separate grammar authority. Run `npm run generate:contracts -- --check` to check artifact
parity. This check establishes generated-byte agreement, not native hook event delivery.

Source checks do not establish request-continuity claims, URI protocol behavior, fresh STDIO and
Streamable HTTP behavior, or installed candidate/native event joins; each needs separate evidence.
Codex and Gemini adapters resolve their installed package's `hooks/lib`; OpenCode has a separate
TypeScript port and fallback. Candidate-source readiness alone does not establish downstream or
installed parity.

## Data Access

Hooks read prompt/gate metadata from the server's `state.db` (SQLite, read-only via `db_reader.py`), resolved the same way the server resolves its write path: `{MCP_RUNTIME_ROOT || MCP_WORKSPACE}/runtime-state/state.db`. Hooks do not inherit the server's environment, so `${CLAUDE_PLUGIN_DATA}/runtime-state/state.db` is probed after `MCP_RUNTIME_ROOT` and before the workspace: the Claude Code plugin runs its server with `MCP_RUNTIME_ROOT=${CLAUDE_PLUGIN_DATA}`, and Claude Code gives hooks that variable. The legacy `{workspace}/server/runtime-state/` layout is probed last. Hook-owned session state is stored in `server/runtime-state/hooks-state.db` under the hook's workspace (SQLite, read-write via `hook_state_store.py`); on a Claude Code plugin install that is the plugin root, which a plugin update replaces.

## Other Platforms

Gemini CLI hooks: [gemini-prompts/hooks/](https://github.com/minipuft/gemini-prompts/tree/main/hooks) (shares `lib/` via npm dependency).

---
title: prompt_engine takes one typed call per mode, over one chain model
date: 2026-11-05
status: active
type: plan
tracking: none
tracking_reason: local-only
initiative_branch: feat/prompt-engine-typed-surface
worker_cap: 3
planner_session: handbook-band-aids
tags: [mcp-tools, contracts, parsers, pipeline, hooks]
---

# prompt_engine takes one typed call per mode, over one chain model

## Now (2026-11-05)

Goal: an agent that connects cold sends a correct `prompt_engine` call because the wrong one cannot be expressed, and every chain is one node model inside the server.
Slice: none in flight. Tier T0 (three measurements) runs first and decides the shape of T2.
Next decision: root-level union versus a `mode` tag, settled by row 0.1.
Constraint: ships in the open 6.0.0 release (owner ruling R8), hard cut, no dual-shape window. Hooks and both downstream repositories move in the same release.

## Intent

**Work type**: refactor of a public surface, secondary bug_fix · **Risk**: high — the MCP tool surface and the Python hook contract both change.

Current state: `prompt_engine` multiplexes seven modes over 14 flat optional parameters. Two exclusivity lists (`COMMAND_SOURCE_PARAMETERS`, `CONTROL_EXCLUSIVE_PARAMETERS`) teach the legal combinations through refusals. The tool's metadata costs about 5,550 tokens per session (22,228 bytes, measured 2026-11-04). A chain can be written as a `-->` string or as a `workflow` object; three builders each produce the string-shaped `ParsedCommand`, 21 service files outside the parsers know the string's operator types, 23 know the node model, and 22 places branch on which form produced the command. `inputs` sent with a `-->` command reached no step and raised no refusal (measured 2026-10-28).

Desired state: one tool, input discriminated by mode, each variant carrying only its fields. The node model is the single internal representation. `-->` survives as surface syntax read by one translator at the edge. No service imports the string's vocabulary or asks where a command came from. Usage facts live in the schema, then the refusal, then the response footer, then parameter text, in that order; the server sends no `instructions` block.

Non-goals: splitting `prompt_engine` into several tools, changing `>>prompt_id args` for single invocations, an MCP `instructions` block, any change to `resource_manager` or `system_control` parameters.

## Design decisions

| Decision                   | Chosen                                                                                                                             | Rejected                                                | Why                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Tool count (R7)            | one tool, input discriminated by mode                                                                                              | several tools; flat shape with trimmed prose            | the three-tool surface is product identity; a typed shape deletes both exclusivity lists                    |
| Release (R8)               | folded into 6.0.0, hard cut                                                                                                        | 7.0.0; one major accepting both shapes                  | every consumer of the flat shape is in the fleet and moves together; a window is a second validation path   |
| Chain language (R9)        | node model is the one internal form; `-->`, `==>` and `* N` are surface syntax translated at the edge                              | retire the operators; keep both as public forms         | owner: the operator composes naturally in one line, and must not exist past the parser                      |
| Operators without a field  | `* N` expands in the translator; attempt presets become a node's retry count; `%` modifiers move to the run's options              | new node fields for each                                | they describe the call or are pure expansion, not chain structure                                           |
| `inputs`                   | becomes the first node's `args`; a key that node does not declare is refused by name                                               | bind to every step; refuse on multi-step commands       | matches what the parameter text already promises; makes the dropped-arguments defect unexpressible          |
| `gate_action`              | split by concern: run control (pause, resume, abort), gate recovery (retry, skip), unknown resolution (resume, accept_alternative) | one field inside the typed shape                        | `resume` currently means two different things depending on run state                                        |
| Connect-time guidance (R1) | none; parameter prose is the budget to cut                                                                                         | an MCP `instructions` block                             | every candidate fact was already carried by a description, a refusal or a footer; a block would repeat them |
| Flat-shape calls after 6.0 | refused, and the refusal shows the exact variant to send                                                                           | silently accepted; generic undeclared-parameter refusal | agents have seen the flat shape; the moment of error is the one place explaining is the right channel       |

### Interfaces

Sketch only; the union's surface form is decided by row 0.1.

```ts
// server/src/mcp/tools/schemas/prompt-engine.schema.ts
type PromptEngineInput =
  | {
      mode: "run";
      command: string;
      gates?: GateSpecification[];
      options?: RunOptions;
    }
  | { mode: "run"; workflow: WorkflowIR }
  | { mode: "answer"; chain_id: string; user_response: string }
  | {
      mode: "review";
      chain_id: string;
      gate_verdict: GateVerdict;
      user_response?: string;
    }
  | { mode: "control"; chain_id: string; action: "pause" | "resume" | "abort" }
  | { mode: "recover"; chain_id: string; action: "retry" | "skip" }
  | {
      mode: "rewrite";
      chain_id: string;
      remainder: Remainder;
      observations?: Observation[];
    }
  | { mode: "handoff"; chain_id: string }
  | { mode: "claim"; claim_token: string };

// server/src/engine/execution/parsers/ — the only module that knows the string
export function translateCommand(command: string): WorkflowIR;
```

## Tier T0 — measure before any shape is written

| #   | St  | File                                                                   | Change                                                                                                                                         | ~Lines | Depends | Verify                                                                                                                        | Justification                                                                                                                                                      |
| --- | --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0.1 | ☐   | `server/scripts/verify-union-schema-clients.mjs` (new)                 | serve a throwaway tool whose input schema is a root-level union; record, per fleet client, whether it lists the tool and can call each variant | +120   | —       | a transcript per client (Claude Code, Gemini CLI, OpenCode, Codex); a control tool with a flat schema that every client calls | function-calling schema support differs per client and is unmeasured (as of 2026-11-05 · flips when four client transcripts are recorded)                          |
| 0.2 | ☐   | `server/scripts/measure-tool-surface.mjs` (new), `server/package.json` | print bytes of each tool's listed metadata from a built server; record today's numbers as the baseline the T2 size gate reads                  | +60    | —       | output matches the 2026-11-04 measurement within the same build; control: add a parameter, the number rises                   | the goal is fewer tokens per session, and a typed schema can grow if variants restate shared fields (as of 2026-11-05 · flips when the baseline file is committed) |
| 0.3 | ☐   | `plans/prompt-engine-typed-surface-2026-11-05-implementation-notes.md` | operator-to-node mapping table: for every string operator, the node field or run option it becomes, and the rule that names a synthesized node | +60    | —       | every operator the tokenizer recognises appears exactly once; reviewed against `server/src/modules/workflow-ir/types.ts`      | node ids are addressed by gates and late reports, so the naming rule must be fixed before code (as of 2026-11-05 · flips when the table is in the notes file)      |

## Tier T1 — one chain model

| #   | St  | File                                                                                                                                                                                    | Change                                                                                                                                   | ~Lines    | Depends  | Verify                                                                                                                                                                     | Justification                                                                                                                                      |
| --- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | ☐   | `server/src/engine/execution/parsers/symbolic-command-builder.ts`, `server/src/engine/execution/parsers/symbolic-operator-parser.ts`, `server/tests/unit/execution/parsers/`            | the string translator returns the node model; synthesized ids follow the 0.3 rule; `* N` expands here                                    | +200/−150 | 0.3      | table-driven unit test, one row per operator from 0.3; `>>p --> >>p` and `>>p * 3` produce stable distinct ids across two parses                                           | one translator, one direction (as of 2026-11-05 · flips when the table test passes)                                                                |
| 1.2 | ☐   | `server/src/engine/execution/parsers/workflow-command-builder.ts`, `server/src/engine/execution/pipeline/stages/04-parsing-stage.ts`                                                    | the object-to-string-shape builder is deleted; a submitted `workflow` is validated and used as the node model directly                   | −196/+40  | 1.1      | the existing workflow submission integration tests pass unchanged in behaviour; `rg workflow-command-builder server/src` returns nothing                                   | the richer model was being compiled into the poorer one (as of 2026-11-05 · flips when the file is gone and the tests pass)                        |
| 1.3 | ☐   | every file matching `rg -l "ChainOperator\|SymbolicOperator\|commandType\|'symbolic'\|SymbolicCommand\|parsedCommand\.operators" server/src --glob '!**/parsers/**'` (21 on 2026-11-05) | each reads the node model; every branch on the command's origin is removed (22 on 2026-11-05)                                            | +300/−400 | 1.1, 1.2 | the predicate in the File column returns zero files; drive a `-->` chain and the same chain as `workflow` over STDIO and HTTP and compare the rendered steps byte for byte | the list is defined by a predicate, not by the 21 names counted today (as of 2026-11-05 · flips when the predicate returns zero)                   |
| 1.4 | ☐   | `server/src/engine/execution/parsers/append-command-parser.ts`, `server/src/engine/execution/pipeline/stages/01-request-normalization-stage.ts`                                         | a `-->` string sent with a run id translates to the `remainder` form at the same edge; the append parser's own execution path is deleted | +60/−180  | 1.1      | appending by string and by `remainder` produce the same run nodes; its eight refusals still fire with the same text                                                        | the append string is the same split in a second place (as of 2026-11-05 · flips when both forms produce identical nodes)                           |
| 1.5 | ☐   | `server/src/mcp/tools/schemas/prompt-engine.schema.ts`, `server/src/engine/execution/parsers/argument-parser.ts`, `server/tests/integration/`                                           | `inputs` binds to the first node's `args`; a key that node does not declare is refused by name                                           | +80/−30   | 1.1      | regression: `>>a --> >>b` with `inputs` delivers the required argument to step one (fails on main); control: an undeclared key is refused naming the key                   | two sightings of arguments dropped with no refusal (as of 2026-11-05 · flips when the regression test passes)                                      |
| 1.6 | ☐   | `server/scripts/validate-command-origin-boundary.js` (new), `server/package.json`                                                                                                       | a member of `validate:all` that fails when a file outside the parsers imports the operator types or branches on a command's origin       | +110      | 1.3      | planted import in a stage file fails the gate; removing it passes                                                                                                          | a fix at the sites found is not a fix of the class; this gate owns the boundary (as of 2026-11-05 · flips when the planted control fails the gate) |
| 1.7 | ☐   | `server/src/infra/database/sqlite-engine.ts`, `server/src/infra/database/table-contracts.ts`, the execution record store                                                                | each run's execution record carries the command form that started it (string, object, named chain)                                       | +50       | 1.2      | start one run of each form; the three records carry three distinct values; `validate:table-contracts` and `validate:no-phantom-columns` pass                               | real usage of the string could not be counted from the log on 2026-11-05 (as of 2026-11-05 · flips when the three-form drive shows three values)   |

## Tier T2 — typed input

| #   | St  | File                                                                                                                                                     | Change                                                                                                                                             | ~Lines    | Depends  | Verify                                                                                                                                                   | Justification                                                                                                                              |
| --- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 2.1 | ☐   | `server/src/mcp/tools/schemas/prompt-engine.schema.ts`, `server/tooling/contracts/prompt-engine.json`                                                    | the input is the mode union in the form row 0.1 selects; `COMMAND_SOURCE_PARAMETERS` and `CONTROL_EXCLUSIVE_PARAMETERS` are deleted                | +260/−300 | 0.1, 1.3 | every combination the two lists refused is now a schema error; `rg "CONTROL_EXCLUSIVE_PARAMETERS\|COMMAND_SOURCE_PARAMETERS" server/src` returns nothing | invalid combinations become unexpressible instead of refused (as of 2026-11-05 · flips when both lists are gone and the schema tests pass) |
| 2.2 | ☐   | `server/src/mcp/tools/schemas/prompt-engine.schema.ts`, `server/src/engine/gates/services/gate-verdict-processor.ts`, the conversation-control formatter | `gate_action` splits into the three concerns in Design decisions; each verb exists in exactly one mode                                             | +120/−90  | 2.1      | each verb is accepted in its mode and is a schema error in the other two; the paused-run and exhausted-gate integration tests pass                       | `resume` means two things today (as of 2026-11-05 · flips when each verb has one home)                                                     |
| 2.3 | ☐   | `server/src/engine/execution/formatting/` (the footer and the conversation-control response), stage 1 help text                                          | one builder renders the next call as the exact variant; every site that assembles a call as a string uses it (10 on 2026-11-05)                    | +90/−120  | 2.1      | every rendered next-call parses against the new schema, checked across the e2e chain suite                                                               | the footer is the channel that arrives at the moment of need (as of 2026-11-05 · flips when all rendered calls validate)                   |
| 2.4 | ☐   | `server/src/mcp/tools/schemas/prompt-engine.schema.ts`, `docs/guides/troubleshooting.md`                                                                 | a call in the retired flat shape is refused with the variant it should have been                                                                   | +70       | 2.1      | each of the seven flat forms returns a refusal containing a call that validates                                                                          | agents have seen the flat shape in docs and training data (as of 2026-11-05 · flips when seven refusals round-trip)                        |
| 2.5 | ☐   | `server/scripts/generate-contracts.ts`, `server/scripts/validate-tool-parameter-reads.js`, `server/src/mcp/contracts/schemas/_generated/`                | the contract generator and the parameter-reads gate understand variants; a parameter declared in a mode and read in no path of that mode fails     | +150/−60  | 2.1      | planted unread parameter in one mode fails the gate; `validate:contracts` passes after regeneration                                                      | the gate that owns the strict-schema class would go blind otherwise (as of 2026-11-05 · flips when the planted control fails)              |
| 2.6 | ☐   | `server/tooling/contracts/prompt-engine.json`, `server/scripts/measure-tool-surface.mjs`, `server/package.json`                                          | parameter prose is cut to what the schema does not already say; a `validate:all` member fails when the tool's listed bytes exceed the 0.2 baseline | +40/−200  | 0.2, 2.1 | measured bytes are below the baseline; raising a description past it fails the gate                                                                      | the measured cost was about 5,550 tokens per session (as of 2026-11-05 · flips when the gate passes below baseline)                        |

## Tier T3 — the fleet moves with it

| #   | St  | File                                                                                                                                                                                               | Change                                                                                                                                  | ~Lines    | Depends  | Verify                                                                                                                                    | Justification                                                                                                                                  |
| --- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | ☐   | `hooks/post-prompt-engine.py`, `hooks/gate-enforce.py`, `hooks/delegation-enforce.py`, `hooks/ralph-stop.py`, `hooks/compact-recovery.py`, `hooks/prompt-suggest.py`, `hooks/lib/`, `hooks/tests/` | every hook reads the mode variant from `tool_input` (138 field reads across 8 files on 2026-11-05); `prompt-suggest` emits the new call | +200/−200 | 2.1      | `npm --prefix server run validate:python`; a headless `claude -p` drive of a gated two-step chain where the hook blocks and then releases | the hook contract is durable surface and fixtures have passed while the live join failed (as of 2026-11-05 · flips when the live drive passes) |
| 3.2 | ☐   | `gemini-prompts` and `opencode-prompts` (sibling repositories)                                                                                                                                     | the Gemini adapters and the OpenCode TypeScript port read the variant; both pin the 6.0.0 server                                        | +250/−250 | 3.1      | each repository's own suite; one chain driven end to end in each client                                                                   | OpenCode re-implements the parsing by hand (as of 2026-11-05 · flips when both downstream PRs are merged)                                      |
| 3.3 | ☐   | `server/tests/**` matching `rg -l "chain_id\|gate_verdict\|user_response\|gate_action" server/tests` (125 files on 2026-11-05)                                                                     | a codemod rewrites flat argument objects to variants                                                                                    | ±1500     | 2.1, 2.2 | `npm run typecheck:tests:ratchet`; CI `test:all` at the pull request                                                                      | mechanical and large; hand edits would drift (as of 2026-11-05 · flips when CI is green on the slice PR)                                       |
| 3.4 | ☐   | `docs/reference/mcp-tools.md`, `docs/concepts/chains-lifecycle.md`, `README.md`, `server/resources/**` that teach a call, `CLAUDE.md`, `CHANGELOG.md`                                              | every documented call is a variant; the Public API section and the changelog carry the breaking note and a before and after             | +300/−300 | 2.1, 2.3 | `validate:readme`; every fenced call in the docs validates against the schema (extend the existing claims-conformance test)               | docs and code move in lockstep (as of 2026-11-05 · flips when the docs conformance check passes)                                               |

## Dispatch

| Tier | Pull request                                                                    | Worker tier                                     | Notes                                                               |
| ---- | ------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| T0   | one PR, scripts and the notes                                                   | bounded                                         | no source change; decides 2.1                                       |
| T1   | one PR                                                                          | deriving for 1.1 to 1.3, bounded for 1.4 to 1.7 | 1.3 lands with 1.6 so the boundary cannot regrow                    |
| T2   | one PR stacked on T1                                                            | deriving for 2.1 to 2.2, bounded for 2.3 to 2.6 | the schema snapshot tests change here, once                         |
| T3   | hooks and tests with T2; docs last; downstream PRs after the server PR is green | bounded; the live hook drive is the planner's   | 3.2 needs the 6.0.0 server available to the downstream repositories |

## Open Questions

| #   | Question                                                                                                      | Settled by                                       |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Q1  | Root-level union or a required `mode` tag with one object per mode?                                           | row 0.1                                          |
| Q2  | Is the execution record table carried across a schema bump, and does row 1.7 therefore need a migration step? | reading `table-contracts.ts` at the start of 1.7 |

## Risks

| Risk                                                                              | Likelihood | Mitigation                                                                                           |
| --------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| A fleet client cannot call a union-typed tool                                     | medium     | row 0.1 measures it before 2.1; the `mode` tag form needs no union keyword                           |
| The typed schema costs more tokens than the flat one                              | medium     | row 2.6 gates on the measured baseline                                                               |
| 6.0.0 is held longer because this slice is large                                  | high       | owner accepted this in R8; T0 and T1 carry no public change and can merge while T2 is in review      |
| A hook passes its fixtures and fails against a live client                        | medium     | row 3.1 requires a headless live drive                                                               |
| Synthesized node ids shift between parses and orphan a gate target or late report | medium     | row 0.3 fixes the rule first; row 1.1 tests stability across two parses                              |
| Three other active workflow plans touch the same files                            | medium     | re-measure `plans/workflow-*.md` against main before T1; their merged rows are closed in their plans |

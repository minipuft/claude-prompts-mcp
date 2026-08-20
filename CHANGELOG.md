# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### ⚠ BREAKING CHANGES

- **`session cancel` moved from `system_control` to `prompt_engine`.** Call `prompt_engine(chain_id:"chain-x#1", cancel:true)`; `system_control(action:"session", operation:"cancel")` now refuses and names the replacement. `list`, `inspect` and `clear` stay on `system_control`. **The id you hold decides the tool**: a `chain_id` is held _because you are running the chain_, so stopping that run is part of running it, while a `session_id` comes from a listing and acting on runs you are not in is operator work. The split had no rule before this, which is how `prompt_engine` came to own `force_restart` — a session-lifecycle mutation — while the verb it is built from lived on the other tool. `force_restart` is now documented as cancel-then-start, so the two abandonment verbs sit on one tool with one sentence separating them.
- **`resource_manager` gains `source_workspace`**, a read-only cross-workspace history parameter. It is honoured by `history` and `compare` and **refused** by every other action, including `rollback`: a snapshot recorded in another workspace describes files that may not exist here, and version numbering is per-workspace. The refusal is deliberate — silently scoping the parameter back to local would leave the caller believing they had restored the other workspace's version.

- **A gate criterion that cannot be enforced is refused at load.** `shell_verify` without a `shell_command`, and `script_tool` without a `script_tool_id`, now fail gate loading with a message naming the missing field. Both previously auto-passed at review time, so a gate declaring a check it could not perform reported as verified — the strongest available evidence for the one outcome that carries none. Gate YAML is contract surface, so this is priced as breaking even though no gate in this repository or its downstream consumers relied on the old permissiveness.

Both tool-surface changes alter the reachable-shape union of the MCP tool surface, which this repository's Public API Contract prices as breaking.

### Added

- **`script_tool` gate criteria now run.** A gate can declare `script_tool_id` naming a registered script tool, and gate review executes it with JSON on stdin and reads back a structured `{ passed, reason?, details? }` verdict — the script explains WHY, and that explanation lands in the review feedback instead of a generic "review your work". It runs beside `shell_verify` rather than instead of it: a gate may declare both, and the coverage decision that clears a review reads only gate id and pass/fail, so it is mechanism-agnostic. `shell_verify` remains the simpler default where an exit code says enough. Previously the type was accepted by the schema and executed by nothing — the only live consumer of `pass_criteria` filtered for `shell_verify` — so a gate declaring it cleared review having verified nothing, silently.
- **`dry_run` previews `rollback` and `delete`** on prompts, gates and frameworks, in addition to prompt `update`. A preview writes no file and records no version, and still refuses a version whose snapshot is incomplete, so the preview and the real call agree. A `delete` preview names what would be removed — for a prompt, the prompts that reference it.
- **`resource_manager` and `system_control` advertise `destructiveHint`**, and `prompt_engine` advertises that it is not destructive, so clients can gate destructive actions where the operator is.
- **Phase-guard section headers are now declared to the model, derived live from `phases.yaml`.** Chain steps and gated single prompts (any prompt carrying an explicit `gates` parameter, a `gate` operator, or `chainSteps`) render the section-header vocabulary — and the declarable subset of its guard criteria (`contains_any`, `contains_all`, `max_length`) — from the same source the phase-guard evaluator grades against, replacing five hand-maintained prompt copies as the source of truth. Negative criteria (`forbidden_terms`, `matches_pattern`) are never declared to the model; the type system rejects a criterion that tries. A framework that declares `guards` on a phase with no `section_header` is now refused at load, naming the offending phase. `validate:phase-header-drift` catches a prompt file that restates a header its framework no longer declares.

### Changed

- **Plan execution consolidated onto one prompt that compiles, rather than two that narrate.** `>>strategicImplement` now compiles a tier-gated plan table into a single `prompt_engine` workflow submission — row ids become node ids, the Depends column becomes the dependency edges, gate ids named in a row's Verify column become that node's inline gates, and the tier gate targets the tier's last node. `>>implementation_plan` emits rows carrying that mapping, and `>>tier_execute` is removed with no alias: its 160-line protocol rebuilt a dependency DAG from prose on every run, which is exactly the structure the workflow IR already validates. The practical effect is that review fires on the row that earned it instead of batching to the end of a tier, and "which of these rows can run in parallel" is answered by the linearizer rather than re-derived by hand each initiative. The surviving judgment work — tier re-measurement, vacuity-checked gate verification, plan writeback, and the commit boundary — moved into `strategicImplement` rather than being deleted with the prompt.

- **Destructive `resource_manager` actions are denied by one guard** ahead of dispatch rather than by six hand-written checks across the processors. `prompt delete` keeps its own refusal because that one names the dependent prompts that would break.

### Fixed

- **Attaching a gate token to a prompt no longer breaks it.** `>>reference_demo` rendered normally while `>>reference_demo :: code-quality` failed with "Missing required field: text" — the gate token is the only difference, and a gate-token-only command produces EMPTY arguments. That was the one case the symbolic path answered from author-declared `defaultValue` alone, while the direct path answers it through the argument parser's fallback strategy, which resolves every declared argument down to an empty-string fallback. Two implementations of "what arguments does a prompt get when none are supplied", one missing two tiers. Every prompt whose arguments are all optional-or-defaulted was a latent failure the moment a gate was attached.
- **A chain step can reach its own prompt's script tools.** Script lookup tries a prompt-local `tools/{id}/` before the workspace `resources/scripts/{id}/`, but only when told which prompt is executing — and the chain renderer never said. A prompt whose tool lives beside it worked standalone and failed as a chain step with `ScriptNotRegisteredError` naming only the workspace path, which the author had never used. Documented behaviour was already correct; the code did not implement it.
- **A prompt's `tools/*/tool.yaml` is no longer graded against the prompt schema.** Prompt discovery recurses into a prompt's reserved `tools/` directory, so every script-tool manifest was validated as if it were a prompt and logged an ERROR it could never satisfy, on every startup. `tool.yaml` is now reserved alongside `prompt.yaml`, `prompts.yaml` and `category.yaml`.

- **A phase guard can no longer block on a section header the executing prompt was never told to produce.** Previously the guard graded every `phases.yaml` header regardless of whether the rendered prompt actually asked for it, so a header rename in `phases.yaml` silently created an unsatisfiable review loop — reproduced live on this repository's own planning chain. A header the prompt did not declare is now advisory only; enforcement of a declared-and-missing header is unchanged.
- **Gate and framework version history now records the state each edit produced**, matching prompts. Previously version N held the state edit N _replaced_, so the state currently on disk was recorded in no row at all and was not rollback-reachable until the next edit. A self-healing bridge row carries existing rows across the change with no migration.
- **Rollback restores the recorded snapshot exactly instead of merging current values into it.** A version whose snapshot cannot rebuild the resource is now refused, naming the missing fields; substituting the live value landed the resource on a state matching neither the target version nor the state before it, under a message saying version N had been restored. Where a rollback legitimately leaves part of a resource untouched — fields resolved through the category chain, a framework field the version never recorded, script tools under `tools/{id}/` — the response now names what it did not restore.
- **A rollback refused for any reason no longer writes version rows.** Rollback runs validate → record → write, with recording ahead of the file write so a persistence failure aborts with nothing on disk.
- **A gate or framework edit no longer writes a spurious bridge row every time.** Snapshot projections are emitted in a canonical key order, because the bridge check is `JSON.stringify` equality and was therefore order-sensitive; steady state is one row per edit again.
- **`cpm rollback` no longer destroys resource fields.** It wrote the recorded snapshot as the entire entry YAML, so rolling a gate back through the CLI deleted `pass_criteria`, `retry_config`, `activation` and `guidanceFile` and injected a bogus `guidance` key — the CLI and the server produced different files from the same version. The snapshot is now merged over what is on disk, and `cpm rollback style` is refused up front rather than cast into a resource type that has no version history.
- **`resource_manager framework update description:"…"` was a silent no-op.** The value was accepted, diffed and reported, but never written; the old description survived because the framework writer merges over the existing YAML.
- **A script tool's declared interpreter fallbacks now work.** `RUNTIME_COMMANDS` has always listed alternates — `python3` then `python`, `bash` then `sh` — but the lookup returned the first entry regardless, so on a host carrying only the second name every tool of that runtime failed with a bare ENOENT while the table claimed otherwise. The interpreter is now resolved against the same `PATH` the child process receives. When nothing resolves it still attempts the first entry, so a host this scan reads incorrectly fails exactly where it used to rather than in a new place.
- **Script output is capped, and exceeding the cap is a failure rather than a trim.** Script stdout was unbounded, leaving the timeout as the only backstop against a runaway script filling the context window. Truncating alone would have been worse than the leak: the JSON parser never throws — it wraps unparseable text as `{ output: "…" }` — so a capped payload arrived looking like a well-formed object whose every expected field had gone missing, and `{{script:id.field}}` rendered empty with nothing reporting the loss. Over-cap results now fail and name the limit. The default is 50,000 characters, configurable as `maxOutputChars`.

- **A prompt can document `{{script:...}}` without executing it.** `{% raw %}` is the documented escape for literal `{{ }}`, but script references were detected by a regex over raw template text that ran before Nunjucks and knew nothing about raw blocks, so a prompt explaining the syntax ran it instead — and any reference that escaped the regex then reached Nunjucks as an unparseable expression and failed the whole render. Both are fixed: references inside a raw block render as literal text and execute nothing. An unclosed `{% raw %}` covers the rest of the template, since such a template cannot render either way and running a script first is the worse of the two outcomes.
- **The `{{script:...}}` examples in the template syntax reference now work.** Both were written spaced (`{{ script:word_count ... }}`); the resolver matches `{{script:` literally, so neither was ever resolved and each failed the render it appeared in.

### Security

- **`script_tool` gate criteria no longer reach a shell.** `script_tool_id` was passed to the process helper as a command string, which maps a string to `sh -c`, so the id was executed as a shell command rather than resolved against the registered script tools — and gate criteria are creatable at runtime through `resource_manager`. The id is now resolved through the same tool registry and executor the inline reference path uses. A check that cannot run — unknown id, no registry wired, or a tool requiring confirmation, which a gate has no channel to obtain — now fails closed; a missing `script_tool_id` previously reported `passed: true` with a perfect score, which is the strongest possible evidence for the one outcome that carries none. This mattered more once the type became live in the same release: the id is resolved through the script-tool registry on the path gate review actually takes.
- **`{{script:id}}` no longer bypasses the confirmation gate.** A script tool declaring `execution.confirm: true` was held for approval on the declarative `tools:` route and executed unconditionally when a template referenced it inline — the two routes enforced different contracts for the same setting. Reproduced against a shipped example prompt, which returned the script's real output and a confirmation prompt for that same tool in one response, making the prompt a caption on a completed action rather than a gate. Inline references now honour `confirm` through the existing explicit-request channel: approve one run by naming the tool as `tool:<id>` in the invocation arguments. **Prompt authors:** a template referencing a `confirm: true` tool now aborts the render instead of running it; set `confirm: false` on tools that genuinely need no approval.
- **Script output is no longer evaluated as template syntax.** Arguments containing `{{`, `{%` or `{#` were already escaped before rendering, but script stdout was spliced into the template itself and then rendered, so a script emitting template syntax could read other arguments into its own output, inject structure into the surrounding prompt, or hang the render in a loop. This is reachable by any script returning data its author does not fully control, such as a tool that formats a remote API response. Output is now inserted as literal text, including output that carries its own `{% endraw %}`.

## [4.0.1](https://github.com/minipuft/claude-prompts-mcp/compare/v4.0.0...v4.0.1) (2026-08-16)

### Fixed

- **ci:** verify the registry entry flagged latest, not the first one returned ([5cef21e](https://github.com/minipuft/claude-prompts-mcp/commit/5cef21ec0205aa1d780c9d38a181323082031bdf))
- make gate abort terminal, and stop prose punctuation parsing as arguments ([f4452ce](https://github.com/minipuft/claude-prompts-mcp/commit/f4452ced089163b5b507f901f00b73cbaca5b23a))
- **prompts:** bind prompts per serving unit, resolve content at call time ([#227](https://github.com/minipuft/claude-prompts-mcp/issues/227)) ([e2297de](https://github.com/minipuft/claude-prompts-mcp/commit/e2297de7fdf95dd51d792a28a024f4e8c165e1fe))

### Documentation

- **docs:** correct the origin SHA in the phase-guard plan ([#221](https://github.com/minipuft/claude-prompts-mcp/issues/221)) ([06e88da](https://github.com/minipuft/claude-prompts-mcp/commit/06e88dace62bf6692d42c2ee8673445e248cbf9b))
- **docs:** plan the phase-guard declaration contract ([4125d25](https://github.com/minipuft/claude-prompts-mcp/commit/4125d25a7e278f1aa04a9d606bf0bab282ba5e89))
- **docs:** retire the agent-plugins and plan-retirement plans ([2b784e9](https://github.com/minipuft/claude-prompts-mcp/commit/2b784e9755c075ef625c5b8db4cdbb53b675fe85))
- **docs:** retire the agent-plugins migration as reference ([00d1811](https://github.com/minipuft/claude-prompts-mcp/commit/00d1811ec24ed324f64871b616224d922a206935))
- **docs:** retire the plan-retirement federation as reference ([ea74eee](https://github.com/minipuft/claude-prompts-mcp/commit/ea74eee4c48c2b978b92570f569f2959ede99eb0))

## [4.0.0](https://github.com/minipuft/claude-prompts-mcp/compare/v3.2.1...v4.0.0) (2026-08-15)

### Added

- **GitHub-native planning pilot.** Repository intake now distinguishes unresolved Discussion ideas from accepted Issues, repairs Issue-form links, and provides the local pilot for a dry-run-first Discussion → Issue → Project → plan → PR lifecycle.
- **Patch-mode prompt editing.** `resource_manager` `action:"update"` accepts `patch` — anchored `old_string`/`new_string` operations over `user_message_template`, `system_message`, and `description` — so a one-section edit no longer retransmits the whole prompt. Anchors are exact-match and uniqueness-checked with typed rejections (`empty_old_string`, `target_absent`, `anchor_not_found`, `anchor_ambiguous`); a rejected patch writes nothing and consumes no version. `dry_run: true` previews the produced text and diff without writing. Both are update-only — `create` rejects them explicitly.
- **All five preserved prompt fields are now authorable through the tool.** `injection`, `register_with_mcp`, `mcp_prompt_mode`, `subagent_model`, `agent_type` join `resource_manager` create/update as optional parameters (additive, non-breaking). The two resolution-hierarchy fields carry an explicit freeze-hazard warning in their descriptions: setting them overrides category/global defaults permanently until unset.
- **Category ship-signal.** Creating or updating a prompt in a category excluded by `server/resources/prompts/.gitignore` now appends a warning naming the allowlist file and the exact lines to add — previously the tool reported success identically whether the prompt would ship or stay workspace-local. The `planning/` category is now allowlisted, so the implementation-planning chain ships with the repo.
- **Per-step visibility policy.** A chain step's YAML may declare `visibility: { withhold: [...], expose: [...] }` over three server-sourced context items — `previous_step_output`, `chain_history`, `unknowns_ledger`. A withheld item stays out of every later step's render (replaced by a named `[CONTEXT WITHHELD]` instruction) until a step explicitly `expose`s it, for that step only; a `==>` delegated step's handoff envelope excludes withheld items and carries a names-only manifest line instead. Withholding covers only what the server sources — the server cannot unsee the client's window, and true isolation remains the `==>` delegation operator; the docs now state that ceiling explicitly.
- **`prompt_engine` accepts a `workflow` parameter** — a structured, node-addressed workflow IR, mutually exclusive with `command` and `chain_id`. It is validated server-side against schema and structural budget caps (`maxNodes` 32, `maxFanOut` 8, `maxInsertions` 3, enforced and narrow-only) and then compiled into an ordinary chain run — the resulting `chain_runs`/`chain_run_nodes` rows are structurally identical to an equivalent `>>chain`'s, and there is no IR-specific execution path. `edges` are dependencies, not branches: they linearize into one run order (Kahn's algorithm, ties broken by declaration order); there is no branching runtime. An invalid workflow is rejected with one addressed line per problem naming the offending node/edge and rule, and writes nothing — no run, no session, no version. IR nodes can carry every field the runtime consumes that the string command grammar cannot express — stable node ids, per-step `visibility`, gate bindings (`gates`, `inlineGateIds`), delegation hints (`subagentModel`, `agentType`), and `inputMapping`/`outputMapping`. A declared `declaredCostCeiling` is recorded on the run's terminal telemetry and never enforced. See [Workflow IR Reference](docs/reference/workflow-ir.md).
- Chain steps accept a `framework` field, selecting the framework for that step alone. It outranks the run-wide default and yields to an explicit `^Framework` operator on the command; an id the registry does not know falls back to the run-wide framework rather than failing the load.
- Documentation governance now routes public-doc changes through a versioned `documentation_change` chain, with focused gates for product positioning, information placement, semantic discoverability, and prose hygiene.
- `prompt_engine` accepts an optional `observations` parameter — chain steps declare typed unknowns (discovered/resolved) that accumulate in a per-run ledger and surface in subsequent step context.
- `execution_records` now records per-run telemetry (steps planned/executed, gate verdict submissions, the FAIL subset of those submissions, unknowns opened/closed) as record-only facts on terminal rows, surfaced as one plain-text line per session by `system_control execution_history`. No scoring, weighting, or routing decision is derived from these fields. Schema v21 — `execution_records` is `ephemeral`, so existing rows do not survive the bump.
- Adaptive chain mutation v1 — a blocking unknown inserts one investigation step; an irrelevant-resolved unknown skips its declared target step; both audited on the terminal execution record (`nodes_inserted`/`nodes_skipped`) and capped per run (1 insertion per unknown id, 3 per run). The model only ever declares typed observations; the server owns every graph edit, in reaction to a declared observation only. Schema v23 — `chain_run_nodes` gains `origin`/`origin_unknown_id` provenance columns.

* agent-plugins migration, codex fleet integration, and brand system for 4.0.0 ([3d402fe](https://github.com/minipuft/claude-prompts-mcp/commit/3d402feaa6da083170b0c358c4ae9405d20ce1f3))
* **chains:** add per-run unknowns ledger via prompt_engine observations param ([0bdbfbe](https://github.com/minipuft/claude-prompts-mcp/commit/0bdbfbe24a41986c519dd56907d5ffaf022fce05))
* **chains:** add record-only per-run telemetry to execution_records ([2e84bb3](https://github.com/minipuft/claude-prompts-mcp/commit/2e84bb3cf809698bbb9044055f84b35777bc8ebd))
* **chains:** per-step visibility policy + step-scoped gate review (P5) ([c07a80c](https://github.com/minipuft/claude-prompts-mcp/commit/c07a80c13b953012946c7ced96ea09e6bbb354a6))
* **chains:** planner-submitted workflow IR compiled to ordinary chain runs ([56d8e26](https://github.com/minipuft/claude-prompts-mcp/commit/56d8e2630c361caaf340aefb263e9c50c22cabab))
* **chains:** stable node identity, per-row run storage, and adaptive mutation v1 ([951db98](https://github.com/minipuft/claude-prompts-mcp/commit/951db98da8999e9865f13f150eb8fe9839ad89ae))
* **ci:** publish server.json to the official MCP registry on every release ([5b9ca4b](https://github.com/minipuft/claude-prompts-mcp/commit/5b9ca4b394f6e807777671aeac08bccdffae4edd))
* **ci:** ship the new mark as the desktop extension icon ([b165014](https://github.com/minipuft/claude-prompts-mcp/commit/b165014b9ddafee972596afa996331016de12fda))
* **ci:** ship the new mark as the desktop extension icon ([d2ff78a](https://github.com/minipuft/claude-prompts-mcp/commit/d2ff78aa9d3044bde4d9c2c1b6c8e920c90bf435))
* **ci:** sync codex-prompts with the fleet on every release ([dcfc124](https://github.com/minipuft/claude-prompts-mcp/commit/dcfc124ef36a207b6dda09c4acea17f39c279f08))
* **docs:** pilot GitHub-native planning lifecycle ([237b0ca](https://github.com/minipuft/claude-prompts-mcp/commit/237b0ca6f91d6530696a7599716f746def781923))
* **docs:** promote the approved mascot into a canonical brand system ([de19f56](https://github.com/minipuft/claude-prompts-mcp/commit/de19f56052b276182241112651e46317253f2850))
* **execution:** publish the resolved shell-verify budget and correct force_restart ([d76f741](https://github.com/minipuft/claude-prompts-mcp/commit/d76f7414a8aadf1b5788f7abf5e02d7d46446b50))
* **gates:** add documentation governance gate suite ([0beda2d](https://github.com/minipuft/claude-prompts-mcp/commit/0beda2db7e3e505e0c8a89de4ba0cfb2150e3391))
* **hooks:** add hook-harness traced verification and registration dead-wiring detection ([b216289](https://github.com/minipuft/claude-prompts-mcp/commit/b2162896b31c880c7ffc4e94a37f50efbab57036))
* **main:** integrate unreleased 3.3.0 work ([c5a7813](https://github.com/minipuft/claude-prompts-mcp/commit/c5a7813ba21e4cb878a198c974bee4afe4a32c94))
* **main:** integrate unreleased 3.3.0 work ([#211](https://github.com/minipuft/claude-prompts-mcp/issues/211)) ([c5a7813](https://github.com/minipuft/claude-prompts-mcp/commit/c5a7813ba21e4cb878a198c974bee4afe4a32c94))
* **mcp-tools:** enforce confirm on prompt delete; remove the checkpoint resource type ([2c3b872](https://github.com/minipuft/claude-prompts-mcp/commit/2c3b872e717d424f3ae424cca57adde58dd62efe))
* **mcp-tools:** patch-mode prompt update, argument contract repair, ship-signal (P7 T1/T3/T4) ([1210977](https://github.com/minipuft/claude-prompts-mcp/commit/1210977f7538a12d4413a63eaabafbcf9190845a))
* **planning:** federate plan retirement ([621991a](https://github.com/minipuft/claude-prompts-mcp/commit/621991a7b50badd8d42d28fa36001a2095864cb5))
* **planning:** federate plan retirement ([9bd68db](https://github.com/minipuft/claude-prompts-mcp/commit/9bd68db64b21cf7a094174812da45b778f6b42a1))
* **planning:** federate plan retirement ([#209](https://github.com/minipuft/claude-prompts-mcp/issues/209)) ([621991a](https://github.com/minipuft/claude-prompts-mcp/commit/621991a7b50badd8d42d28fa36001a2095864cb5))
* **prompts:** per-step framework declaration; reject unknown chain-step keys ([0e8b787](https://github.com/minipuft/claude-prompts-mcp/commit/0e8b7875867ff5c843806056bbd08ac1c4fb0817))
* **resources:** add documentation governance prompt workflow ([5f2a1ae](https://github.com/minipuft/claude-prompts-mcp/commit/5f2a1aef8198c5d4ef312fe687e2bb3c1a49f3ea))
* **resources:** ship the planning/ prompt category (P7 OQ-P7-7, T5) ([15462ed](https://github.com/minipuft/claude-prompts-mcp/commit/15462ed52249fb341c30e77d15f0cf315e308d94))
* **scripts:** commit row 1.5's version registration and its manifest parity ([ce8b3d8](https://github.com/minipuft/claude-prompts-mcp/commit/ce8b3d8b0a2048df8b726a0e3c743622ce691d35))
* **scripts:** declare what each gate reads, and test the rewriter against the corpus ([e582adc](https://github.com/minipuft/claude-prompts-mcp/commit/e582adc08a49225e299a7498de072f749071b71e))
* **scripts:** fail when a validate/verify script is wired to nothing ([a295645](https://github.com/minipuft/claude-prompts-mcp/commit/a29564504229ac304ac2d771c2e651ca4e849356))
* **scripts:** gate framework coverage and the README's shipped-prompt count ([f90b024](https://github.com/minipuft/claude-prompts-mcp/commit/f90b0242d347a1f34220cf9365bf2ca58b799468))
* **scripts:** render the published manifests from the canonical tree ([c93034c](https://github.com/minipuft/claude-prompts-mcp/commit/c93034c59f4c7df305a2781a0617b41fcd1b37d1))
* **scripts:** require a gate declaring closedBy to audit its exceptions ([ee1478e](https://github.com/minipuft/claude-prompts-mcp/commit/ee1478ed3343e2236034d3297a1dfff05a11809f))
* **scripts:** ship no skills by default; gitignore the export output ([16b1a09](https://github.com/minipuft/claude-prompts-mcp/commit/16b1a09fd0ac9649a40a2f9610a8946ffcf3df11))
* **server:** commit row 1.4's agent-plugins skills-sync registration ([5f20ff9](https://github.com/minipuft/claude-prompts-mcp/commit/5f20ff9b499cdb6262959f1dff42c6bc7a6ee364))
* **server:** commit Tier 1's deliverables, which were never committed ([31e0638](https://github.com/minipuft/claude-prompts-mcp/commit/31e0638abc68e17dd27c391eb2d092ea58d217ed))

### Changed

- **BREAKING — `confirm: true` is now required to delete a prompt.** `resource_manager(resource_type: "prompt", action: "delete")` refuses without it and names the chains that would break. The parameter's schema text has always described it as delete's safety gate, but only `rollback` read it — the guard sat on the recoverable verb and was absent from the unrecoverable one. Deletion has no undo through the tool surface: a deleted prompt's `version_history` rows survive, but `rollback` reports "Prompt not found" once the prompt is gone, so those snapshots are unreachable by any action. Scripts calling delete must add `confirm: true`.
- **BREAKING — chain steps reject unknown keys.** `chainSteps` entries in prompt YAML are validated strictly; a key with no schema field now fails the prompt's load, naming the key and its step index, instead of being silently discarded. A typo like `framwork: ReACT` previously parsed to a normal-looking step and ran the chain under the wrong framework with no signal — the same silence left six `inlineGateIds` declarations dead across three shipped chains. Every key with a real consumer was declared first, including `delegation`, which no code in the prompt module reads but the skills-sync exporter reads straight off the YAML.
- Renovate hosted reruns now use a dry-run-first request script that verifies local/remote config parity, strict protected checks, full-SHA Actions enforcement, successful Renovate and Release Please checks on `main`, and the exact dashboard request marker before changing GitHub state. Automated lock maintenance retains Renovate's three-day npm resolution cutoff while treating the timestamp-less synthetic maintenance update as timestamp-optional, preventing a permanent `renovate/stability-days` block.

* **frameworks:** retire the pre-rename methodology back-compat folds ([05b6efc](https://github.com/minipuft/claude-prompts-mcp/commit/05b6efcb89bccc012a1fe0bc1f95f72ab80addee))
* **scripts:** port no-crosslayer-relative to dependency-cruiser and retire the guard ([3837b91](https://github.com/minipuft/claude-prompts-mcp/commit/3837b919bd938891d48a22ade6e082175c9c70e3))
* **scripts:** scope shipped-content gates by git, not filesystem walk ([8468c4a](https://github.com/minipuft/claude-prompts-mcp/commit/8468c4a23891b409feace816f30837c1de088c40))

### Removed

- **BREAKING — the `checkpoint` resource type is gone.** `resource_manager(resource_type: "checkpoint", ...)` and the `clear` action are removed from the tool surface, along with the `GitCheckpoint` module behind them. Every checkpoint action returned "Checkpoint manager is not available" under every configuration: the handler was defined and exported but never constructed, so a quarter of the published `resource_type` enum could not succeed. Reinstating it was rejected rather than deferred — the actions were `git stash push`/`pop`/`drop` wrappers, and exposing stash manipulation to a client silently discards uncommitted work belonging to anyone else sharing the working tree. Nothing depended on it, since no call could ever have returned success.
- **BREAKING — the pre-rename `methodology*` back-compat folds are retired.** The methodology→framework rename shipped in v3.0.0 with fold-forward support for the old spellings; those folds are now deleted. Six input spellings stop being accepted, and in every case but one they fail by silently falling back to the default rather than erroring:
  - framework YAML `methodologyGates:` → use `frameworkGates:`
  - gate YAML `pass_criteria.methodology:` → use `framework:`; and `type: methodology_compliance` → `framework_compliance` (this one throws at parse, being a closed enum)
  - `config.json` `gates.methodologyGates` → `gates.frameworkGates`; the top-level `methodologies:` section and `resources.methodologies` are no longer adopted into their `frameworks` equivalents
  - `resource_manager` authoring payload `methodology_gates` / `methodology_elements` → `framework_gates` / `framework_elements`
  - prompt-template placeholder `{METHODOLOGY}` → `{FRAMEWORK_TYPE}`
    Marked breaking because the framework/gate YAML schemas and `config.json` are declared API surface. Shipped in a minor by explicit maintainer decision — the pre-rename spellings have been unsupported since v3.0.0 (2026-07-31), and the only spelling measurably outside the declared contract was the `resource_manager` authoring payload. If you hold a workspace resource written before v3.0.0, rename the keys above before upgrading.

### Fixed

- **Version history now records what an edit produced, not what it replaced.** Version N holds the state edit N produced (go-forward numbering), so the newest version always equals what `inspect` shows; unrecorded prior state is bridged in automatically, rollback validates its target before writing anything, records the restored state as a new `Rollback to vN` row, and restores snapshots exactly — the old `snapshot ?? live` hybrid merge and the "Pre-rollback snapshot" rows are gone. A failed version save now aborts the update instead of logging and proceeding.
- **Tool schema stopped silently discarding argument fields.** The `arguments` items on prompt create/update now accept `required`, `defaultValue`, and `validation`, and `type` is the loader's 5-value enum — previously Zod stripped them at the first boundary while 45 shipped prompts declared `required: true`.
- **Chain step labels retired their stale phase vocabulary.** The implementation-planning chain's five `stepName` labels (and two prose references) now carry the sub-prompts' own `(Step N)` names instead of `(Phase N)` numbering that no longer exists.
- **Step-targeted gates now review only their target step.** A gate bound to a node id (or step number) previously entered the run-wide review accumulator, so a gate "on step 3" reviewed every step — targeting scoped guidance injection only. Review participation is now carried per-step (`reviewGateIds`), with untargeted gates keeping their run-wide inheritance and single-prompt runs byte-identical. The two residual fallback paths are also closed: a mutation-inserted node inherits its triggering unknown's target gates, and a skipped step triggers no review at all.
- **A step-level `subagentModel` now marks its step delegated on any chain invocation**, not only after a `==>` operator. `OperatorValidationStage` returned early on an empty operator set before delegation normalization ran; the direct (non-symbolic) `>>chain` path always has an empty operator set, so a YAML-declared `subagentModel` parsed but produced no delegation CTA or handoff envelope unless the command also spelled `==>`. Delegation normalization now runs before that exit. `agentType` alone still does not mark a step delegated — it only selects which agent a `==>`-delegated or `subagentModel`-marked step uses.
- **Handoff visibility (and the delegation CTA/envelope it feeds) is now resolved by node identity instead of array position.** `resolveHandoffVisibility` indexed the parsed step blueprint by `nextStepIndex`, so after an adaptive mutation inserted or skipped a node, the visibility declarations resolved belonged to the wrong step. The run's live next-node id is now asked for directly and matched back to the step it names; a `withhold` declared by a step the mutation policy retired (skipped) no longer applies to a step that does run. Runs with no mutation and chains with no declared node ids are unaffected.
- **Named outputs (`outputMapping`) now publish under a reserved `outputs.<name>` namespace** (`{{outputs.findings}}`) instead of a flat template key (`{{findings}}`), and are removed together with the rest of chain history when a step withholds `chain_history` — previously a withheld alias still leaked through because `stripChainHistory` could only delete regex-identifiable positional keys. `{{findings}}` is no longer published; existing authors must migrate to `{{outputs.findings}}`. No shipped chain declared `outputMapping` at the time of this change. Each key of `outputMapping` still receives the step's whole output — the declared value is not read (documented, not newly broken).

* **ci:** assert the codex-prompts marketplace entry, which nothing checked ([769b023](https://github.com/minipuft/claude-prompts-mcp/commit/769b023d8129e967290d5f7c09132c2943aeb0a0))
* **ci:** consume repository-standards v1.3.0 so retirement stops restyling docs ([4c6cde7](https://github.com/minipuft/claude-prompts-mcp/commit/4c6cde70a056dff34fe37942c8e1630ae11fe854))
* **ci:** consume repository-standards v1.3.0 so retirement stops restyling docs ([23af8b4](https://github.com/minipuft/claude-prompts-mcp/commit/23af8b40fd6acb3e91569eeb179df7b69d08b2d7))
* **ci:** make registry publish idempotent and fix the verify jq path ([b845930](https://github.com/minipuft/claude-prompts-mcp/commit/b84593084b727a3cc9d02648e2fb51567f8fae7e))
* **ci:** rebuild the marketplace source guard where it runs ([852830b](https://github.com/minipuft/claude-prompts-mcp/commit/852830baba9fc0ee5bde4f83d1decdeecb4ae93b))
* **ci:** ship package.json in the claude-code-plugin staging too ([edb037c](https://github.com/minipuft/claude-prompts-mcp/commit/edb037c727652e3b92f9cb55ef4dca170fa2cb69))
* **contracts:** anchor the gate operator's examples and gate registry self-consistency ([18d2f7a](https://github.com/minipuft/claude-prompts-mcp/commit/18d2f7a746c7d4bbd6644194c9fbcbbe8ed9db1a))
* **deps:** consume repository-standards v1.2.1 so retirement ignores sidecars ([93ebbe9](https://github.com/minipuft/claude-prompts-mcp/commit/93ebbe989a3a3a75359abf9beaf8bc7290436d10))
* **deps:** patch OTel advisories via 0.221.0 bump; retire stale protobufjs override ([b3f76b8](https://github.com/minipuft/claude-prompts-mcp/commit/b3f76b87d9888849c706c15ab69cbfdc8b53b147))
* **docs:** repoint dead cross-references in the retired plan set ([18fa3fe](https://github.com/minipuft/claude-prompts-mcp/commit/18fa3fe546cf3c3592ddb3df3bb600834b01c336))
* **execution:** resolve handoff visibility by node id, not array position (P6 T2, P4-F2/P6-F1) ([db966f8](https://github.com/minipuft/claude-prompts-mcp/commit/db966f8b35dbc1f9bc60452001a593477222f78a))
* **gates:** close the last two fallback-to-run-wide review paths (P5 4.4/4.5) ([b6cceb5](https://github.com/minipuft/claude-prompts-mcp/commit/b6cceb5eec1369cad26a4c6101ed3f52edac0775))
* **gates:** unref temporary gate expiry timers ([528647f](https://github.com/minipuft/claude-prompts-mcp/commit/528647f14bb3a86488a049db9debc2c6267084f2))
* **hooks:** delegation enforcement deadlock (mention-vs-use arming, gate sentinel, Agent tool clear) ([3073dfd](https://github.com/minipuft/claude-prompts-mcp/commit/3073dfd4eb4eb4bccb50e4a3636813a978b7d8b8))
* **parsers:** commit D3's remaining `^` sites, which never landed ([572789d](https://github.com/minipuft/claude-prompts-mcp/commit/572789d37ea9aaabe173ab9b673bc445adef5a62))
* **parsers:** commit the providers 8875ab42 left behind ([f54ab79](https://github.com/minipuft/claude-prompts-mcp/commit/f54ab7909a03805ca97aac8995298ffc0555cd4b))
* **parsers:** commit the reserved-operator rejection its tests already assert ([08dd126](https://github.com/minipuft/claude-prompts-mcp/commit/08dd126b6def4cf036d595841860468d901b172b))
* **parsers:** repair operator registry SSOT, unbreaking `^` in chains ([f2336ac](https://github.com/minipuft/claude-prompts-mcp/commit/f2336ac81dcce73c5104633e7c73e7624697de30))
* **pipeline:** make YAML delegation reachable on the direct chain path (P6 T1, P5-F5) ([a5097a5](https://github.com/minipuft/claude-prompts-mcp/commit/a5097a54faf98484e79abc893f366e9ca8bec4a8))
* **release:** accept Release Please manifest formatting ([a1c6333](https://github.com/minipuft/claude-prompts-mcp/commit/a1c6333be1deddbcd97e2e27811f03c1bd3032b3))
* **release:** accept Release Please manifest formatting ([0a8cb30](https://github.com/minipuft/claude-prompts-mcp/commit/0a8cb309f59ca7721dd512428742037a21bfd29a))
* **release:** synchronize Agent Plugins manifest ([9c4c088](https://github.com/minipuft/claude-prompts-mcp/commit/9c4c088612184c541ff40beb28ccc16686d4561b))
* **release:** synchronize Agent Plugins manifest ([4daf326](https://github.com/minipuft/claude-prompts-mcp/commit/4daf326d4329229a9e6a9c66896112994d3a38f2))
* **resources:** avoid methodology-vocab false positive in readme_improver ([3bf8c9a](https://github.com/minipuft/claude-prompts-mcp/commit/3bf8c9af3eb03f22afcba3c018aa3c02db9ff6b6))
* **resources:** retire methodology vocabulary from planning prompts ([d624481](https://github.com/minipuft/claude-prompts-mcp/commit/d624481afb7573ea7d90367c34a2d4b031c2aae3))
* **runtime:** apply preset timeouts, clear the loader cache on reload, reject reserved + in chains ([8875ab4](https://github.com/minipuft/claude-prompts-mcp/commit/8875ab4290d2dc6d7fd23dd74df9be1fa69f61cf))
* **runtime:** claim the SqliteEngine singleton at the composition root ([741afe5](https://github.com/minipuft/claude-prompts-mcp/commit/741afe52331b2a4e43d906289f1240050fcc10ec))
* **scripts:** allowlist tracked-scope.js in the vocabulary guard ([d1b03ea](https://github.com/minipuft/claude-prompts-mcp/commit/d1b03ea815df6fffcf3ab4bb1c1449c089061a2b))
* **scripts:** commit the two validate scripts a2956450 wired to nothing ([727f802](https://github.com/minipuft/claude-prompts-mcp/commit/727f80227c1c260b3173c9e820b43da399bddbd7))
* **scripts:** re-resolve the downstream lock with npm update, not npm install ([a6bfef8](https://github.com/minipuft/claude-prompts-mcp/commit/a6bfef88dd0f31590a03c0e9c051f98cc2ccb8d2))
* **scripts:** resolve build outputs in the agent-plugins consumes check ([b85f3fd](https://github.com/minipuft/claude-prompts-mcp/commit/b85f3fdcc69f4e53bded1eb4646bfc6e3f1d076b))
* **scripts:** scan the tracked set so the vocab guard can see dot-paths ([5af52f5](https://github.com/minipuft/claude-prompts-mcp/commit/5af52f5623852f4b172fff4b97683a6c232fd782))
* **scripts:** stop the plan-row self-test depending on where a real plan lives ([2e143f8](https://github.com/minipuft/claude-prompts-mcp/commit/2e143f8d50bf9bedb06f6febcadbc22d5707b8e4))
* **scripts:** stop the tests-typecheck ratchet reading a parse failure as a clean backlog ([8428e3e](https://github.com/minipuft/claude-prompts-mcp/commit/8428e3e468967cec85f9671a4f697d532bf18339))
* **scripts:** widen eslint ratchet target to scripts/ and eslint-rules/ ([1a96887](https://github.com/minipuft/claude-prompts-mcp/commit/1a968872cb42a24bb5aa5b7fa84b03148e891e34))
* **server:** repair injection continuation, nested-prompt ids, doubled banner literal ([2286bcb](https://github.com/minipuft/claude-prompts-mcp/commit/2286bcbf5297eb4ef84c6307b108ef0805920191))
* **server:** version history records what an edit produced, not what it replaced (P7 T2) ([08b001f](https://github.com/minipuft/claude-prompts-mcp/commit/08b001f2c2af20d37734a3066e45c6fc1527b232))

### Documentation

- **docs:** adaptive-chain-runtime master plan + P1 unknowns-ledger plan + staged P0 template ([1c87f4a](https://github.com/minipuft/claude-prompts-mcp/commit/1c87f4af3e7434527f13c920d26d825dbfafb12f))
- **docs:** add a square 512px icon derived from the logo for directory listings ([c874040](https://github.com/minipuft/claude-prompts-mcp/commit/c874040b5b7c3c5b767eebae296208fbe3b052ef))
- **docs:** add Tier 6 + Agent Plugins migration plan (single source tree, rendered distributions) ([713f520](https://github.com/minipuft/claude-prompts-mcp/commit/713f5203336866c541898b3c07498f2eb994e8d7))
- **docs:** bring Tier 2b current — registry+Smithery live, Glama claimed, PulseMCP baseline ([a6ca08b](https://github.com/minipuft/claude-prompts-mcp/commit/a6ca08ba81477bc7f52673e2dad5fe4127064c18))
- **docs:** close 0.5b Workstreams A/B/C, file the checkpoint finding as 0.5.26 ([ec73f85](https://github.com/minipuft/claude-prompts-mcp/commit/ec73f85e4d75c8afa50d42a391472b1ca41a45d4))
- **docs:** close 4.0.1, unblock 4.4, row the unmeasured install path ([13e2ba2](https://github.com/minipuft/claude-prompts-mcp/commit/13e2ba22500842e9d5a15918e2c01f7de19033b5))
- **docs:** close 4.10 by deletion, row the unvalidated marketplace PR path ([0328f21](https://github.com/minipuft/claude-prompts-mcp/commit/0328f21d95ca458318b862a616cd99b96967ada7))
- **docs:** close 4.4, ship 4.12's capability, record the 4.0.0 verification ([2a6e980](https://github.com/minipuft/claude-prompts-mcp/commit/2a6e980bdb157954b2f474aeaeb238b03459b461))
- **docs:** close 4.5, record shape A as implemented, row the last unobserved link ([584f6db](https://github.com/minipuft/claude-prompts-mcp/commit/584f6db29fb207eef80aef33b7214b3597a0f3a8))
- **docs:** close 4.8 from a live marketplace install, row same-name shadowing ([30f2207](https://github.com/minipuft/claude-prompts-mcp/commit/30f22078be4d3f27d49321dca73a5947e64988c2))
- **docs:** close all release gates — v3.2.1 finalized across every surface ([009d952](https://github.com/minipuft/claude-prompts-mcp/commit/009d952107e8ea3d0980cbf2126b48adbe3cf14a))
- **docs:** close E9/E10, file E11 — a ✓ did not mean committed ([37b012e](https://github.com/minipuft/claude-prompts-mcp/commit/37b012e4057518bcba8d32caf452a869f5725889))
- **docs:** close the push sequence, row the SIGPIPE flake ([6c1d213](https://github.com/minipuft/claude-prompts-mcp/commit/6c1d2134fb8a26e11daee1b07042f31261b939d0))
- **docs:** close the Renovate remediation plan — the canary merged itself ([3490711](https://github.com/minipuft/claude-prompts-mcp/commit/3490711d58964a97d9b622d7bb38f5e2b1b1a9bc))
- **docs:** close Tiers 2-3, mark the falsified premises ([c5405be](https://github.com/minipuft/claude-prompts-mcp/commit/c5405be5c7cf1dadb74690ad2f5c278a24230119))
- **docs:** close Tiers 5-6, apply the owner rulings ([0e9c3ef](https://github.com/minipuft/claude-prompts-mcp/commit/0e9c3efcaa0ae5baf2805233139ddce6a60f058a))
- **docs:** close Workstream D and E6, correct the D1/D3 site claims ([47636b0](https://github.com/minipuft/claude-prompts-mcp/commit/47636b0b63c901c9a1f91dbe1bd07addc2697a61))
- **docs:** confirm 4.5 — a git-sourced Codex install has no runtime ([84aa445](https://github.com/minipuft/claude-prompts-mcp/commit/84aa445b2981e8721d43e53e90934fabba922fe1))
- **docs:** correct the downstream consumption model ([a4e51ca](https://github.com/minipuft/claude-prompts-mcp/commit/a4e51cab14ced6f8354b35121f9ac9c2f4321336))
- **docs:** defer Tier 5 — Codex integration + rendered-distribution decision ([9f2922e](https://github.com/minipuft/claude-prompts-mcp/commit/9f2922e2d6734bb87e83871be512cd7e1eea587b))
- **docs:** documentation governance policy and client-install CTA correction ([4bb8955](https://github.com/minipuft/claude-prompts-mcp/commit/4bb89556256ef21aa68667a9650f7b49a3083b22))
- **docs:** file E8 for the two foreign validate:all reds ([7fcdc4e](https://github.com/minipuft/claude-prompts-mcp/commit/7fcdc4e5cfa2de995931038616cd8dfd21215f0a))
- **docs:** file E9/E10 — the committed state was six gates behind the tree ([6a3bab3](https://github.com/minipuft/claude-prompts-mcp/commit/6a3bab36394d77dce108dce4ee1d77c5ff3d22af))
- **docs:** finalize Tier 4 — close the shipping lane, name every open blocker ([d8c806f](https://github.com/minipuft/claude-prompts-mcp/commit/d8c806fe3ad3461d5a95b67ff308554d91c8e3d5))
- **docs:** flush the extension-icon findings to the deviation log ([7ff6fab](https://github.com/minipuft/claude-prompts-mcp/commit/7ff6fabeec9ffc096d68417e719a4e9d2b4ae489))
- **docs:** keep each retiring plan with its own deviation log ([b91a260](https://github.com/minipuft/claude-prompts-mcp/commit/b91a2606c327adef93e75876bedfd8a083b7d806))
- **docs:** link Workflow IR reference from docs index ([06d9630](https://github.com/minipuft/claude-prompts-mcp/commit/06d96303cfd001525bb554d9ed99ec32fd5c34f1))
- **docs:** mark the brand-asset plan finished ([b11624a](https://github.com/minipuft/claude-prompts-mcp/commit/b11624afbadb2657ce9bfdf10902ec6a8d41c1c1))
- **docs:** p1 live drive complete — success signal observed; p0 template applied ([0013955](https://github.com/minipuft/claude-prompts-mcp/commit/0013955aa4339100c6671b294a5dabad6d37758f))
- **docs:** patch mode, version semantics, visibility fields, ship-signal (P5/P7) ([7897f7e](https://github.com/minipuft/claude-prompts-mcp/commit/7897f7e7d3234ba86ad798c95f296719dfba58fa))
- **docs:** queue adaptive-chain-runtime plans for retirement at release ([c88ebb2](https://github.com/minipuft/claude-prompts-mcp/commit/c88ebb2b8e64f9b038d1f6691e5f60c1ba093a2f))
- **docs:** queue claims-conformance suite design (token-free functional validation) ([7dc83ae](https://github.com/minipuft/claude-prompts-mcp/commit/7dc83aebd3face038440dedd4c3e42ba9f6d50df))
- **docs:** record accepted-work lifecycle ([9232acd](https://github.com/minipuft/claude-prompts-mcp/commit/9232acdc920e947ceb4e1583ed82c75bbbfe6c98))
- **docs:** record Codex skill repair ([a9b4df1](https://github.com/minipuft/claude-prompts-mcp/commit/a9b4df142dea8b8feb6d9b48d716ac6bdd1f2279))
- **docs:** record commit-preparation verification trail on P6 companions ([1f2e8fb](https://github.com/minipuft/claude-prompts-mcp/commit/1f2e8fb732f6bb5babee1653f8a18a06af3a3d21))
- **docs:** record E7 — the gate that watched the wrong tree ([717e792](https://github.com/minipuft/claude-prompts-mcp/commit/717e7925e7827c6ff8d3a1c7784883ed03454952))
- **docs:** record final commit-preparation verification trail ([f6da764](https://github.com/minipuft/claude-prompts-mcp/commit/f6da7645b3d6b2c6b07460a9cde2bafa66800b2a))
- **docs:** record further commit-preparation verification trail ([ce07dc4](https://github.com/minipuft/claude-prompts-mcp/commit/ce07dc46db32790e4fe54f33de7db5f9568d6eef))
- **docs:** record GitHub Project rollout ([0481033](https://github.com/minipuft/claude-prompts-mcp/commit/048103302d94f301bb46c1f58a67c031c0b00674))
- **docs:** record HEAD verification runs in the implementation ledger ([ac07fd1](https://github.com/minipuft/claude-prompts-mcp/commit/ac07fd1b4232d15414ca0828c5a096cd5ef22540))
- **docs:** record orphan cleanup + nested-delete fix in p1 notes ([5e89d28](https://github.com/minipuft/claude-prompts-mcp/commit/5e89d2821a71be61654991cf8d05c6459f9fcaf7))
- **docs:** record p1 unknowns-ledger implementation notes + status writeback ([c809943](https://github.com/minipuft/claude-prompts-mcp/commit/c8099435837338c96eb56478977b04ed1c46706a))
- **docs:** record P5 compile-closure verification runs ([5ce70a7](https://github.com/minipuft/claude-prompts-mcp/commit/5ce70a7137edafb28f5cf072a5c9131a27bb4b78))
- **docs:** record p5/p6/p7 plan writebacks and implementation notes ([a2af74d](https://github.com/minipuft/claude-prompts-mcp/commit/a2af74dd11c7425c4256994895717f02800fcf1d))
- **docs:** record P6 plan writebacks + master-plan closure ([860af13](https://github.com/minipuft/claude-prompts-mcp/commit/860af13d074fe09b07d45be7b83b8ab16e510072))
- **docs:** record PR linkage fallback ([89d6cb2](https://github.com/minipuft/claude-prompts-mcp/commit/89d6cb2467610721dc645718e4b589e8f48c383e))
- **docs:** record sub-agent delegation contract plan ([ab8ded5](https://github.com/minipuft/claude-prompts-mcp/commit/ab8ded52b1e2b07230d8f52407d9cdf4f6f194a1))
- **docs:** record the auto-merge-on-major finding ([59f3c3d](https://github.com/minipuft/claude-prompts-mcp/commit/59f3c3d4504f99f91394d5a8f01cddcbc9f1cc15))
- **docs:** record the breaking bundle and close its plan rows ([82cf4cd](https://github.com/minipuft/claude-prompts-mcp/commit/82cf4cd58ade99d3503c32400a68484eda02fa82))
- **docs:** record the migration-exposed retirement defect and release validation ([fdc7ea0](https://github.com/minipuft/claude-prompts-mcp/commit/fdc7ea031b5474b22fb29edec99f56b7e447f72b))
- **docs:** record tiers 0.8-4.3, and what the probes got wrong ([4bc3b6b](https://github.com/minipuft/claude-prompts-mcp/commit/4bc3b6be134dfe3477068634a06cf5e5c38efab3))
- **docs:** retire codex-prompts-port and downstream-standards-federation plans to reference ([f011130](https://github.com/minipuft/claude-prompts-mcp/commit/f011130f6c9be842479dd6c4ba39f5f9ad16bf6c))
- **docs:** retire E8, flush the retirement deviations ([e8f84ef](https://github.com/minipuft/claude-prompts-mcp/commit/e8f84efc6f9d85245bc6a4d2c080305637cbc411))
- **docs:** retire the Renovate notes with their plan ([a61479f](https://github.com/minipuft/claude-prompts-mcp/commit/a61479f3be900008267f3361d115e83705f0b987))
- **docs:** retire the Renovate notes with their plan, not after it ([274a0de](https://github.com/minipuft/claude-prompts-mcp/commit/274a0def6e481a4cf634c01af3caaacc3bf11f01))
- **docs:** retire Tier 5 into Tier 6; draft step-10 awesome-claude-code form for owner ([2add00d](https://github.com/minipuft/claude-prompts-mcp/commit/2add00dfaacb64175258b4594f782f645fdbb726))
- **docs:** row the codex distribution shapes, flag the same risk in gemini ([fec8a60](https://github.com/minipuft/claude-prompts-mcp/commit/fec8a60f41dca2b830e4828bb31ccfab10f6d242))
- **docs:** row the npm ruling and the codex staleness before Tier 4 ([27cb02a](https://github.com/minipuft/claude-prompts-mcp/commit/27cb02a719e4270187a10b0c4d29e48d04f7b7fd))
- **docs:** row the release-time sync, correct what joining the fleet costs ([f850cd7](https://github.com/minipuft/claude-prompts-mcp/commit/f850cd73a0efc8f933a6f9d1d0d7ec6300e4825d))
- **docs:** shipped prompt count 27 -&gt; 28 ([5862564](https://github.com/minipuft/claude-prompts-mcp/commit/586256494f39bd13bb4cd1d9383a18680c06bade))
- **docs:** stamp the open planning rows, log the release-readiness sweep ([26352a9](https://github.com/minipuft/claude-prompts-mcp/commit/26352a98ccfa72610d3609fc6fcec5e4384ac179))
- **docs:** state the resource:// opt-in, correct the prompt count, close Tier 0.5 ([1044afd](https://github.com/minipuft/claude-prompts-mcp/commit/1044afd5297d4a9b7dbabc74cefe2ab241450894))
- **docs:** track the brand-asset plan and close its acquisition-recovery row ([faf69ae](https://github.com/minipuft/claude-prompts-mcp/commit/faf69ae13a6c378eecab5970dda796377e83531f))
- **docs:** workflow IR reference + chain docs lockstep + CHANGELOG ([af4a8c5](https://github.com/minipuft/claude-prompts-mcp/commit/af4a8c5dcdcc8a7818e16369b45b36f87547c0ff))
- **planning:** bind retirement plan to issue 210 ([b2fb2de](https://github.com/minipuft/claude-prompts-mcp/commit/b2fb2de290ee30b91689614f5f16a1023cfb241a))
- **planning:** record GitHub lifecycle linkage ([af83915](https://github.com/minipuft/claude-prompts-mcp/commit/af83915a126954c1f6bf785d7eaba6a246d781d5))
- **planning:** record isolated review handoff ([5d42f97](https://github.com/minipuft/claude-prompts-mcp/commit/5d42f973afd0530a6ffdecf00f4bbe5e0709f9e0))
- **planning:** record mainline delivery linkage ([384c76c](https://github.com/minipuft/claude-prompts-mcp/commit/384c76cf193ec9c1c63c39af63a9b3061070cda9))

### ⚠ BREAKING CHANGES

- **prompts:** chain steps are validated strictly. A key with no schema field now fails the prompt's load, naming the key and its step index, instead of being silently discarded.
- **mcp-tools:** `resource_manager(resource_type: "prompt", action: "delete")` now requires `confirm: true`, and the `checkpoint` resource type and `clear` action are removed from the tool surface.

### Maintenance

- **release:** target 3.3.0 ([91d7bc1](https://github.com/minipuft/claude-prompts-mcp/commit/91d7bc1819893c6de24c951e0927258c041117d5))
- target 4.0.0 for the breaking release ([2d00cd6](https://github.com/minipuft/claude-prompts-mcp/commit/2d00cd641fcbd18e6931d4b0ac8d22cd3d0ab0e6))

## [Unreleased]

## [3.2.1](https://github.com/minipuft/claude-prompts-mcp/compare/v3.2.0...v3.2.1) (2026-08-07)

### Fixed

- **ci:** ship package.json in the plugin dist layout; patch protobufjs to 8.7.1 ([655f324](https://github.com/minipuft/claude-prompts-mcp/commit/655f324b7a002778237aac2a706b4c79fe3e1249))

## [3.2.0](https://github.com/minipuft/claude-prompts-mcp/compare/v3.1.1...v3.2.0) (2026-08-07)

### Added

- **Codex CLI support seams:** generic `PLUGIN_ROOT` workspace resolution, a `codex exec` spawn strategy (`SpawnConfig.client` + `CodexModelStrategy`), and a codex skills-sync registration — consumed by the new [codex-prompts](https://github.com/minipuft/codex-prompts) downstream plugin.

* **chains:** let a prompt choose which subagent its delegated steps spawn ([8a4c066](https://github.com/minipuft/claude-prompts-mcp/commit/8a4c0660aabd728af0f72ccb67ef49a2c7a4646f))
* **ci:** retire finished plans at release and gate the misclassification ([15a71d4](https://github.com/minipuft/claude-prompts-mcp/commit/15a71d404d4d53420802c66b73eb5a030f0c85dc))
* **hooks:** add the codex client seams to the shared hook library ([98e7f4e](https://github.com/minipuft/claude-prompts-mcp/commit/98e7f4e8871a4c3b31ef40f437a7735e914bf30d))
* **hooks:** require every shipped hook to be registered, and retire session-skills ([e6c19eb](https://github.com/minipuft/claude-prompts-mcp/commit/e6c19eba0a1176191df4e1fd6852607768429d84))
* **mcp-tools:** build the prompt_engine surface from state and take gate verdicts structurally ([d27bafa](https://github.com/minipuft/claude-prompts-mcp/commit/d27bafaa8584bf9374f9777fb65124df73b95ee4))
* **runtime:** reject the removed sse transport instead of substituting one ([21d715f](https://github.com/minipuft/claude-prompts-mcp/commit/21d715ff1585aca823682a60e0a268e0978c0633))
* **runtime:** serve both protocol eras over STDIO and route list-change events ([96957d2](https://github.com/minipuft/claude-prompts-mcp/commit/96957d2f7090500dd2662a388981f1312cedc580))
* **runtime:** serve MCP protocol revision 2026-07-28 over stateless HTTP ([d1400b9](https://github.com/minipuft/claude-prompts-mcp/commit/d1400b98329da9fad54999011bc547d2b66c7fe2))
* **scripts:** detect state fields that have readers and no writers ([9b3d1fc](https://github.com/minipuft/claude-prompts-mcp/commit/9b3d1fcfc82a27d7d7e92b885daafa6ef330bc86))
* **scripts:** give the one-time durable exclusion a retirement condition ([36ff257](https://github.com/minipuft/claude-prompts-mcp/commit/36ff2576fd1d11425d94f9fdd29e69c745c59dfd))
* **scripts:** sort finished plans out of the working set by status ([8504088](https://github.com/minipuft/claude-prompts-mcp/commit/850408899c9b69b9da456abfff1fade12f6139e0))

### Changed

- **The `analysis` config section is deprecated, and no longer settable from either tool surface.** A `config.json` carrying it **still loads with its values intact** — the section is parsed and ignored for one deprecation cycle, and the server now warns once at startup naming the replacement. What is withdrawn is the ability to _set_ it: `cpm enable analysis` reports `Unknown subsystem`, and both `cpm config set` and `system_control config` reject the five `analysis.semanticAnalysis.…` keys. Scripts that set them were previously writing values no runtime path read; they now receive a non-zero exit instead of a silent no-op. Delete the `analysis` section to silence the warning. The section itself is removed in the next major.
- **`llm_self_check` gate criteria no longer consult configuration.** The reserved type is unchanged in the gate YAML schema and still auto-passes, so gates declaring it are unaffected. Its skip message previously told the reader to enable a config key that no longer exists; it now names `%judge` and `shell_verify`.
- **Prompt analysis feedback is no longer suppressed by a disabled flag.** `resource_manager` prompt create/update responses previously printed `⚠️ API Analysis Disabled` and withheld gate suggestions whenever the LLM flag was off — which was every installation, since it defaults off. The underlying analysis is rule-based and needs no model, and a sibling code path already ran it ungated, so the suggestions now always appear.

* **chains:** give the chain run-identifier format one owner ([f4ad2a1](https://github.com/minipuft/claude-prompts-mcp/commit/f4ad2a182e60001f44cf88a509ae60819a25433e))
* **chains:** rename tenant_id to run_owner_pid and repair the view that never read it ([a0dc36f](https://github.com/minipuft/claude-prompts-mcp/commit/a0dc36f261763efa2ad23a7264d5534aa3745b76))
* **execution:** drop six ConvertedPrompt fields no producer ever set ([d66356a](https://github.com/minipuft/claude-prompts-mcp/commit/d66356aece725569627b536eaaafb55a0a82de07))
* **execution:** give auto-approve partitioning to the filter that already partitions ([15270fd](https://github.com/minipuft/claude-prompts-mcp/commit/15270fd045668af006c434223498127646ea5bcb))
* **gates:** delete the gate retry re-entry API, which had no callers ([7a43f99](https://github.com/minipuft/claude-prompts-mcp/commit/7a43f996d4d822391d8f271bcf0a253c82198a71))
* **gates:** delete the unreachable enforcement-decision cache ([335a8b6](https://github.com/minipuft/claude-prompts-mcp/commit/335a8b6801431804b724c8321d16bd3e97c47f8a))
* **gates:** move the shell-verify clearing decision to its owner module ([20b795e](https://github.com/minipuft/claude-prompts-mcp/commit/20b795e7364032e8658d2b5a675c22ca00c238b6))
* **mcp-tools:** delete the dead ContextBuilder rather than consolidate it ([05ab145](https://github.com/minipuft/claude-prompts-mcp/commit/05ab145e26b6fda7b4aaccb3f0add62085806922))
* **pipeline:** delete the two judge-selection channels that never had a producer ([76630b7](https://github.com/minipuft/claude-prompts-mcp/commit/76630b735f6ac8dd7df5a43c2fb7633e355de2cb))
* **pipeline:** extract execution metric payload derivation ([b840472](https://github.com/minipuft/claude-prompts-mcp/commit/b84047203d3ff0b3aefe0df30775608899bc3fc7))
* **pipeline:** move framework-requirement predicates out of the stage ([a25aaf2](https://github.com/minipuft/claude-prompts-mcp/commit/a25aaf256395c20ab04bab7ed0327a9ac504ffde))
* **pipeline:** stop deriving the framework requirement twice ([6479ab1](https://github.com/minipuft/claude-prompts-mcp/commit/6479ab155fbdba62ab16f924ec685142d0487901))
* **runtime:** express the version_history cleanup as a schema bump, not resident code ([92b1dcd](https://github.com/minipuft/claude-prompts-mcp/commit/92b1dcda8b7053bbbb1ec5ca9c760cf3da26e8a8))
* **runtime:** extract list-change routing and cover both transports ([0f5437f](https://github.com/minipuft/claude-prompts-mcp/commit/0f5437f6b3f912d3fd447bfd052510f138f602c9))
* **scripts:** retire four guards, re-home them, and share one definition of a live exception ([c4b920b](https://github.com/minipuft/claude-prompts-mcp/commit/c4b920ba1ce8b885e5d6689d6dbed34225740392))
* **server:** delete 11 unreachable types and the analyzer's unread config ([558e4dc](https://github.com/minipuft/claude-prompts-mcp/commit/558e4dc8c8864f5c19e5b1e2606b73ff34934aa1))
* **server:** delete the last nine unreachable types in shared/types ([675095f](https://github.com/minipuft/claude-prompts-mcp/commit/675095fa5ff9389b25e2a923f5cc10fc16f327bc))
* **server:** remove the 76 dead symbols the unused-locals sweep reported ([31dd755](https://github.com/minipuft/claude-prompts-mcp/commit/31dd7555f39c1d72e675ad7ec3410ac172c38798))
* **server:** retire the semantic LLM side client, which never ran here ([d219f8b](https://github.com/minipuft/claude-prompts-mcp/commit/d219f8b75a982669142d301cae0512c272415ce3))

### Removed

- **The semantic LLM side client is gone** — roughly 2,200 lines across an outbound provider client (`LLMClient` + factory), the gate service that consumed it, the dual-mode analyzer's model branch, and an 863-line framework-integration module that was never constructed. None of it ever ran: it was reachable only when `analysis.semanticAnalysis.llmIntegration.enabled` was true, that flag defaults to `false`, and the only spelling the CLI ever wrote (`…llmIntegration.mode`) reached no reader. Model-graded gate review is served by [judge mode](docs/guides/judge-mode.md) — the `%judge` modifier and `gates.evaluation.defaultMode` — which delegates to the client's own sub-agent and returns through `gate_verdict`, so no API key is configured, stored, or sent anywhere.
- **The undocumented `MCP_LLM_*` environment variables** (`MCP_LLM_ENABLED`, `_API_KEY`, `_ENDPOINT`, `_MODEL`, `_MAX_TOKENS`, `_TEMPERATURE`). They were never listed in the declared environment surface.

### Fixed

- **Codex prompt resource activation:** the downstream launcher now reads a persistent user-level resource path while keeping mutable MCP state under the OS temporary runtime root; the curated 26-prompt package catalog remains the default.
- **Structured gate verdicts are now hook-enforced:** `hooks/gate-enforce.py` crashed on the object form of `gate_verdict` (the schema-preferred shape); because hook failures are fail-open, object verdicts were never gate-enforced on any client. Surfaced by the codex-prompts port's live E2E.
- **The state database is now closed on shutdown, and its write-ahead log checkpointed.** Nothing ever called `SqliteEngine.shutdown()`, so the WAL was never checkpointed and grew across every restart — measured at 4.2 MB against a 598 KB database, truncated to 0 by a clean shutdown. The close runs last, after every subsystem that may still write on its way down.
- **The execution ledger grew without bound.** `execution_records` had no `DELETE` anywhere and declared its retention as "unbounded-justified" with a rationale reading `PLACEHOLDER`, while `state.db` is shared across every project on the machine. Row caps are now declared per table and enforced at startup, and the resource-change log trims through the same shared implementation instead of its own inlined `DELETE` against a config value that could disagree with the declared cap.
- **The `tenants` table is gone** (schema v19). It held one seeded row, had no reader outside tests that inserted into it to prove it existed, and nothing referenced it — `tenant_id` elsewhere is a plain column, never a foreign key.
- **The `cpm` CLI could leave the MCP server unable to start.** Version-history commands reached `state.db` through an embedded Python sqlite3 helper carrying its own `CREATE TABLE`, whose shape predated the workspace-isolation columns. Running the CLI before the server's first start created `version_history` without those columns, and the server then failed to boot with `no such column: workspace_id`. The CLI now uses `node:sqlite` directly, resolves the same workspace scope the server does — they previously wrote history under different tenants and could not see each other's versions — and no longer creates any schema.
- **Database initialization failures now fail startup instead of degrading silently.** A configured database that failed to open was logged at `warn` and swallowed at three startup wiring sites, so the server reported a clean start while running with no audit trail, no argument history, and an inert version-rollback feature. A failed resource-index resync during hot-reload likewise no longer reports "completed successfully".
- **Codex plugin runtime:** plugin launch no longer depends on Claude root interpolation, and mutable SQLite/log output can be routed to a sandbox-writable runtime root without moving bundled resources.

* **ci:** make plan retirement self-contained and record why it runs on the PR ([cbdfeae](https://github.com/minipuft/claude-prompts-mcp/commit/cbdfeae1c09279e7e53c39770874f8e9213661d2))
* **ci:** point downstream sync PR bodies at the renamed upstream repo ([410acb7](https://github.com/minipuft/claude-prompts-mcp/commit/410acb7b5e039ef21eb0ebac5f8367c8e13648c7))
* **ci:** re-add formatted staged files with -f in pre-commit ([59dc266](https://github.com/minipuft/claude-prompts-mcp/commit/59dc266e3c4a832e8830fa190c8afe6da56ea237))
* **config:** stop gitignoring the project rules the comment says to track ([7dc9b15](https://github.com/minipuft/claude-prompts-mcp/commit/7dc9b15d598458d948eedf5e29e0a234f32fd95f))
* **deps:** close the Dependabot set — override tmp to 0.2.x, plan Tier 4 triage ([8381c0a](https://github.com/minipuft/claude-prompts-mcp/commit/8381c0a655614d217a992e91b9759985be411495))
* **gates:** correct the workflow-preflight source, not its compiled output ([163a58a](https://github.com/minipuft/claude-prompts-mcp/commit/163a58afb3809994e7a421096637b32641ce5603))
* **hooks:** enforce the structured gate_verdict shape gate-enforce claims to check ([a5d1b60](https://github.com/minipuft/claude-prompts-mcp/commit/a5d1b60f6b49011dc111a4f1e007c400b492c16a))
* **prompts:** drop the undocumented gates alias on prompt update ([0e7f857](https://github.com/minipuft/claude-prompts-mcp/commit/0e7f857640f10e30655f17012712d31a3ecc1384))
* **runtime:** scope every state.db writer, then delete the backfill migration ([378b0bf](https://github.com/minipuft/claude-prompts-mcp/commit/378b0bf8c77e99a4a2a95afad44c014cee4f7f8f))
* **scripts:** close the root package.json version drift channel ([b753038](https://github.com/minipuft/claude-prompts-mcp/commit/b75303894e4e51a20e9a4d021b22e08345a20747))
* **scripts:** read script flags as ground truth, not just the two parser tables ([6ebc998](https://github.com/minipuft/claude-prompts-mcp/commit/6ebc998d9aaef3ec1fe94cca776b6c661a639fde))
* **server:** bound the execution ledger and drop the dead tenants table ([821e2af](https://github.com/minipuft/claude-prompts-mcp/commit/821e2af336006bf0ce0d14b5038e6ce146d252f5))
* **server:** close the database on shutdown and fail loudly on init failure ([fae1f55](https://github.com/minipuft/claude-prompts-mcp/commit/fae1f55af2df584ab57faee4b929344f027a4d25))
* **server:** stop the CLI creating state.db schema, which blocked server startup ([2d83827](https://github.com/minipuft/claude-prompts-mcp/commit/2d83827675e5667fedd654d7a188cdb39d2e133a))

### Documentation

- **docs:** add plan-board frontmatter to the pipeline follow-up plan ([453dfe1](https://github.com/minipuft/claude-prompts-mcp/commit/453dfe1ed223d63bae19992995cc30283845720c))
- **docs:** add the G4 CI run log to the implementation notes ([2e2c9da](https://github.com/minipuft/claude-prompts-mcp/commit/2e2c9da4715f93d6337003da80f397be22e838dd))
- **docs:** add the implementation notes both plans should have had ([bdadea3](https://github.com/minipuft/claude-prompts-mcp/commit/bdadea3efac40da2faca06e30386739d9ee86d28))
- **docs:** bring Tier 2b statuses current — pushes done, main merge is the sole gate ([9fc2a2f](https://github.com/minipuft/claude-prompts-mcp/commit/9fc2a2f1a6761a0c773d6003f37431394d0eaa93))
- **docs:** close out the sidecar retirement plan and carry its open findings ([a59d58c](https://github.com/minipuft/claude-prompts-mcp/commit/a59d58c30937fcf1df87521204cce3a1e28df9f5))
- **docs:** close the implementation_plan prompt defect, and correct my own report of it ([ba975e5](https://github.com/minipuft/claude-prompts-mcp/commit/ba975e5cdc045c70ef023dc4d006c29019396504))
- **docs:** commit the plan-frontmatter rollout and apply the done/reference test ([ba366cd](https://github.com/minipuft/claude-prompts-mcp/commit/ba366cdfb2bbac83c6cbe78f4283be1d656f5c11))
- **docs:** correct F4's delivery model — it targeted repos with no plans ([a3cdc88](https://github.com/minipuft/claude-prompts-mcp/commit/a3cdc882d33e69e07d0e49ef9a40ccf9a9b7971c))
- **docs:** drop legacy smithery.yaml — Smithery now takes the MCPB release artifact ([e223088](https://github.com/minipuft/claude-prompts-mcp/commit/e22308866d5ac2e824dc9639fb0eb4614c5cc5ba))
- **docs:** file Tier F5 — the MCP surface verifier runs in no workflow ([06ed8c3](https://github.com/minipuft/claude-prompts-mcp/commit/06ed8c3861a045cc7b223643d3f52670814de3e4))
- **docs:** file Tiers 15-16 for the work Tiers 10 and 12 deferred ([251aa67](https://github.com/minipuft/claude-prompts-mcp/commit/251aa67f0467f64b4e11cadf7531e7b5f36219b4))
- **docs:** finalize the SQLite remediation plan against measured outcomes ([8bb5555](https://github.com/minipuft/claude-prompts-mcp/commit/8bb5555bf66a00fe1a956537c808411717d8a3e4))
- **docs:** format the plan my frontmatter rollout left unformatted ([5dbf017](https://github.com/minipuft/claude-prompts-mcp/commit/5dbf0179ac34e418c944d043351ac135193a5973))
- **docs:** log G2 execution deviations in the implementation notes ([9059d07](https://github.com/minipuft/claude-prompts-mcp/commit/9059d0700c08ef023669fa67e8d35c2b778535cd))
- **docs:** log the tool-schema snapshot recapture in the implementation notes ([a2db54c](https://github.com/minipuft/claude-prompts-mcp/commit/a2db54cf39124dbfd2a266abb3b87888d13392d6))
- **docs:** make the retirement script publishable and file the federation tier ([f6de2ec](https://github.com/minipuft/claude-prompts-mcp/commit/f6de2ecace7f6360435842770adaef35b4412c98))
- **docs:** mark F9 and F11 resolved where a reader actually looks ([50954b1](https://github.com/minipuft/claude-prompts-mcp/commit/50954b1ebbdf9bc6eec1d3cd9b02553382239364))
- **docs:** mark tier completion where it is scannable, and correct F14 twice ([a8f1ba3](https://github.com/minipuft/claude-prompts-mcp/commit/a8f1ba348b1b4d69d7f33390bbead000cf001099))
- **docs:** rebrand to Wolfflow — rename repo references, README identity, plan records ([9d9eeb4](https://github.com/minipuft/claude-prompts-mcp/commit/9d9eeb44915950e9aec2dd43d81a3aa3e53fffea))
- **docs:** reclaim the -mcp repo suffix; prepare registry integration files ([8506b76](https://github.com/minipuft/claude-prompts-mcp/commit/8506b76bdbf5700cc9f62331d0fb18f2ec30a5c7))
- **docs:** reconcile the SSE references left behind by the transport removal ([ffcdc95](https://github.com/minipuft/claude-prompts-mcp/commit/ffcdc959ae6b6a796b8ec11abae8f3882c326276))
- **docs:** record the codex port -- alignment rule, changelog, plan + notes ([75960b3](https://github.com/minipuft/claude-prompts-mcp/commit/75960b395471d01c04acef853eda1caee918e528))
- **docs:** record the Tier 8 stage domain-ownership review and scope Tiers 11-14 ([bb9fdb6](https://github.com/minipuft/claude-prompts-mcp/commit/bb9fdb6fa3290945b05224633ce332905f569455))
- **docs:** record Tier F5 execution — three plan premises corrected ([1df409a](https://github.com/minipuft/claude-prompts-mcp/commit/1df409adeda0695e4c3e7de3f140a406bf6e62e5))
- **docs:** record where the validation-mechanism work landed, and why it is three commits ([1bbc304](https://github.com/minipuft/claude-prompts-mcp/commit/1bbc30485e904894a5c18c61ae625b30eaae6803))
- **docs:** revert Wolfflow branding to Claude Prompts; align README with MCP-ecosystem conventions ([848f7db](https://github.com/minipuft/claude-prompts-mcp/commit/848f7dbacf48864c982408ea38a0c8d1365b66f6))
- **docs:** scope the Python hook contract to the durable surface ([774252f](https://github.com/minipuft/claude-prompts-mcp/commit/774252f77ef7fd2bf1cdc9ad24edaabd37e43548))
- **docs:** strip trailing whitespace that fails the PR-range hygiene check ([e0d3255](https://github.com/minipuft/claude-prompts-mcp/commit/e0d325571afca81b51f7fec26d6b34266d17e840))
- **mcp-tools:** use the framework vocabulary in the gate-veto comment ([9133654](https://github.com/minipuft/claude-prompts-mcp/commit/91336540a1195b9cd7bfbb9ec162bd9b407ebd3b))
- **scripts:** cite the plan convention at a path every consumer can reach ([06ef228](https://github.com/minipuft/claude-prompts-mcp/commit/06ef228e6389a2828b287f770cc6922744dbabf8))

### ⚠ BREAKING CHANGES

- **chains:** schema v20 renames chain_sessions.tenant_id and chain_run_registry.tenant_id to run_owner_pid, and drops `lifecycle` from v_execution_status. Both tables are derived/ephemeral and are dropped by the bump, so no data migrates.
- **runtime:** `--transport=sse` and `transport: "sse"` in config.json are rejected at startup rather than silently resolved to another transport. Use `streamable-http`.
- **runtime:** The deprecated HTTP+SSE transport is removed; use `--transport=streamable-http`. The Streamable HTTP transport no longer issues or requires an `Mcp-Session-Id` header.

### Maintenance

- **server:** pin the next release to 3.2.0 ([e709a1c](https://github.com/minipuft/claude-prompts-mcp/commit/e709a1cd9f8eb97ce4ae7b1eab9a31b43a65d6ae))

## [3.1.1](https://github.com/minipuft/claude-prompts/compare/v3.1.0...v3.1.1) (2026-08-03)

### Fixed

- **deps:** defer CLI TypeScript 6 migration ([#193](https://github.com/minipuft/claude-prompts/issues/193)) ([aef8e5e](https://github.com/minipuft/claude-prompts/commit/aef8e5ef1b07654984feede76abe556e99e138ae))
- **deps:** defer TypeScript 7 migration ([#190](https://github.com/minipuft/claude-prompts/issues/190)) ([04a9931](https://github.com/minipuft/claude-prompts/commit/04a9931d691214e8a0d6e0f47d60014495b58aff))
- **deps:** update server runtime dependencies to ^0.221.0 ([#184](https://github.com/minipuft/claude-prompts/issues/184)) ([b848ae6](https://github.com/minipuft/claude-prompts/commit/b848ae68b0bf6f31c0d6aba66e780b474ba0382d))

## [3.1.0](https://github.com/minipuft/claude-prompts/compare/v3.0.2...v3.1.0) (2026-08-03)

### Added

- **frameworks:** make the default framework config-declarable per project ([8b948fb](https://github.com/minipuft/claude-prompts/commit/8b948fbc78fbd8cf1fd92f45405e17419e59b009))
- **frameworks:** scope framework state per project ([905c926](https://github.com/minipuft/claude-prompts/commit/905c92614eac6896cfb74fa1746b63116123902a))

### Changed

- **Dependency delivery contract:** Renovate now preserves semantic release types, validates extraction, uses the committed MCPB resolution path, and limits future automerge to observed low-risk development updates.
- **Supply-chain controls:** GitHub Actions use immutable full commit SHAs with readable release comments, backed by a repository validator.
- **Runtime support:** The server and desktop extension require Node.js >=22.13.0; server CI covers 22.13.0 and 24, the standalone CPM CLI remains >=18.18.0, and local/publish tooling uses Node 24.
- **MCP SDK v2 and protocol revision 2026-07-28:** Migrated to the scoped `@modelcontextprotocol/*` v2 packages. One build serves both protocol eras — a 2026-07-28 client (no `initialize` handshake, per-request `_meta` envelope) and a 2025-era client are answered over both STDIO and Streamable HTTP.
- **Stateless HTTP:** Protocol sessions are gone. A fresh server instance is built per HTTP request; no `Mcp-Session-Id` is minted and requests carrying a stale one are served normally. Chain state is unaffected — it was always keyed by this project's own run handles (`chain_id`), not by protocol sessions.
- **`prompt_engine` parameter surface is derived from runtime state:** `gates`, `gate_verdict`, and `gate_action` are advertised only while the gate system is enabled, since the runtime ignores gate input from every source when it is off. The declared contract is the **union** of all reachable shapes, so narrowing within it is not a breaking change.
- **Structured gate verdicts:** `gate_verdict` now accepts `{overall, rationale, per_gate[]}` in addition to the `"GATE_REVIEW: PASS - reason"` string. The object is schema-validated, so it cannot be submitted malformed; the string form is read back by regex and can fail to parse. Rationales are single-line. The string branch is retained for existing clients and is scheduled for removal.

### Removed

- **The deprecated HTTP+SSE transport.** SDK v2 no longer ships `SSEServerTransport`, so keeping it would have meant hand-maintaining a transport upstream had deleted. **`--transport=sse` now exits with an error** naming `streamable-http` rather than falling back to the configured default — the previous fallback started the server on a transport nobody asked for and reported success. The same check applies to `transport` in `config.json`. Streamable HTTP still uses `text/event-stream` framing for responses; only the separate transport is gone.
- The protocol session registry, together with the session-attachment failure path it required.

* **ci:** route validation by change impact ([#183](https://github.com/minipuft/claude-prompts/issues/183)) ([c7509c2](https://github.com/minipuft/claude-prompts/commit/c7509c2b56e9266d9ac0c70dd8f2c89f6e3f3f19))
* **frameworks:** route fallback defaults through DEFAULT_FRAMEWORK_ID ([b41adc4](https://github.com/minipuft/claude-prompts/commit/b41adc438cd577e22663550c1055747f8fce761a))
* **mcp-tools:** drop dead wiring from the tool constructor seams ([6642c04](https://github.com/minipuft/claude-prompts/commit/6642c049586b6ac7990fa5b133c6d0f080de4e39))
* **pipeline:** construct the pipeline from an ordered stage array ([094baec](https://github.com/minipuft/claude-prompts/commit/094baec62523e99ae86f73191661696e81917f95))
* **pipeline:** delete DependencyInjectionStage and the metadata bag ([af8401a](https://github.com/minipuft/claude-prompts/commit/af8401ada25dea7e827a9409647a127f1d43d21a))
* **pipeline:** drain the execution context metadata bag to one key ([b29dff2](https://github.com/minipuft/claude-prompts/commit/b29dff2b422252695d56d54b45a682d29687be0f))
* **pipeline:** renumber the 22 stage files to execution order ([467ee5a](https://github.com/minipuft/claude-prompts/commit/467ee5a45bb0d4293907f8267258bae1900b26b4))
* **server:** land finalized pipeline and framework remediation ([67e905e](https://github.com/minipuft/claude-prompts/commit/67e905e49f2bfc8b045b7aa787738e70496fe75e))
* **server:** type McpToolRouter's mcpServer as McpServer ([2ddd763](https://github.com/minipuft/claude-prompts/commit/2ddd763fc46977631633b62572d31c2fa19fb67d))
* **server:** type TransportRouter's mcpServer as McpServer ([4feaab2](https://github.com/minipuft/claude-prompts/commit/4feaab29e93698eb24865f7dc924db48f4288eaa))

### Fixed

- **ci:** allow Renovate validator to inspect updates ([#179](https://github.com/minipuft/claude-prompts/pull/179)) ([927a816](https://github.com/minipuft/claude-prompts/commit/927a816e4ae27784cc0dffc017d8309d339d1cf6))
- **deps:** align Renovate with delivery contracts ([#177](https://github.com/minipuft/claude-prompts/pull/177)) ([6ac5e87](https://github.com/minipuft/claude-prompts/commit/6ac5e87338a815ae16d1d575e280058c3d613adf))
- **deps:** enforce Renovate release-age gate ([#187](https://github.com/minipuft/claude-prompts/pull/187)) ([c091bbf](https://github.com/minipuft/claude-prompts/commit/c091bbfde5bc89fd2497098283818e577b40216b))
- **gates:** declare the gate surface on the hook and notification ports ([d4a5360](https://github.com/minipuft/claude-prompts/commit/d4a5360fa546eae5336af5d0759067431ec4d74c))
- **pipeline:** derive skipped stages instead of accumulating them ([cd7abc0](https://github.com/minipuft/claude-prompts/commit/cd7abc0775acdbb39c2c0809e048141daf2de548))

### Documentation

- **deps:** close Phase 6 Renovate rollout ([#180](https://github.com/minipuft/claude-prompts/pull/180)) ([a785167](https://github.com/minipuft/claude-prompts/commit/a78516776979df4ba51f62cb8a256c8026188b22))
- **deps:** scope the SDK v2 package swap and record Tier B's blockers ([59dfdee](https://github.com/minipuft/claude-prompts/commit/59dfdee762262cdcf840ce8da98762f8c80a7c77))
- **docs:** record acquisition recovery baseline ([#182](https://github.com/minipuft/claude-prompts/pull/182)) ([8bfd41b](https://github.com/minipuft/claude-prompts/commit/8bfd41b8622c8361e1fe337533180ece6c88a19c))
- **pipeline:** add coordinator decomposition tier ([#181](https://github.com/minipuft/claude-prompts/pull/181)) ([41cbbb9](https://github.com/minipuft/claude-prompts/commit/41cbbb91ddeadeb96adb19f6fb83e8b0eb2d936f))
- **pipeline:** drop a doubled stage name left by the renumber sweep ([bd8095a](https://github.com/minipuft/claude-prompts/commit/bd8095a73c8a17ccfabae5287fec36a2f1f99edd))

## [3.0.2](https://github.com/minipuft/claude-prompts/compare/v3.0.1...v3.0.2) (2026-08-02)

### Changed

- **deps:** the published MCP `inputSchema` changed in 39 places, all of them **permissive**. `@modelcontextprotocol/sdk` selects its JSON Schema converter from the installed zod major (`zod-json-schema-compat.js:19-28`), so upgrading to zod 4 swapped the engine that produces the tool surface. The principal difference is that `additionalProperties: false` is now emitted as `additionalProperties: {}`. **No consumer action is required**: every request that validated under zod 3 still validates under zod 4 — the surface changed shape without narrowing what it accepts, which is why this ships as a patch rather than the major Release Please computed. The surface is now pinned by `server/tests/snapshots/mcp-input-schemas.json` and checked in CI, so a future converter change cannot land unnoticed.

### Fixed

- **scripts:** check gemini's dependency range, not its own version ([#170](https://github.com/minipuft/claude-prompts/issues/170)) ([adee76c](https://github.com/minipuft/claude-prompts/commit/adee76c2a28c65c00e9989df466fc071a0110ba6))

### Maintenance

- **deps:** dependency modernization — Tiers A–D (zod 4, js-yaml 5, TypeScript 6, ESLint 10) ([#172](https://github.com/minipuft/claude-prompts/issues/172)) ([a28119c](https://github.com/minipuft/claude-prompts/commit/a28119cf859a3ba34b32aa7fa92092b767236847))
- release 3.0.2 rather than the computed 4.0.0 ([#173](https://github.com/minipuft/claude-prompts/issues/173)) ([550b2e4](https://github.com/minipuft/claude-prompts/commit/550b2e455275ddb5c7f870f7651e1cae76659556))

## [3.0.1](https://github.com/minipuft/claude-prompts/compare/v3.0.0...v3.0.1) (2026-08-01)

### Fixed

- **ci:** ship agents/ in the plugin distribution and assert it ([#160](https://github.com/minipuft/claude-prompts/issues/160)) ([1341e08](https://github.com/minipuft/claude-prompts/commit/1341e08e7abe40013069c5f008d56bebc5496668))

### Changed

- **server:** migrate cross-layer imports to package.json subpath imports ([901081a](https://github.com/minipuft/claude-prompts/commit/901081a144d9c79f5a5a4808f3bbd50d90cf4e65))
- **server:** subpath imports + declared public API contract ([b05a181](https://github.com/minipuft/claude-prompts/commit/b05a1815b9e13292fa97c8b03877435a412bd9fb))

### Documentation

- declare the public API contract that major versions protect ([02f937f](https://github.com/minipuft/claude-prompts/commit/02f937f65ad52a919c415fce2b04eeb22a58894b))

## [3.0.0](https://github.com/minipuft/claude-prompts/compare/v2.1.0...v3.0.0) (2026-08-01)

### Added

- **`cpm` CLI now ships with the npm package**: the workspace CLI is published as a second bin of `claude-prompts`, so it runs from any directory without cloning the repo or installing an MCP server — `npx -p claude-prompts cpm validate --all -w ./my-workspace`. Useful for scripting, CI, and for agents working outside a configured MCP client. The bundle is self-contained (no runtime dependencies) and is built from `cli/src` by `server/esbuild.config.mjs`, which imports `cli/esbuild.config.mjs` rather than duplicating it so the standalone and published bundles cannot drift. See [CLI Guide](docs/guides/cli.md).
- **CLI validated in CI**: a `CLI` job now runs the CLI's typecheck, build, and integration suite on every run. `jest`/`ts-jest` were missing from `cli`'s devDependencies, so its 75 integration tests had never executed; six were failing against fixtures left stale by the `content_check` → `inline_guidance` and methodology → framework retirements. Fixtures corrected, suite green.
- **Warnings for dropped inline gate definitions**: `normalizeInlineGateDefinitions` previously discarded malformed definitions in silence. Each drop now logs the prompt, the gate (by ID, else name, else position), and every field that disqualified it — all of them, not just the first, so one load cycle reports every mistake. Applies to YAML and markdown prompts. Malformed definitions are still dropped rather than failing the load, so a bad block costs one gate instead of the whole prompt. This is release N of the warn-then-arm migration described under Deprecated.
- **Prompt-level injection control**: a prompt may declare an `injection` block in its `prompt.yaml` (`system-prompt`, `gate-guidance`, `style-guidance`, each accepting `enabled`, `frequency`, `target`). It resolves between step and chain config, taking the hierarchy to eight levels. Setting `system-prompt.enabled: false` also withholds gates that score methodology adherence, since scoring a methodology that was never injected is incoherent. See [Injection Control](docs/guides/injection-control.md).
- **`session:cancel` action on `system_control`** (Tier 3): MCP clients can now cancel an active chain session via `system_control(action:"session", operation:"cancel", session_id:"chain-X#1")`. Transitions `runStatus` to `cancelled`; idempotent on already-cancelled sessions; refuses sessions in terminal `completed`/`failed` state. Use `operation:"cancel"` for soft-stop (preserves session for audit), `operation:"clear"` for hard removal (deletes session and chain history).
- **`ExecutionRecord` persistence** (Tier 5): Pipeline stages 9 and 10 now emit append-only ledger rows to the `execution_records` table on every chain-step transition. Stage 9 emits a `working` record per render (with `substate.renderedAt`); stage 10 emits a `completed` record on chain terminal. Records carry SEP-1686-aligned `StepLifecycle` + `StepSubstate` + `GateVerdictSummary` shape. ULIDs (monotonic) preserve insertion order across rapid emissions. Emission is best-effort — failures log a warning and never break pipeline execution.
- **`command-tokenizer.ts`**: Pure function `tokenizeCommand()` with quote-aware detection for all 8 operator types (chain, delegation, gate, parallel, repetition, conditional, framework, style). Includes delimiter overlap filtering to prevent `==>` from false-matching as gate operator
- **`command-tokenizer.test.ts`**: 56 tests covering all operator types, quoted argument regression suite, mixed operators, prompt ID extraction, cleaned command generation, and edge cases

* **execution:** execution ledger Tiers 1-5 + Phase 4 SQLite cleanup ([#131](https://github.com/minipuft/claude-prompts/issues/131)) ([9fd4520](https://github.com/minipuft/claude-prompts/commit/9fd45205771fae4c8d603bb32a2e0ed9956b51ad))
* **gates:** add script_tool verification criteria and fix schema normalization ([d12c278](https://github.com/minipuft/claude-prompts/commit/d12c2789897d5365374c7e1d4d7e0e0268adc679))
* **gates:** clarify gate vocabulary, add path-verification gate, documentation pass ([#132](https://github.com/minipuft/claude-prompts/issues/132)) ([7d46db0](https://github.com/minipuft/claude-prompts/commit/7d46db02e0d55a348372dc8a3181e7acb916c78a))
* **gates:** gate resolution precedence (ADR 0001), injection hierarchy, launcher envelope ([a06287d](https://github.com/minipuft/claude-prompts/commit/a06287dd1f8be715f25c35a18bf45a87ede2eefd))
* **scripts:** add verify:mcp to check a build without restarting Claude Code ([dda4cd6](https://github.com/minipuft/claude-prompts/commit/dda4cd67b06c76b9bf087520a9f728d5a89e3e6f))
* **scripts:** assert content in verify:mcp and gate its own falsifiability ([8c79454](https://github.com/minipuft/claude-prompts/commit/8c79454c8c80302ad826bcba5630b6353c0e9ddd))
* **server:** ship the cpm CLI as a second bin ([f9d9ec2](https://github.com/minipuft/claude-prompts/commit/f9d9ec25b6bd6315a8f6948ee38dc30771ff4bed))
* **server:** unify contract-surface vocabulary on framework, add recurrence guard ([6b5b27a](https://github.com/minipuft/claude-prompts/commit/6b5b27a9a952b0faacd61cbbf7ddaec2090cfc2f))

### Changed

- **Downstream marketplace sync no longer hardcodes the license**: the `sync-downstream` job stamped `.license = "AGPL-3.0-only"` onto `minipuft-plugins`' `marketplace.json` as a literal, so it would have re-applied the pre-2.1.0 license on every release and silently reverted the MIT change above. The license is now read from `.claude-plugin/plugin.json` (one source of truth) and asserted in the job's validate step.
- **Repository housekeeping**: removed `.actrc` (no workflow, script, or doc referenced it) and `.nvmrc` (no machine consumer; `.node-version` is the pinned file and is read by `setup-node` and the extension build). Publish workflows now resolve Node via `node-version-file: '.node-version'` instead of five hardcoded `24` literals. The `remotion/` product-demo tree moved out of the repository into a standalone local project, ending its dependency-bot churn; its commitlint scope was retired with it.
- **Single active Renovate configuration**: the repo carried both a bare root `renovate.json` and a tuned `.github/renovate.json5`. Renovate resolves the root file first, so the tuned config — including the `zod <4` and `express <5` holds — had never taken effect. Confirmed by a `--dry-run=full` against `main`, which reported it would ensure a dashboard titled `Dependency Dashboard` (the default) rather than the `📦 Dependency Updates Dashboard` the json5 specifies. The root file is removed. Because the surviving config had never executed, it was audited before activation rather than trusted:
  - Dropped `baseBranches: ["main", "develop"]` → `["main"]`; no `develop` branch exists on the remote.
  - Dropped `postUpgradeTasks`; it requires self-hosted Renovate with `allowedPostUpgradeCommands` and is inert on the hosted app.
  - **Dropped the `enabledManagers: ["npm"]` allowlist entirely.** A dry-run comparison showed activating it as written would have silently stopped updates for the `dockerfile` manager (`server/src/Dockerfile` base images) and `nodenv` (`.node-version` — the file every workflow now resolves Node from). Auto-detection is what had actually been running.
  - Set `vulnerabilityAlerts.minimumReleaseAge: null`, overriding the global 3-day soak. With Dependabot security updates disabled, Renovate is the sole remediation path and CVE fixes must not wait three days. Dependabot _alerts_ remain enabled — Renovate reads that feed to detect vulnerabilities and would go blind without it.
  - Automerge ships off pending one review cycle now that the config is live for the first time.
- **Re-licensed from AGPL-3.0-only to MIT** to match the MCP ecosystem default and unblock corporate adoption. This reverses the 2.0.0 change that moved the project from MIT to AGPL-3.0-only. Network use of modified versions no longer triggers the source-disclosure obligation of AGPL Section 13; the MIT terms impose only attribution. `LICENSE`, `server/package.json`, `manifest.json`, and `.claude-plugin/plugin.json` now all declare MIT, as does the default `license` field stamped on skills exported by `skills:export` — regenerate exported skills to pick up the new value. Production dependencies were audited before the change: 109 MIT, 33 Apache-2.0, 14 BSD-3-Clause, 12 ISC, 2 BSD-2-Clause, 1 Python-2.0, and zero copyleft.
- **`%lean` no longer keeps methodology-scoring gates**: `%lean` suppresses the methodology system prompt, so the gates that score adherence to it are now withheld too — today that is `framework-compliance` alone. Non-framework gates continue to run under `%lean` exactly as documented; the correction is narrower than the previous wording suggested. Same applies to `%clean` and to a prompt-level `system-prompt` opt-out. `%judge` forces the methodology in and therefore keeps the gates.
- **`framework_gates: false` now takes effect**: the prompt-level opt-out was read from a field that had five readers and no writer, so it did nothing. It now withholds methodology gates across every tier, including registry-activated ones. A prompt already setting it will see those gates disappear — which is what the option has always promised.
- **`gateConfiguration.exclude` now applies to registry-activated gates**: excludes were honoured during planning and then silently undone when the same gates were re-added by category activation. One veto set now covers every tier.
- **`db_reader.py` migrated to `v_execution_status` SSOT view** (Tier 4): Python hook now reads chain state from the cross-language SSOT view introduced in Tier 1, using the canonical `run_status` column (Tier 2) for boundary detection. Falls back to `chain_sessions` per-row table, then `chain_run_registry` blob, for backward compatibility during rollout (Tier 10 will retire the blob fallback). Hook output shape unchanged — existing chain-stop integration is preserved.
- **Consolidated four KV-blob tables into shared `kv_state`** (`SCHEMA_VERSION` 15 → 16): `framework_state`, `gate_system_state`, `argument_history`, and `resource_hash_cache` are now rows in a single `kv_state` table keyed on `(tenant_id, key)`. `SqliteStateStoreConfig` gains an optional discriminator `key` for shared tables. `state.db` is ephemeral, so the schema bump auto-recreates on next server start with no migration burden. Drops 4 tables and 5 indexes.
- **Atomic dual-write to chain registry + hook view**: `persistSessions()` now wraps the `chain_run_registry` blob write and the derived `chain_sessions` projection inside a single transaction so the two can never diverge. Renamed `syncToSessionTable` → `projectToHookView` to reflect that `chain_sessions` is a read-only projection of the registry blob.
- **`SqliteChainRunRegistry` class removed**: dead code with zero consumers. Single `DirectChainRunRegistry` implementation remains.
- **Command tokenizer refactor**: Replaced duplicated operator detection across 3 parsing strategies with a single-pass, quote-aware `tokenizeCommand()` function
  - `command-parser.ts`: 771→710 lines; symbolic `canHandle` reduced from 20 lines to 1; gate/framework/style stripping regex (~25 lines) replaced by `tokens.promptId`/`tokens.rawArgs`
  - `parser-utils.ts`: 198→156 lines; removed `hasOperatorOutsideQuotes` and `stripFrameworkOperatorOutsideQuotes` (zero consumers — tokenizer subsumes)
  - Strategies now consume `TokenizedCommand` instead of re-detecting operators: `canHandle(command, tokens)` reads `tokens.format` and `tokens.hasSymbolicOperators`
  - Eliminates the class of bugs where special characters inside quoted arguments (e.g., `"R3F + Visx"`, `"modes: (1)"`) triggered false operator detection

* **chains:** rename ChainSessionManager identifiers to ChainSessionStore ([6f9428a](https://github.com/minipuft/claude-prompts/commit/6f9428ade77f31a8220215383b1e1a823e8bbc6d))
* **chains:** retire StepState enum for StepLifecycle + StepMilestone ([d617330](https://github.com/minipuft/claude-prompts/commit/d6173301d4f956677ed8d70fd6259256a2de631f))
* **config:** separate authored framework settings from the resolved view ([0bc61f8](https://github.com/minipuft/claude-prompts/commit/0bc61f845e54a533e0df6e1f6ee6aa5ee4deb211))
* **execution:** extract shared process utility with POSIX signal interpretation ([465bf53](https://github.com/minipuft/claude-prompts/commit/465bf5353da2b068d517f505aa6ce87d40adb3b3))
* **frameworks:** dedup and disambiguate colliding framework types ([0b9d8c2](https://github.com/minipuft/claude-prompts/commit/0b9d8c24edf5105fcbf8ed91dd395458fafe49ac))
* **frameworks:** delete the enableArgumentSuggestions flag ([4738763](https://github.com/minipuft/claude-prompts/commit/47387639708aa1ee7284a8b2d2afd89e63f1b0a9))
* **frameworks:** move methodology-named files and directories ([12d2470](https://github.com/minipuft/claude-prompts/commit/12d2470e587a2c341169f0113d1064ddf4225559))
* **frameworks:** remove the deprecated methodology field from definitions ([bb1f590](https://github.com/minipuft/claude-prompts/commit/bb1f590ac79bb2b44347b1179c8ee8929cf5f79a))
* **frameworks:** rename internal methodology identifiers to framework ([4c49340](https://github.com/minipuft/claude-prompts/commit/4c4934022cc574190100c6e44988c099b92dc3e2))
* **frameworks:** rename methodology to framework in comment prose ([ffd1033](https://github.com/minipuft/claude-prompts/commit/ffd1033612120a753b2c4fb69227222b057aefd1))
* **frameworks:** rename the 16 exported Methodology* symbols ([7d16376](https://github.com/minipuft/claude-prompts/commit/7d16376f5ecc9bcc6f4a314b99a8d1208788c959))
* **frameworks:** retire FrameworkDefinition.methodology ([a5ef404](https://github.com/minipuft/claude-prompts/commit/a5ef4043e23ee955209908694b012ac7d9983b88))
* **frameworks:** unify methodology vocabulary on framework ([0393797](https://github.com/minipuft/claude-prompts/commit/03937972a418685dbd9f912ec1c0084893cfc349))
* **gates:** rename gate source methodology to framework-guide ([4c83c66](https://github.com/minipuft/claude-prompts/commit/4c83c6697ce338088b76df63276c0a7d1e2f1826))
* **mcp-tools:** delete the system_control tool-description sink ([0ad5769](https://github.com/minipuft/claude-prompts/commit/0ad5769ec65043aa0ccb64226ba486ae9adabd70))
* **mcp-tools:** rename resource_type value methodology to framework ([916b61c](https://github.com/minipuft/claude-prompts/commit/916b61c04825ea2a8b5b6bf7578503c7967bec0f))
* **parsers:** centralize operator detection in single-pass command tokenizer ([1dab41b](https://github.com/minipuft/claude-prompts/commit/1dab41bd182872178cd3bc7c4b365eda8445cc6d))
* **prompts:** rename create_methodology to create_framework ([7d1c32e](https://github.com/minipuft/claude-prompts/commit/7d1c32e6d291a746f750a3d3010e5cb51f269bb7))
* **remotion:** rename methodology to framework in the tutorial video ([5808785](https://github.com/minipuft/claude-prompts/commit/5808785258cb25d900188efb6deb9cd42f0fb682))
* **resources:** consolidate write paths, remove dead JSON format ([4e8bdf6](https://github.com/minipuft/claude-prompts/commit/4e8bdf608cf4886b23c499b1bfab45383c82d9e3))
* **resources:** rename methodologies resource dir to frameworks ([98b1fd9](https://github.com/minipuft/claude-prompts/commit/98b1fd900dd0a14fb618e8351cd089ba9b172145))
* **server:** delete dead barrels and compat aliases ([837d847](https://github.com/minipuft/claude-prompts/commit/837d84795de6d43816aff8ad37baa66e9e1f14ab))
* **server:** name the script-tool filter for triggers, not the retired mode field ([3ef5411](https://github.com/minipuft/claude-prompts/commit/3ef541191de7c7ef90bfd4eaa50e83b54b7959af))

### Deprecated

- **`inline_gate_definitions` will begin executing in the next release** — behavior change, action may be required. A prompt's `gateConfiguration.inline_gate_definitions` block has never executed: every consumer to date was display or analysis. Per [ADR 0001 (d)](docs/adr/0001-gate-resolution-precedence.md), the next release registers these definitions and schedules them as real gates, controlled by `gates.executeInlineGateDefinitions` (default `false` in this release, `true` in the next).
  - **Why you may care**: a prompt in your workspace that declares inline definitions — possibly written before they were inert, or copied from the `create_prompt` scaffold — will start enforcing them. The bundled corpus is unaffected (no bundled prompt configures gates this way), but workspaces overlaid via `MCP_WORKSPACE` cannot be inventoried from here.
  - **What to do this release**: watch the server log for `Dropped inline gate definition` warnings (new below) and check any prompt named there. Set `gates.executeInlineGateDefinitions: true` to opt in early and verify behavior before the default flips.
  - When armed, definitions resolve at rank 60 (`prompt-config`) — below a caller-supplied gate, removable by a prompt-level `exclude` — and a definition whose ID matches a registered gate overrides that gate's body field by field, with arrays and objects replacing wholesale rather than merging.

### Fixed

- **ci:** keep the Docker build working now that server/ builds the cpm bin ([1bb6f6e](https://github.com/minipuft/claude-prompts/commit/1bb6f6e2ebcc79976a679e3030c29104f6f610ba))
- **ci:** make CI enforce what the repo already checks, and stop sync-downstream shipping broken lockfiles ([708c81b](https://github.com/minipuft/claude-prompts/commit/708c81bbb35e45867ced4dc29db0b3f459a210a4))
- **ci:** make sync-downstream regenerate lockfiles and assert npm ci ([dbba335](https://github.com/minipuft/claude-prompts/commit/dbba33529508a5d61d9508c758caa4d480dd66e7))
- **ci:** make the new CI jobs work in a clean runner environment ([809089b](https://github.com/minipuft/claude-prompts/commit/809089bc5ba231bdfa30077819ac3827747b556a))
- **ci:** stop prettier reformatting the generated gate index ([499c04e](https://github.com/minipuft/claude-prompts/commit/499c04e84e106d5f43152e12a49989cefcad3c12))
- **ci:** stop validate:format failing on tool-generated files ([#159](https://github.com/minipuft/claude-prompts/issues/159)) ([ef3d39c](https://github.com/minipuft/claude-prompts/commit/ef3d39ce72959bbf0a822bc135e7b8e1bf140951))
- **config:** sync config.json and its schema to the framework rename ([39db875](https://github.com/minipuft/claude-prompts/commit/39db8757ce7096e7da04c92b0b866ad78ae8c474))
- **contracts:** correct two tool descriptions that named an invalid value ([436e2d5](https://github.com/minipuft/claude-prompts/commit/436e2d575c83f6a127e8ed2d940583fe713b0f6a))
- **docs:** repair nested code fences in the first-prompt tutorial ([ffef5d7](https://github.com/minipuft/claude-prompts/commit/ffef5d73e56e4edcb64b0bdfbce51029249be648))
- **frameworks:** reconnect frameworkGates — the YAML rename orphaned it ([280603e](https://github.com/minipuft/claude-prompts/commit/280603e838f334fdae88f5623e36d5d6b9f9a386))
- **frameworks:** repair five methodology-vocabulary defects; finish the rename ([8a547d9](https://github.com/minipuft/claude-prompts/commit/8a547d912ef040ce3e05664f675ae56a61f73d87))
- **frameworks:** unstick [@deprecated](https://github.com/deprecated) from version, lay out tier 4.3 ([9d8cbe2](https://github.com/minipuft/claude-prompts/commit/9d8cbe2f562fff75a819b0ef7eafdefedb34c494))
- **hooks:** filter deleted files from pre-push prettier check ([5ee1fb2](https://github.com/minipuft/claude-prompts/commit/5ee1fb28bb02faa497846c2e8a6c8e8ecb370f8d))
- **hooks:** make every local gate a strict subset of CI ([3924713](https://github.com/minipuft/claude-prompts/commit/39247139ca3b7ca76149e1ba15ca4e7ca74e7aca))
- **hooks:** remove stale hooks-state.db fallback from ralph-stop ([2be57ab](https://github.com/minipuft/claude-prompts/commit/2be57ab1102083d9913dd3f87502d011db444180))
- **hooks:** use --diff-filter=ACMR instead of shell workaround ([edb9526](https://github.com/minipuft/claude-prompts/commit/edb95267b3055cadf7198a38fd7b3dc0580069fb))
- **mcp-tools:** rename the methodology creation param to framework ([e2b632c](https://github.com/minipuft/claude-prompts/commit/e2b632c29ebdfa567d7e0815887a63ab2f9c3861))
- **parsers:** quote-aware operator detection prevents special chars in args from breaking prompt resolution ([0beb3ff](https://github.com/minipuft/claude-prompts/commit/0beb3ff2009a487bb5a39d0367429b8e07934be1))
- repoint the cpm CLI at resources/frameworks — Stage 3a broke it ([19f9d71](https://github.com/minipuft/claude-prompts/commit/19f9d71b7907875d3603a25848962ce6c844aba1))
- **scripts:** make the action-metadata guard able to fail again ([95fa1cb](https://github.com/minipuft/claude-prompts/commit/95fa1cbd84ffe06ecec83ad0615cc4cd1fb3fed2))
- **server:** fail fast instead of hanging when an SSE session cannot attach ([dc83489](https://github.com/minipuft/claude-prompts/commit/dc83489ed5ad5a891fab812463539101a980c600))
- **server:** preserve resource ids containing a slash when detecting removals ([126a037](https://github.com/minipuft/claude-prompts/commit/126a0372a8d6c0a28b3d121383109ea2e9d3aeb9))
- **server:** set rootDir so the published types entry resolves ([741a384](https://github.com/minipuft/claude-prompts/commit/741a384ee8d3532e25fa3cf10057e79682692242))
- **server:** survive EPIPE when a shell_verify child ignores stdin ([5bb0d05](https://github.com/minipuft/claude-prompts/commit/5bb0d0502dccb26bc1661d15198ef0b85ea7bee2))

### Documentation

- add F5b — hooks diverge from the repo's own hook standard ([bf93ca7](https://github.com/minipuft/claude-prompts/commit/bf93ca7aa5a683ed43d96b6ffc136cf0bded23be))
- add the CI enforcement and import-alias plan ([6022bb0](https://github.com/minipuft/claude-prompts/commit/6022bb0a413e7255c57f3eda78c50fec91f2b995))
- add Tier 5 (contract surface + guard) and Tier 6 (dead options) ([5d74253](https://github.com/minipuft/claude-prompts/commit/5d742531e1ffab199ca2c99ba1e3c770133e2e6c))
- audit the 62 compat sites and classify each by verdict ([c0dc894](https://github.com/minipuft/claude-prompts/commit/c0dc894555ad8d6cd15a5fa3f5aefe376f4b67a0))
- close out sweep stage 3 and record its deliberate exclusions ([2693bfc](https://github.com/minipuft/claude-prompts/commit/2693bfc18b3b3e767fc5d179e15eeb62c420fc04))
- close plan row 3.9 — the guard now proves it complete ([a16d021](https://github.com/minipuft/claude-prompts/commit/a16d021a956a4e9c31034ce57394563868d785d9))
- close the shim-debt sweep with Tier V, E2E and ORD outcomes ([0503463](https://github.com/minipuft/claude-prompts/commit/050346381dcf100368189308f01a39988324d4ee))
- correct the doc instructions that no longer work ([62897a0](https://github.com/minipuft/claude-prompts/commit/62897a03d73da1b178647296e1e5433cf865f3df))
- correct the plan's own counts after tiers 1-3 ([4f9bc66](https://github.com/minipuft/claude-prompts/commit/4f9bc66088f1779fba432fdd38b2f3206a53bd3a))
- correct version-storage reference, record shim-debt sweep ([94fa37d](https://github.com/minipuft/claude-prompts/commit/94fa37d0a460ea22d71a97bc2c661a079f8218e2))
- drop dead CLI flags and env vars from server README; fix barrel rule ([d25b323](https://github.com/minipuft/claude-prompts/commit/d25b323cb754bd6a117a89cd2a4a02759492be16))
- finish removing the path-override surface that does not exist ([2a3084b](https://github.com/minipuft/claude-prompts/commit/2a3084bf069251de588c5ce8295f8f154359787a))
- make the docs-vs-parser gap a CI failure instead of a recurring bug ([0e76c03](https://github.com/minipuft/claude-prompts/commit/0e76c03a4b235f4927eca99bf179d7947a6dce98))
- narrow F1b — path filters apply to the PR diff, not the push ([db5eb40](https://github.com/minipuft/claude-prompts/commit/db5eb408d89967db77417c6b3603e85729f1f9c5))
- open Tier E2E and Tier V for the two findings this sweep created ([90bf97c](https://github.com/minipuft/claude-prompts/commit/90bf97c00404c4a64c1048b8fd070d061ecab0e2))
- **prompts:** correct the allowedValues deprecation notices ([ae6da7f](https://github.com/minipuft/claude-prompts/commit/ae6da7fd8a696687aa2429f4e873bbd9b9bc4356))
- reconcile stale tier status prose against the row marks ([3315b05](https://github.com/minipuft/claude-prompts/commit/3315b053593ead884a139782a1eaf0aea8cec2c1))
- reconcile Tier 3 and Tier 5 plan rows against measurement ([1497b4f](https://github.com/minipuft/claude-prompts/commit/1497b4f9d8d4bfc13bc5c0d0fb105620e27d923f))
- reconcile two stale plan rows against what actually happened ([f452463](https://github.com/minipuft/claude-prompts/commit/f452463211b61b2d28fc1e062f7a5646222b40d3))
- record Stage 4 outcome — three live regressions, guard blocked ([b8a8b17](https://github.com/minipuft/claude-prompts/commit/b8a8b1719b612fd466c779db161466bd9c356e6c))
- record sweep tiers 3.1-3.9 and the StepState migration ([8f3731e](https://github.com/minipuft/claude-prompts/commit/8f3731ea3985c2eee314dee146bbe6fd215694f2))
- record that Tier 1 is stacked on the shim branch, not cut from main ([2471d28](https://github.com/minipuft/claude-prompts/commit/2471d28b851b2292de2adf6bd2aaa8c2cbbd195e))
- record the bb1f590a follow-up outcome ([ef4aa75](https://github.com/minipuft/claude-prompts/commit/ef4aa75640cfeb2168c2ba21a4982a9f8dbc7c60))
- record the tier 4.3 outcome and the fourth falsified verdict ([41c84e0](https://github.com/minipuft/claude-prompts/commit/41c84e0edb79c1c966ca28297a3f27026f705439))

### ⚠ BREAKING CHANGES

- **server:** the project is re-licensed from AGPL-3.0-only to MIT. Network use of modified versions no longer triggers the source-disclosure obligation of AGPL section 13; MIT imposes attribution only. Skills already exported by `skills:export` carry the old AGPL-3.0-only license field and must be regenerated to pick up MIT.
- **mcp-tools:** resource_manager parameter `methodology` is now `framework`; FrameworkCreationData.methodology removed and `type` is now required.
- **frameworks:** FrameworkDefinition.methodology removed; use `type`.
- resource://methodology/ is now resource://framework/.
- **prompts:** `>>create_methodology` is now `>>create_framework`.
- **config:** the config.json section `methodologies` is now `frameworks`. Existing files are migrated in place on load; the legacy key is ignored after that and can be deleted.
- **frameworks:** a framework.yaml with only `methodology:` and no `type:` no longer loads. All bundled definitions already declared both, so nothing shipped requires an edit; a hand-authored workspace definition may.
- **mcp-tools:** resource_manager(resource_type: "methodology") is now resource_type: "framework". Existing version history for frameworks is discarded by the schema recreate rather than migrated; this is accepted for a pre-release project. The 'switch' action remains valid only for this type, now under its new name.
- **resources:** workspace overlays under MCP_WORKSPACE/resources/methodologies/ will no longer resolve and must be renamed to resources/frameworks/ with their methodology.yaml renamed to framework.yaml. This fails silently - the resource simply stops being found - rather than raising an error. No overlay was present in this environment at the time of the rename.
- **chains:** SCHEMA_VERSION 15 -> 16. Persisted step state values `rendered` and `response_captured` no longer exist and substate_json changed shape, so the first server start after this drops and recreates state.db. Any in-flight chain session is lost; run it between chains rather than mid-run.

### Maintenance

- **server:** re-license from AGPL-3.0-only to MIT ([07f2f0a](https://github.com/minipuft/claude-prompts/commit/07f2f0ab1afe07f6f6d020aefd79ab20248dc2b1))

## [2.1.0](https://github.com/minipuft/claude-prompts/compare/v2.0.0...v2.1.0) (2026-03-19)

### Added

- **Multi-source resource overlay**: Custom workspace resources now load alongside bundled ones for all resource types (prompts, gates, methodologies, styles). Set `MCP_WORKSPACE` to a directory with `resources/` subdirs — custom resources with the same ID as bundled ones take priority
  - Methodologies: `additionalMethodologiesDirs` in `RuntimeMethodologyLoader` (mirrors gates pattern)
  - Styles: `additionalStylesDirs` in `StyleDefinitionLoader` (mirrors gates pattern)
  - Prompts: Overlay merge in `data-loader.ts` — loads primary then overlays per workspace dir
  - Gates: Already supported (unchanged)
- **Wide-event root span enrichment**: Pipeline root span (`prompt_engine.request`) now contains 22 business-context attributes at completion, following the [wide-event pattern](https://loggingsucks.com/)
  - Performance: `stages.slowest`, `slowest_ms`, `executed_count`, `duration.total_ms`, `had_early_exit`
  - Gates: `gates.names`, `passed_count`, `failed_count`, `blocked`, `retry_exhausted`, `enforcement_mode`
  - Chain: `chain.is_chain`, `chain.step_index`, `chain.id`
  - Framework/scope: `framework.id`, `framework.enabled`, `scope.source`
  - Error: `error.type` for groupable incident triage
  - Enables incident queries like "show blocked requests by gate name" or "which stage is the bottleneck"
- **Response Format Overlays**: Methodologies and styles can define `responseFormat` in YAML to guide LLM response structure at the tool description level
  - Methodology `responseFormat` woven into tool descriptions at synchronization time (global)
  - Style `responseFormat` available for per-execution system prompt injection

* **ci:** auto-merge manual changelog entries into Release Please releases ([d2f2f52](https://github.com/minipuft/claude-prompts/commit/d2f2f52f330f3063f394a80988c011de692f7717))
* **runtime:** multi-source resource overlay and path consolidation ([2f5d751](https://github.com/minipuft/claude-prompts/commit/2f5d75106605d254679a54871deb5d0e7ee46649))
* **server:** add OpenTelemetry instrumentation and observability infrastructure ([48e720f](https://github.com/minipuft/claude-prompts/commit/48e720f684f8fc5822c66c7242aa414bc2e4740f))

### Changed

- **BREAKING**: Path resolution consolidated to `MCP_WORKSPACE` as single source of truth. Individual per-resource env vars (`MCP_PROMPTS_PATH`, `MCP_METHODOLOGIES_PATH`, `MCP_GATES_PATH`, `MCP_STYLES_PATH`, `MCP_SCRIPTS_PATH`) and CLI flags (`--prompts`, `--methodologies`, `--gates`, `--scripts`, `--styles`) removed
  - Migration: Use `MCP_WORKSPACE` with standard `resources/` subdirectory structure, or `MCP_RESOURCES_PATH` for custom resources base
  - PathResolver `get*Path()` methods unified via shared `resolveResourceSubdir()` helper
  - Per-loader `resolve*Dir()` methods simplified to package.json + \_\_dirname fallback only (env var handling removed)
  - `module-initializer.ts` unconditionally initializes singletons with PathResolver-resolved dirs
- **Prompt management consolidation**: Migrated all prompt lifecycle operations from standalone `prompt_manager` tool to unified `resource_manager` with `resource_type:"prompt"`. This completes the tool consolidation started in v1.2.0.
  - All 12 prompt actions preserved: `create`, `update`, `delete`, `list`, `inspect`, `reload`, `analyze_type`, `analyze_gates`, `guide`, `history`, `rollback`, `compare`
  - Internal architecture improved with service decomposition: `PromptLifecycleService`, `PromptDiscoveryService`, `PromptVersioningService`
  - No API changes required—use `resource_manager(resource_type:"prompt", action:"...")` as before
- **Client launch preset expansion**: Extended `--client` startup presets to include `gemini`, `opencode`, and `cursor` (in addition to `claude-code`, `codex`, `unknown`) and wired delegation strategy routing for each profile.
- **Delegation strategy hardening**: Centralized delegation profile metadata for CTA/footer rendering, added Codex fallback guidance when `spawn_agent` is unavailable, and marked Cursor delegation messaging as experimental/testing.
- **Tier 5 File Size Decomposition**: Three oversized files decomposed to meet 500-line service advisory
  - `loader.ts` (896→544): Extracted markdown parsing to `markdown-prompt-parser.ts`; consolidated ~30 verbose info-level logs
  - `tool-description-loader.ts` (741→489): Extracted methodology/style overlay resolution to `tool-description-overlays.ts`
  - `file-operations.ts` (517→345): Removed 3 dead diagnostic methods with zero consumers
- **MCP Tool Schemas**: Hand-written Zod schema factories replace codegen `mcp-schemas.ts`, enabling methodology-aware description overlays without generated code
- **Operator Patterns**: Loaded from JSON registry at import time via esbuild inlining, eliminating the `generate-operators` codegen step and Python hook codegen
- **Style Guidance**: Served exclusively from YAML definitions via StyleManager, removing hardcoded legacy fallback

* **hooks:** improve Python hook type safety and reduce pyrefly baseline ([69cc281](https://github.com/minipuft/claude-prompts/commit/69cc281d4b6ab3d137b0713b4730be55ffac4288))
* **runtime:** replace ServerRootDetector with resolvePackageRoot() ([3c2bd7f](https://github.com/minipuft/claude-prompts/commit/3c2bd7ffb1c04c4949397119cb1680126481f3e2))
* **server:** decompose Tier 5 oversized files to meet size advisories ([adbc670](https://github.com/minipuft/claude-prompts/commit/adbc6706e94b5047f494aaa2f00ee8f9d364e2f7))
* **server:** enforce architecture boundaries via DatabasePort injection ([5b39be0](https://github.com/minipuft/claude-prompts/commit/5b39be009cad1221ad3d2471c243282897d11723))
* **server:** replace codegen with hand-written schemas and resource-driven overlays ([84b74cf](https://github.com/minipuft/claude-prompts/commit/84b74cfa8863497028d4fa9b2b0cb67fcc92619b))

### Removed

- **Legacy `prompt_manager` MCP tool**: Prompt lifecycle now exclusively via `resource_manager`. The standalone `prompt_manager` tool registration has been removed.

### Fixed

- **Prompt update field clearing**: Sending empty strings (e.g., `system_message:""`) now correctly clears the field instead of silently preserving the old value. Update handler migrated from `||` fallback to `!== undefined` pattern matching the methodology handler

* **ci:** add checkout step before changelog merge in Release Please workflow ([d68d0f1](https://github.com/minipuft/claude-prompts/commit/d68d0f19781079c114c46d29543d1f780a1edda9))
* **ci:** centralize downstream version sync in extension-publish ([e8c25e0](https://github.com/minipuft/claude-prompts/commit/e8c25e0d7bb925ce517c2aa72e226d4c4ebf0be0))
* **ci:** fix changelog merge target and set release-as 2.1.0 ([cc2ed76](https://github.com/minipuft/claude-prompts/commit/cc2ed76cb5bf9e760743aad6201049e983227396))
* **deps:** update dependency chokidar to v5 ([b10476f](https://github.com/minipuft/claude-prompts/commit/b10476f3547051ea5c7296e275c69f2d0561eb5b))
* **hooks:** register delegation-enforce.py in PreToolUse hooks ([0c7c3a4](https://github.com/minipuft/claude-prompts/commit/0c7c3a4f3ebd78527bacbe821991c248214ad8c5))
* **hooks:** resolve generated operators Ruff typing issue ([a956fb2](https://github.com/minipuft/claude-prompts/commit/a956fb2a7df0f0439d5bd39f7343c3dfb071a452))
* **hooks:** use SSOT registry for operator detection in prompt-suggest hook ([2fe7a4f](https://github.com/minipuft/claude-prompts/commit/2fe7a4f58ef93632e70cd2087af9746e00be9108))
* **hot-reload:** support chokidar 5 upgrade ([1db39c8](https://github.com/minipuft/claude-prompts/commit/1db39c8982706e36d70b2eec1580631594d99fa3))
* **mcp-tools:** fix prompt update field clearing and simplify update workflow ([5a2800e](https://github.com/minipuft/claude-prompts/commit/5a2800e6f925796c6d8c679d6aeaff3672f8aa33))
* **mcp-tools:** remove section/section_content from router pass-through ([61072df](https://github.com/minipuft/claude-prompts/commit/61072df2c71ae61ed7002dd21802b8f06c9dd8c2))
* **parsers:** strip leading delegation operators before argument extraction ([07ed2ee](https://github.com/minipuft/claude-prompts/commit/07ed2ee7498956b5690fa555c94bf63db95acbe0))
* **scripts:** check dependency range instead of package version for opencode ([3f3fa9e](https://github.com/minipuft/claude-prompts/commit/3f3fa9e6fd4089c0202e3bee74ce4f8cd379790c))
* **scripts:** generate Ruff-compatible Python operator types ([aa201d7](https://github.com/minipuft/claude-prompts/commit/aa201d7166d35dd7b91cc6fa0eded6ea848e10c9))
* **scripts:** update extension deps list and lint ratchet baseline ([bffac0d](https://github.com/minipuft/claude-prompts/commit/bffac0d0ca73ecca35eb8373ae349182ebba5d6f))

### Improved

- **Prompt update workflow for LLMs**: Update fields directly — `update(id, description:"new")` — only provided fields change, omitted fields are preserved. Tool description now includes a compact UPDATE hint for discoverability
- **Update handler maintainability**: Replaced 8 individual if-checks with `UPDATE_FIELDS` map loop for field-level overrides. Adding new updatable fields is now a single map entry

### Documentation

- **README install sections**: OpenCode and Gemini CLI sections restructured with Option A/B (plugin vs manual config), correct config formats (OpenCode uses `mcp` key with `command` array), and Gemini hooks prerequisite added. Fixed `> [!NOTE]` callouts not rendering inside `<details>` blocks
- **Custom Resources section**: Documented `MCP_WORKSPACE` overlay behavior, removed false `~/.local/share/claude-prompts/` persistence claim, added per-client config examples with `MCP_RESOURCES_PATH`, added `--init` workspace creation workflow
- **Telemetry observability guide**: Restructured attribute reference into Initial/Wide-Event/Other sections with incident query examples per attribute. Fixed chain events incorrectly documented as active (now marked Planned). Updated architecture diagram to show wide-event enrichment flow.
- **CONTRIBUTING.md modernization**: Restructured contributor guide with quick-start path, contribution type routing (code/prompts/gates/methodologies/docs), commit scope reference, testing decision matrix, and progressive disclosure via collapsible sections
- **GitHub issue and PR templates**: Added YAML-based issue forms (bug report, feature request) with project-specific dropdowns (transport, MCP tool, area), preflight checkboxes, and structured fields following Next.js/Vite/Claude Code conventions. Minimal PR template complements existing CI `pr-summary` bot

* **cleanup:** record chokidar post-upgrade rationale ([b6740e2](https://github.com/minipuft/claude-prompts/commit/b6740e21d11bf20a324c3e511a97ad67c28924c9))
* modernize CONTRIBUTING.md, add GitHub templates, align project config ([3afbe39](https://github.com/minipuft/claude-prompts/commit/3afbe39c475ddc5dc4054b5ffd30f5bc90a29cd6))
* record open PR validation wave ([81d383a](https://github.com/minipuft/claude-prompts/commit/81d383a51191570cf4314caeec29e7d9dcbb540c))
* record package wave results ([0e7de90](https://github.com/minipuft/claude-prompts/commit/0e7de90a611b5151f6e4a095ed4e49bfa49ba9ff))
* record remaining package wave ([d398fe5](https://github.com/minipuft/claude-prompts/commit/d398fe54b37d279dc23616453033350a5d1784d8))
* remove orphaned [Unreleased] section from pre-v2.0.0 changelog ([73ad697](https://github.com/minipuft/claude-prompts/commit/73ad69785c60ddccdd6decf52b6f86f57701ac74))
* standardize inline doc links with TIP callouts across README ([ebd6241](https://github.com/minipuft/claude-prompts/commit/ebd62412b08b03a0f335b12850750f8d0546144e))
* update changelog for unreleased changes ([25c659e](https://github.com/minipuft/claude-prompts/commit/25c659e21230b1adca71789541dadd1ac1416996))
* update demo video plan to WebP format and re-recording schedule ([b87aef7](https://github.com/minipuft/claude-prompts/commit/b87aef7f106f7502ee1e2e253deb05606b4b5d4c))

### ⚠ BREAKING CHANGES

- **runtime:** Individual per-resource env vars and CLI flags removed. Use MCP_WORKSPACE with resources/ subdirectory structure instead.

## [2.0.0](https://github.com/minipuft/claude-prompts/compare/v1.7.0...v2.0.0) (2026-03-11)

### ⚠ BREAKING CHANGES

- **server:** License changed from MIT to AGPL-3.0-only. Network use of modified versions now requires source disclosure under Section 13 of the GNU Affero General Public License v3.
- **server:** All runtime-state paths require explicit PathResolver configuration. Users running via npx must provide --workspace or set MCP_WORKSPACE. Storage backend migrated from JSON files to SQLite — downstream readers of state files must use SQLite.
- **paths:** All path-dependent modules now require explicit path configuration. Callers must provide paths via PathResolver or CLI flags.

### Added

- **ci:** add commitlint, changelog-sections, and downstream sync workflow ([802575d](https://github.com/minipuft/claude-prompts/commit/802575df5bb95a1f6cecf1dcd9a9d3f3cfc8fd8e))
- **eslint:** add claude-plugin custom ESLint rule ([876b431](https://github.com/minipuft/claude-prompts/commit/876b431f428b8a8df644ae4d89c31d483c45e9d2))
- **gates:** add response blocking and gate event emission in pipeline ([914a074](https://github.com/minipuft/claude-prompts/commit/914a0740db3d793d259d502ae9a354077b85c3d3))
- **hooks:** add server-side hook registry and MCP notification system ([86ba115](https://github.com/minipuft/claude-prompts/commit/86ba11564d6363e9353b34cfcef0a7e662d50b96))
- **parsers:** add framework-aware quote parsing for @ operator ([9555122](https://github.com/minipuft/claude-prompts/commit/95551220836997760e735ab6b7121548f05dc504))
- **scripts:** add skills-sync CLI for cross-client skill distribution ([351291c](https://github.com/minipuft/claude-prompts/commit/351291c5827e17cd36b34588d6ee2646b561eebc))
- **server:** add identity resolution, delegation operator, and methodology assertions ([#76](https://github.com/minipuft/claude-prompts/issues/76)) ([913c2d9](https://github.com/minipuft/claude-prompts/commit/913c2d9d3dc8d65a64e47c29f310feeca0f0c937))

### Fixed

- **ci:** align extension-publish tags with Release Please config ([19a0024](https://github.com/minipuft/claude-prompts/commit/19a002439ade437c7856c03164b52c4196d821a1))
- **hooks:** allow generated file deletions for feature removal ([a8fcb24](https://github.com/minipuft/claude-prompts/commit/a8fcb24f310096fe617ac50fb1840acdeb5778f8))
- **hooks:** update Python hooks for new gate server format ([1b0ddf5](https://github.com/minipuft/claude-prompts/commit/1b0ddf50367e8de7fb447b2e95b6d80ecec2d207))
- **parsers:** simplify argument assignment for unstructured text ([061cd0f](https://github.com/minipuft/claude-prompts/commit/061cd0f1e8483e258ffff13e5576b61eddac15d2))
- **pipeline:** use provider function for prompt cache synchronization ([f092837](https://github.com/minipuft/claude-prompts/commit/f09283778ff2474b1a30d8a40c6a8f0827069c97))
- **runtime:** bridge PathResolver to jsonUtils via PROMPTS_PATH env var ([3d4505b](https://github.com/minipuft/claude-prompts/commit/3d4505b3c982f2952fc56f574ba5228b801d290e))
- **tests:** set PROMPTS_PATH in test setup for template rendering ([34769d7](https://github.com/minipuft/claude-prompts/commit/34769d762fc9ffdb2f7c00064dc4a04bdd2a0a9e))

### Changed

- **gates:** consolidate gate verdict validation to single source of truth ([0ae1ae9](https://github.com/minipuft/claude-prompts/commit/0ae1ae9ed20070515129ce239f7b0aec5f31daff))
- **gates:** extract gate-activation utility and cleanup dead code ([85bd265](https://github.com/minipuft/claude-prompts/commit/85bd265ae91599718b257055ac45955249bf3f0a))
- **mcp-tools:** consolidate prompt_manager into resource_manager ([6a41a52](https://github.com/minipuft/claude-prompts/commit/6a41a5293524b0097132d22ccd6107e43cd863f6))
- **parsers:** simplify argument matching and remove dead code ([3befb9f](https://github.com/minipuft/claude-prompts/commit/3befb9f086567d880b4152a49437b551b7b51a5b))
- **paths:** enforce explicit path resolution, remove process.cwd() fallbacks ([b93ca78](https://github.com/minipuft/claude-prompts/commit/b93ca789abf5e2bcf318fce73dd27cd634563efa))
- **prompt-guidance:** remove unused resource selection code ([a2da026](https://github.com/minipuft/claude-prompts/commit/a2da0267d90a206a0864a62d741ccbab1819f8ca))
- **remotion:** replace demo compositions with Liquescent design system ([b06706b](https://github.com/minipuft/claude-prompts/commit/b06706b135ff51aada2191b283e905e66eff4b40))
- **runtime:** migrate CLI argument parsing to node:util parseArgs ([71dbe00](https://github.com/minipuft/claude-prompts/commit/71dbe00e27199850ad093cf077638ca3d4038eee))
- **server:** complete modular monolith migration to 5-layer architecture ([31d3884](https://github.com/minipuft/claude-prompts/commit/31d3884726f29611a5e4ca1e3bd9673729b53d90))
- **server:** relocate tooling/ submodules and consolidate pipeline imports ([5204a7a](https://github.com/minipuft/claude-prompts/commit/5204a7a01e66cefffb2a607c0432e0a880df1cb3))
- **types:** consolidate context types and add gate response contract ([aa51202](https://github.com/minipuft/claude-prompts/commit/aa512028795538127fb86eb3ef3d210b85ad6e9e))

### Documentation

- add LIQUESCENT methodology and update changelog ([26a639b](https://github.com/minipuft/claude-prompts/commit/26a639b59c89f7f0f223dc65fb5a8201a7740d06))
- **changelog:** document breaking path resolution changes ([5918e16](https://github.com/minipuft/claude-prompts/commit/5918e1653f9cf4810998466567ce72f40b0808ee))
- **ci:** update downstream sync comment to reflect Dependabot approach ([82e15cd](https://github.com/minipuft/claude-prompts/commit/82e15cd32251579da6ab6ab862b244b493de5c78))
- consolidate documentation and remove completed plans ([1e52295](https://github.com/minipuft/claude-prompts/commit/1e52295ce182e20753d7444293086eab81652206))
- update path configuration and release process documentation ([abf3457](https://github.com/minipuft/claude-prompts/commit/abf345766f8fd611c5b0ad1e502866f6d81cc88b))

### Maintenance

- **ci:** downgrade to minor bump — path resolution change is internal only ([c550b74](https://github.com/minipuft/claude-prompts/commit/c550b74d4a220ba44ecb09654c0542e380bd56bd))
- **ci:** release as 2.0.0 — AGPL license change is breaking ([7e5d024](https://github.com/minipuft/claude-prompts/commit/7e5d024645831005c55f86281364efa90312ef82))
- **server:** migrate license from MIT to AGPL-3.0-only ([36961fa](https://github.com/minipuft/claude-prompts/commit/36961fad8bac2cb4b4f9b232ece905be91fe16f8))

## [1.7.0](https://github.com/minipuft/claude-prompts/compare/v1.6.0...v1.7.0) (2026-01-23)

### Features

- **ci:** migrate to OIDC trusted publishing for npm ([e71d272](https://github.com/minipuft/claude-prompts/commit/e71d272f833d1e983f717eb11d31b6a492c24a59))
- **config:** add registerWithMcp toggle for MCP resources ([471ed14](https://github.com/minipuft/claude-prompts/commit/471ed14e8a2a4bd63dd44aabbec8f97a5869e513))
- **config:** expand resources config with granular per-type controls ([ddcdba2](https://github.com/minipuft/claude-prompts/commit/ddcdba2f62a700bfaf013f17ee16f21927cba110))
- **docs:** add Remotion animation system for documentation videos ([0a40c4d](https://github.com/minipuft/claude-prompts/commit/0a40c4de20807ae4600294bee983ce852992311f))
- extension dep sync, repetition operator, hook fuzzy matching ([efbdc30](https://github.com/minipuft/claude-prompts/commit/efbdc3018b44b50bb7383d30f23b3239cc0b7905))
- **hooks:** add chain step visibility with IDs for workflow preview ([ff25d5e](https://github.com/minipuft/claude-prompts/commit/ff25d5ec0f26c1556f55353fb41e97e897ff6792))
- **hooks:** improve prompt_engine directive clarity and token efficiency ([b62f8d3](https://github.com/minipuft/claude-prompts/commit/b62f8d3dd3e7aa4794e9b29bccb0ccc081bd49b1))
- **hooks:** validate operator values against registered server resources ([30cba3a](https://github.com/minipuft/claude-prompts/commit/30cba3ac12c88e74b0b7e70bbcd8bfe079a9505b))
- **resources:** add MCP logs resources for runtime observability ([5f0025f](https://github.com/minipuft/claude-prompts/commit/5f0025fcece76e3ed593246d30da54554e7be58f))
- **resources:** implement MCP Resources protocol for token-efficient access ([80d56d2](https://github.com/minipuft/claude-prompts/commit/80d56d22a4b25b93270e9d8718c3b0ad95641f68))

### Bug Fixes

- **parsers:** preserve arguments after \* N repetition operator ([649bae3](https://github.com/minipuft/claude-prompts/commit/649bae3d3dcaf7c6ec53fda1da18a90aaed6d705))

## [1.6.0](https://github.com/minipuft/claude-prompts/compare/v1.5.0...v1.6.0) (2026-01-22)

### Features

- **ci:** modernize Release Please and npm-publish workflows ([7bb1303](https://github.com/minipuft/claude-prompts/commit/7bb1303a53f998ca10bab6f621eecf548864881a))

### Bug Fixes

- **ci:** handle Release Please PR output as JSON ([8559c74](https://github.com/minipuft/claude-prompts/commit/8559c74e2c819961c644b769bc34f5a06e4f0c82))
- **tests:** update E2E plugin validation for current structure ([053b0be](https://github.com/minipuft/claude-prompts/commit/053b0be8bdd3f3443c5e68b9415e9e0e716d8739))

## [1.5.0] - 2026-01-21

### Added

- **Hook-level fuzzy matching**: Unknown prompt interception before tool call for token efficiency
  - `>>unknwon_prompt` → Hook returns suggestions immediately (no server round-trip)
  - Same multi-factor scoring algorithm as server-side (prefix: +100, word overlap: +30/word, Levenshtein: +50-distance\*10)
  - Saves ~50-100 tokens per failed prompt attempt
- **Resource change tracking**: Audit log for prompts and gates with source attribution
  - Tracks filesystem hot-reloads, MCP tool operations, and external changes
  - Content hashing detects actual modifications (skips no-op saves)
  - Baseline comparison at startup surfaces changes made while server was down
- **`system_control(action:"changes")`**: Query the audit log with filters (`source`, `resourceType`, `since`, `limit`)

### Changed

- **Error messages**: Condensed parsing errors for token efficiency
  - Before: Multi-line verbose messages with format examples and hints
  - After: Single-line messages with fuzzy suggestions only when relevant
- **File watching**: Migrate from `fs.watch` to Chokidar with automatic polling for WSL2/network filesystems
  - Auto-detects WSL2 environments and enables polling mode
  - Configurable via `usePolling` ('auto' | true | false) and `pollingInterval` (default: 300ms)
  - Fixes hot-reload not working in WSL2 due to virtualized filesystem limitations

### Fixed

- **Resource ID extraction**: Baseline comparison now correctly extracts prompt/gate IDs from directory names (was incorrectly extracting "prompt" from nested file paths)
- **Command parsing**: Comprehensive improvements to command parsing robustness:
  - **Bare prompt names**: Accept `strategicImplement` without requiring `>>` prefix
  - **Double-encoded JSON**: Handle nested JSON strings from MCP clients that double-escape payloads
  - **JSON-wrapped chains**: JSON strategy now properly delegates to symbolic parser for chain commands (e.g., `{"command": ">>analyze --> summarize"}`)
  - **Argument syntax**: Gate operators (`::` and `=`) no longer conflict with argument assignment (`input="value"`)
- **Fuzzy prompt suggestions**: Multi-factor scoring replaces simple Levenshtein-only matching:
  - **Prefix matching** (score +100): `ana` → suggests `analyze_code`, `analyze_data`
  - **Word overlap** (score +30/word): `code` → suggests `code_review`, `analyze_code`
  - **Typo correction**: Dynamic threshold based on query length (longer queries allow more edits)
  - **Limited to 3 suggestions**: Reduces noise while maintaining relevance
  - **No arbitrary examples**: Completely unrelated queries show no suggestions instead of random prompts

## [1.4.5] - 2026-01-20

### Added

- **Chain workflow preview**: Hooks show all chain steps before execution begins (e.g., "1/4 Initial Scan → 2/4 Deep Dive → ...")
- **scaffold_project chain**: Interactive project scaffolding for TypeScript, Python, or hybrid projects with modern tooling
- **Nested chain discovery**: Chain steps can reference prompts in subdirectories (e.g., `scaffold_analyze` under `scaffold_project/`)
- **System-only prompts**: Prompts with only system message (no user template required)
- Operator patterns generated from single source (TypeScript + Python via generate-operators.ts)

### Changed

- Symbolic parser with unified pattern matching across all operators
- Hook configuration now loaded from `config.json` via config_loader.py
- Move detect-skills.py to global ~/.claude/hooks (not plugin-bundled)

## [1.4.4] - 2026-01-19

### Added

- Include hooks directory in npm package distribution

## [1.4.2] - 2026-01-18

### Changed

- Migrate Gemini-specific hooks to gemini-prompts repository

## [1.4.1] - 2026-01-17

### Fixed

- Remove submodule path checks from distribution validation

## [1.4.0] - 2026-01-16

### Added

- Global version integrity check across ecosystem (npm, marketplace, extensions)

### Changed

- Migrate documentation guides to Diátaxis framework

## [1.3.2](https://github.com/minipuft/claude-prompts/compare/v1.3.1...v1.3.2) (2026-01-14)

### Bug Fixes

- **release:** version sync ([#54](https://github.com/minipuft/claude-prompts/issues/54)) ([33f9e85](https://github.com/minipuft/claude-prompts/commit/33f9e85349e38445905d6471742c54910dc9178e))

## [1.3.1](https://github.com/minipuft/claude-prompts/compare/v1.3.0...v1.3.1) (2026-01-14)

### Bug Fixes

- **release:** version sync ([#51](https://github.com/minipuft/claude-prompts/issues/51)) ([6bd6039](https://github.com/minipuft/claude-prompts/commit/6bd6039765edae189fe83ca13f60a8a27a178d73))

## [1.3.0](https://github.com/minipuft/claude-prompts/compare/v1.2.0...v1.3.0) (2026-01-14)

### ⚠ BREAKING CHANGES

- Complete MCP server restructure with new consolidated API

### Features

- add Claude Code plugin for /install-plugin support ([c3b5654](https://github.com/minipuft/claude-prompts/commit/c3b5654aaeea5fec12402a859eb687d1e666caa4))
- add dev:claude script for --plugin-dir workflow ([2a7d6f8](https://github.com/minipuft/claude-prompts/commit/2a7d6f8abeedfb6c6ed6f36becae644ebad6f7d7))
- add marketplace.json for plugin distribution ([bf79fcb](https://github.com/minipuft/claude-prompts/commit/bf79fcb56a38d2829f88e5365a5042494d2eba23))
- add streamable http transport and release automation ([0717f31](https://github.com/minipuft/claude-prompts/commit/0717f31ae503c19824fdd14fb05394197b8b11a9))
- Add symbolic command language and operator executors ([639f86a](https://github.com/minipuft/claude-prompts/commit/639f86a4aeeae925c0b916cffc297d4253c8ed6f))
- **dist:** separate public and private prompts for distribution ([fee7c12](https://github.com/minipuft/claude-prompts/commit/fee7c12e21c5b525501764f74fbff80ace08805a))
- enhance README with interactive prompt management features ([13afaa9](https://github.com/minipuft/claude-prompts/commit/13afaa968bc2330f80a183a71f7eb367dc40c3f6))
- enhance server startup options and help documentation ([f315f33](https://github.com/minipuft/claude-prompts/commit/f315f331cbf1112a5d5163018cfbd0bfc23cd413))
- **gates:** implement intelligent gate selection with 5-level precedence system ([b8e1c11](https://github.com/minipuft/claude-prompts/commit/b8e1c11a3bf8a411f65448812112e7c2555a9c8e))
- **gemini:** add Gemini CLI extension support ([50587c6](https://github.com/minipuft/claude-prompts/commit/50587c61fa922eee5400614bde24ec3bf9103cbe))
- **gemini:** align hooks with Claude plugin infrastructure ([c35e4f0](https://github.com/minipuft/claude-prompts/commit/c35e4f0d678d1bd3c36725f9ede1b7a191bab785))
- **hooks:** auto-regenerate contracts on source change ([9b21afa](https://github.com/minipuft/claude-prompts/commit/9b21afa192cddf42bd43d46a02a9557ee00c4d2b))
- implement enterprise-grade CI/CD pipeline with comprehensive testing framework ([#10](https://github.com/minipuft/claude-prompts/issues/10)) ([25e7f59](https://github.com/minipuft/claude-prompts/commit/25e7f59d41801bc4cc4cb6d01158c262d2064b9a))
- implement Phase 1 - Enhanced Category Parsing System ([1506755](https://github.com/minipuft/claude-prompts/commit/150675589e650d5a06d018e7884658a31965dcf2))
- multi-platform extension support with enhanced hooks and gate system ([27b94ec](https://github.com/minipuft/claude-prompts/commit/27b94ecb3946a3a5a227fe5c0dbbbe8792b7cc71))
- **parser:** enhance case-insensitive prompt matching and add strategic implementation ([628b09c](https://github.com/minipuft/claude-prompts/commit/628b09c3e7b6017317eaa966de9b6fd756f77e15))
- **plugin:** add server/resources directory for plugin deployment ([2d21a86](https://github.com/minipuft/claude-prompts/commit/2d21a864a278a3c7a3abbcb4e53843ae65b39ea5))
- **plugin:** add SessionStart hook for dependency installation ([3896fb9](https://github.com/minipuft/claude-prompts/commit/3896fb9b967fe8761ef8f1ee0f4d2d84bf1ec139))
- **plugin:** persist user data outside cache directory ([e59c64b](https://github.com/minipuft/claude-prompts/commit/e59c64b5fc37e989783db8070cceaab320e7be4f))
- **plugin:** unify plugin with YAML resources, version history, and script tools ([0963d4a](https://github.com/minipuft/claude-prompts/commit/0963d4ac56da09dc35d08fc3070c4b846b191fb1))
- **ralph:** context isolation for long-running verification loops ([f1c1014](https://github.com/minipuft/claude-prompts/commit/f1c1014f75dc719d919013dd3dbd9219d2900fe6))
- re-introduce hot-reloading for prompots ([720f96b](https://github.com/minipuft/claude-prompts/commit/720f96b9810a2e3675eb305b3e69683a64bb3982))
- release 1.2.0 with CI validation and gate refactoring ([75ec3e8](https://github.com/minipuft/claude-prompts/commit/75ec3e83e06e6c7753045778d770fc80773e77e0))
- shell verification presets and checkpoint resource type ([ca24027](https://github.com/minipuft/claude-prompts/commit/ca240274e3df495f87879b28e5492c4289cfb489))
- **styles:** add style operator (#) for response formatting ([d2c3173](https://github.com/minipuft/claude-prompts/commit/d2c3173ad4d7edb758207460d56167dd7bc4336b))
- update documentation for version 1.1.0 - "Intelligent Execution" ([7e1fb3f](https://github.com/minipuft/claude-prompts/commit/7e1fb3f02a226b232464a5ae98132d25344813dd))

### Bug Fixes

- add missing nunjucks dependency for template processing ([4f78114](https://github.com/minipuft/claude-prompts/commit/4f781144de43b72d0b29603337ba44d4ba61bb2a))
- add required metadata for plugin menu navigation ([72cd845](https://github.com/minipuft/claude-prompts/commit/72cd845e96cd04c37ec32eb1584f17f8c57e03b2))
- **ci:** consolidate workflows and fix Docker paths ([42efb12](https://github.com/minipuft/claude-prompts/commit/42efb126455c16ac46ba349091977351eb337f82))
- **ci:** skip action inventory verification for bundled builds ([dd299e5](https://github.com/minipuft/claude-prompts/commit/dd299e5f65fe3ffe2184debf659b7a764b176fb0))
- **ci:** update extension-publish workflow for bundled distribution ([8d977e9](https://github.com/minipuft/claude-prompts/commit/8d977e9c4daa8b8b7a6796bd66e6164ece662f86))
- clear lint regressions ([77db53a](https://github.com/minipuft/claude-prompts/commit/77db53a850a93f5fd1b41fe53dc21cd2a258454f))
- **contracts:** add prettier formatting to contract generator ([6096c67](https://github.com/minipuft/claude-prompts/commit/6096c67aa1151f402670081c8871237a2c9888ef))
- **contracts:** format all generated TypeScript files ([0e4c9af](https://github.com/minipuft/claude-prompts/commit/0e4c9aff57867ac46e905fc1e3be4e58b271a946))
- correct marketplace.json schema (source not path) ([6d08e63](https://github.com/minipuft/claude-prompts/commit/6d08e63f06bb6cb6c20a438d23823174e4c24bfb))
- correct source path (relative to marketplace.json) ([e281b48](https://github.com/minipuft/claude-prompts/commit/e281b48728fe3c390058fdaf1126c4811e04ea7c))
- **deps:** add missing 'diff' dependency for text-diff-service ([12b70db](https://github.com/minipuft/claude-prompts/commit/12b70dbfb0f5a53be24c084cd6505133f4458fd5))
- **docker:** update Dockerfile for renamed docs and styles directory ([35144c8](https://github.com/minipuft/claude-prompts/commit/35144c8905c00c5d2a2901a20796ecab4904d1aa))
- **docs:** remove invalid color property from mermaid linkStyle ([d086ca1](https://github.com/minipuft/claude-prompts/commit/d086ca1ee22818c93d427b93d830463c9bb49d37))
- **gemini:** align extension with Claude plugin v1.1.1 ([fb3413c](https://github.com/minipuft/claude-prompts/commit/fb3413c399956ab510f140db8c8802d8938714cb))
- **gemini:** resolve symlinks before path calculation ([77da3bc](https://github.com/minipuft/claude-prompts/commit/77da3bc655a8fdee67b301ec47f993763ce42bcb))
- **hooks:** add quick-check mode to prevent SessionStart blocking ([c4b3f94](https://github.com/minipuft/claude-prompts/commit/c4b3f94d5d1be5b579a25f825f6633e7937cf129))
- **hooks:** make dev-sync portable across environments ([4aa1190](https://github.com/minipuft/claude-prompts/commit/4aa119040f21669c2f5e52e7810ed32198f547dc))
- **npm:** Include methodologies folder in published package ([9bad683](https://github.com/minipuft/claude-prompts/commit/9bad68308e017bc0c362e28f7829d3220bcd7116))
- **plugin:** correct .mcp.json schema and improve dev workflow ([9927529](https://github.com/minipuft/claude-prompts/commit/99275299847de16f1bd42d13525e8cd4c662e624))
- **plugin:** include server/dist for plugin installation ([5f1edd3](https://github.com/minipuft/claude-prompts/commit/5f1edd3ed144e27a3380ea2d8e52890b78a836c5))
- **plugin:** remove duplicate hooks reference causing load failure ([c6c3ca6](https://github.com/minipuft/claude-prompts/commit/c6c3ca648110e216b630829abab947d88cd036ac))
- prune useless prompts ([daec104](https://github.com/minipuft/claude-prompts/commit/daec104cecf6719a080af777899849e2d8493156))
- regenerate contract artifacts and update lint baseline ([0a0e67d](https://github.com/minipuft/claude-prompts/commit/0a0e67d9d62c74e552bb69bcad00299e5e1b23b3))
- **release:** correct release-please config paths ([20662ec](https://github.com/minipuft/claude-prompts/commit/20662ecb89f5ff84c8baea6321774141b049eca7))
- Remove accidentally committed node_modules, update .gitignore ([ed452ac](https://github.com/minipuft/claude-prompts/commit/ed452acd60df2c76d94c43eceb09a66a42edf386))
- return simple text responses for MCP tool visibility in Claude Code ([7980567](https://github.com/minipuft/claude-prompts/commit/7980567d540c04390eb90c44d7c3ed1345394291))
- source must start with ./ ([b2482f1](https://github.com/minipuft/claude-prompts/commit/b2482f1dc79ec65b3e60d7d0192624e18a8a71ee))
- source path relative to repo root ([f2e3020](https://github.com/minipuft/claude-prompts/commit/f2e302058137a49bd2bc195cccc87b71973a38b9))

### Miscellaneous Chores

- prepare 1.3.0 release ([225ebe6](https://github.com/minipuft/claude-prompts/commit/225ebe6da4bb8f5c13ab6d750690249e0ed9502b))

## [1.2.0] - 2025-01-12

### Added

- CI validation and gate refactoring improvements
- Release automation in CONTRIBUTING.md

## [1.1.0] - 2025-01-10

### Added

- Initial public release with MCP server, prompts, gates, and frameworks

[Unreleased]: https://github.com/minipuft/claude-prompts/compare/v1.7.0...HEAD
[1.5.0]: https://github.com/minipuft/claude-prompts/compare/v1.4.5...v1.5.0
[1.4.5]: https://github.com/minipuft/claude-prompts/compare/v1.4.4...v1.4.5
[1.4.4]: https://github.com/minipuft/claude-prompts/compare/v1.4.2...v1.4.4
[1.4.2]: https://github.com/minipuft/claude-prompts/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/minipuft/claude-prompts/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/minipuft/claude-prompts/compare/v1.3.2...v1.4.0
[1.3.2]: https://github.com/minipuft/claude-prompts/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/minipuft/claude-prompts/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/minipuft/claude-prompts/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/minipuft/claude-prompts/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/minipuft/claude-prompts/releases/tag/v1.1.0

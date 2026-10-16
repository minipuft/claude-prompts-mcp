// Auto-generated from tooling/contracts/*.json. Do not edit manually.
export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  status: 'working' | 'needs-validation' | 'deprecated' | 'hidden' | 'experimental';
  required?: boolean;
  default?: unknown;
  compatibility: 'canonical' | 'deprecated' | 'legacy'; // Required with default value
  examples?: string[];
  notes?: string[];
  enum?: string[]; // For enum types with explicit values
  includeInDescription?: boolean; // If false, param is in schema but not tool description
  resolvesPendingRun?: boolean; // True when supplying this param resolves a run pending a review (failed gate or unknown interrupt)
}

export interface ToolCommand {
  id: string;
  summary: string;
  parameters?: string[];
  status: 'working' | 'needs-validation' | 'deprecated' | 'hidden' | 'experimental'; // Required with default value
  notes?: string[];
}

export type prompt_engineParamName =
  | 'command'
  | 'chain_id'
  | 'user_response'
  | 'gate_verdict'
  | 'gate_action'
  | 'gates'
  | 'force_restart'
  | 'handoff'
  | 'claim_token'
  | 'options'
  | 'inputs'
  | 'observations'
  | 'workflow'
  | 'remainder';
export const prompt_engineParameters: ToolParameter[] = [
  {
    name: 'command',
    type: 'string',
    description:
      'Prompt ID to expand. Format: >>prompt_id key="value" | Chains: >>s1 --> >>s2 | Modifiers first: ^Framework :: "criteria" %clean/%lean | Shell verify: :: verify:"cmd" :preset | Criteria inside one :: quote split on , ; or |',
    required: false,
    status: 'working',
    compatibility: 'canonical',
    examples: [
      "@CAGEERF #analytical >>analyze topic:'metrics' --> >>report :: 'cite sources'",
      ">>fix-bug :: verify:'npm test' :full loop:true",
      ">>brainstorm * 5 topic:'product ideas'",
      ">>strategic_implement * 3 plan_path:'./plan.md'",
      ">>research topic:'A' --> >>research topic:'B' --> >>compare",
      ">>validate input:'step1' --> >>validate input:'step2' --> >>synthesize",
    ],
    notes: [
      'Every step needs prompt ID prefix (>> or /). Modifiers apply to whole chain.',
      'Script tools: tool:<id> to invoke; confirm:true tools need approval.',
      'Shell verification: :: verify:"cmd" with :fast/:full/:extended presets, loop:true for autonomous.',
      'REPETITION (* N): Repeats with SAME arguments. For different args per step, use explicit --> chain syntax.',
      "CONTEXT: Each chain step receives previous step's output automatically. Arguments are optional per step.",
      "APPEND (--> as the FIRST token, with chain_id): '--> >>next_step' extends the RUNNING chain named by chain_id instead of starting a new one. This is the only form that may be sent together with chain_id; 'chain_id' + '>>x' is still rejected. It is the string spelling of remainder:{mode:'append'} and takes the same path — same admissibility (a blocking unknown must be open), same validation, same caps, same recorded provenance. '==>' inside an append fragment delegates the step that FOLLOWS it, exactly as in a full chain. '::' is refused there: a raw gate token is resolved against the gate registry at parse time, which an appended node has already passed, so bind the gate with the 'gates' parameter and its target_step_id instead.",
    ],
  },
  {
    name: 'chain_id',
    type: 'string',
    description:
      "Resume token (chain-{prompt} or chain-{prompt}#runNumber). Send output, gate_verdict or gate_action with chain_id. Omit command except a leading '-->' append.",
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'user_response',
    type: 'string',
    description:
      "Step output for chain_id. Canonical bytes are the entire user_response.trim(), without Unicode normalization or metadata stripping. Required semantic review: capture output alone first, then prefer a report-only verdict. Resent work must match that node's captured canonical whole bytes; different or defined-empty work paired with PASS or FAIL is refused before effects. An accepted renewing semantic FAIL clears its target: capture replacement separately before reporting. Another node's body stays scoped to that node.",
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'gate_verdict',
    type: 'object',
    description:
      "Review object {overall:'PASS'|'FAIL',rationale,per_gate?:[{index,passed,rationale,evaluation?}],reminders?}; a string is refused. Check/evaluation entries are per_gate; reminders attest reminder-tier gates. Required semantic_evaluation needs evaluation with server-issued binding, typed observations and captured evidence; report pins never supply authority. Failed attributable reports derive FAIL despite client PASS; missing, stale or misaddressed reports refuse without charge. Evidence uses UTF-16 spans and captured UTF-8 hashBytes digest. Requested evaluation is separate from optional client-reported reviewer; host/native identity remains unknown.",
    status: 'working',
    compatibility: 'canonical',
    notes: [
      'State-conditional: advertised only while the gate system is enabled. Part of the declared union surface regardless — see CLAUDE.md §Public API Contract.',
      'Overall and per_gate rationales are nonempty, single-line and trimmed. Report observation rationales are strings and may span lines; they are not rendered into the verdict rationale.',
      'Reports live only at per_gate[i].evaluation within the gate_verdict object. Do not encode reports as JSON in rationale or introduce a separate findings parameter. Every report, binding, observation, evidence reference and reviewer object rejects undeclared keys.',
      'binding requires nonempty string gate_id, node_id, attempt_id, definition_digest and target_digest. Each observation requires nonempty criterion_id, a declared state, an evidence array and string rationale; optional value is boolean, string or finite number. Evidence target_digest is nonempty; start/end are integers >=0, quote is optional string. Identity strings are retained verbatim; whitespace-only identities are rejected.',
      'The existing acceptance kernel runs against server-issued frozen definitions/node/attempt and independently captured target. target_digest is hashBytes(actual captured UTF-8 content), sha256:<hex>; evidence [start,end) uses JavaScript UTF-16 offsets. It checks binding, bounds, digest, optional quote, evidence requirements and predicates. Shape validation alone is not report acceptance or model accuracy.',
      'reviewer is optional; absent means unknown. Submitted provenance is only client_reported or unknown, never host_verified. Optional provider/model/revision must be nonempty strings; context is self, separate_pass, isolated_judge or unknown. These are client identity claims, not acceptance authority, and are separate from requested routing metadata.',
      "Capture-alone first; prefer report-only. If resending the same node's body with a verdict, its whole trim() bytes must equal the captured target. Different/defined-empty canonical work refuses before writes. Renewing FAIL consumes the old same-node body, preserves old ledger pins and requires separate replacement capture; exhausted FAIL does not renew until retry. Detached routing-only HANDOFF metadata is exempt only on the actual addressed detached verdict route. Artifact declarations are valid, but runtime artifact capture is unavailable.",
    ],
    resolvesPendingRun: true,
  },
  {
    name: 'gate_action',
    type: 'enum',
    description:
      "Run action. 'abort' stops the existing run named by 'chain_id' in any nonterminal state, including active runs, blocking-unknown pauses, ordinary reviews and detached holds. No command, review, retry exhaustion, node selection, trailer or report is required; it starts no work and consumes no report. State and artifacts are retained; repeated abort of an already-cancelled run succeeds. Completed, failed, missing or out-of-scope runs return a non-applied refusal. 'pause' persists a conversation pause on the scoped run so you can discuss the step with the user; 'resume' clears it explicitly; 'abort' still ends the run. Send pause or resume with 'chain_id' only. AFTER A FAILED GATE exhausts its retry limit: 'retry' resets attempts (semantic retry renews the server attempt and requires separate replacement capture), 'skip' records operational BYPASS and continues without an evaluated PASS/FAIL. ON A BLOCKING-UNKNOWN INTERRUPT ('__unknown_interrupt__', raised only with budget.pauseOnBlocking): 'resume' clears the pause and issues the investigation step as written, 'accept_alternative' replaces the remaining run with 'remainder' on the SAME call (refused without one).",
    status: 'working',
    compatibility: 'canonical',
    notes: [
      "Core parameter: advertised independently of gate-system enablement. With gates disabled, 'retry' and 'skip' receive a named refusal; 'abort', 'pause', 'resume' and 'accept_alternative' remain available.",
      "'pause' and 'resume' are control calls. Sent with user_response, gate_verdict, remainder, observations, command, workflow, force_restart, handoff, claim_token, inputs, options or gates they are refused before anything changes; presence decides, so an empty string or false still counts as sent. Nothing implicitly resumes a conversation pause.",
      "A pause, resume, paused-run refusal or paused claim carries `structuredContent.conversation_control` — `{kind:'conversation_control', outcome:'paused'|'already-paused'|'resumed'|'claimed'|'refused', refusal?:{reason, retryable}, run?:{runId, chainId, scope:{organizationId, workspaceId, continuityScopeId}, currentNodeId, step:{current, total}, pause, obligations:[{kind:'step'|'review'|'blocking-unknown'|'exhausted-retry'|'shell-verification'|'detached-report', nodeId, step, review?:{kind, phase}}]}}`. `run` is absent when the run could not be identified (reason `busy` is retryable). The recovery token is never in it.",
      "'accept_alternative' without a 'remainder' in the same call is refused by name — it is the acceptance of an alternative, not a request for one.",
      "'resume' and 'accept_alternative' are meaningful only while '__unknown_interrupt__' is the pending review; against a failed-gate review they are refused the same way 'retry' is against an interrupt.",
    ],
    enum: ['retry', 'skip', 'abort', 'pause', 'resume', 'accept_alternative'],
    resolvesPendingRun: true,
  },
  {
    name: 'gates',
    type: 'array<union[string|{name,description}|object]>',
    description:
      'Gate inputs: registered ID strings; quick {name,description}; full definitions with id,name,severity,criteria[],pass_criteria[],guidance,apply_to_steps[]. Inline :: verify:"command" checks exit status under operator allowlists. Presets fast (1 attempt/30s), full (5/5min), extended (10/10min); options max:N,timeout:N,loop:true. Example: >>fix-bug :: verify:"npm test" :full loop:true. Semantic criteria use the bound report workflow in user_response/gate_verdict.',
    status: 'working',
    compatibility: 'canonical',
    examples: [
      '[{"name": "Source Quality", "description": "All sources must be official docs"}]',
      ':: verify:"npm test" :full loop:true',
    ],
    notes: [
      'RECOMMENDED: Quick Gates {name, description} auto-default to severity:medium, type:validation.',
      'Full schema: id, name, severity, criteria[], pass_criteria[], guidance, apply_to_steps[].',
      "Chain step targeting: target_step_number (1-based position) or target_step_id (stable node id, e.g. 'draft-outline' or 'n2'). Either addresses one step; supply whichever you have.",
      'Shell Verification: Use presets for common patterns. loop:true enables autonomous retry until pass.',
      'State-conditional: advertised only while the gate system is enabled. Part of the declared union surface regardless — see CLAUDE.md §Public API Contract.',
    ],
  },
  {
    name: 'force_restart',
    type: 'boolean',
    description:
      "Start a new execution instead of resuming one. Cannot be combined with 'chain_id' (that pair is rejected). Redundant with a plain 'command', which already starts a new chain; it matters only when the command text itself carries a chain id. Distinct from gate_action:'abort': force_restart abandons the current run and immediately begins a new one, while abort ends it and starts nothing.",
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'handoff',
    type: 'boolean',
    description:
      "Mint a single-use handoff token for the run named by 'chain_id', so another client (Codex, OpenCode, a different Claude Code conversation) can claim and continue it. Requires 'chain_id'; nothing else is read. Minting again rotates the token. The run stays yours until the claim lands; your copy is retired on the next persist after that.",
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'claim_token',
    type: 'string',
    description:
      "Claim a run minted elsewhere with 'handoff' and resume it in this conversation in the same call. Send the token ALONE — it names the run, so omit command and chain_id. Single-use: a claimed, rotated, or ended token is refused by name. A claim never rewrites workspace scope; a run from another workspace is refused.",
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'options',
    type: 'record',
    description:
      'Legacy prompt argument/options map. Values remain typed; inline command arguments take precedence. Prefer `inputs` for prompt arguments, especially arrays and objects.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'inputs',
    type: 'record',
    description:
      'Typed prompt arguments supplied outside command-string grammar. Use for arrays, objects, quotes, backslashes, or any value that must arrive byte-for-byte. Precedence: inline command argument > inputs > legacy options > prompt default.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'observations',
    type: 'array<union[{type:unknown_discovered,id,statement,blocking?,target_step_id?}|{type:unknown_resolved,id,statement,resolution}]>',
    description:
      "Declare typed unknowns discovered or resolved this step, feeding the per-run unknowns ledger. Two shapes: `{type:'unknown_discovered', id:'kebab-case-slug', statement:'...', blocking?:true|false, target_step_id?:'...'}` opens a ledger entry; `{type:'unknown_resolved', id:'kebab-case-slug', statement:'...', resolution:'answered'|'irrelevant'}` closes one (statement carries the resolution statement). `target_step_id` on a discovered entry names the downstream step (stable node id, e.g. 'draft-outline' or 'n3') the adaptive mutation policy skips if this unknown later resolves 'irrelevant'.",
    status: 'working',
    compatibility: 'canonical',
    examples: [
      '[{"type": "unknown_discovered", "id": "cache-ttl-unknown", "statement": "TTL for the new cache layer is undecided", "blocking": false, "target_step_id": "draft-outline"}]',
      '[{"type": "unknown_resolved", "id": "cache-ttl-unknown", "statement": "TTL confirmed at 300s per ops runbook", "resolution": "answered"}]',
    ],
    notes: [
      "Applied to the run's unknowns ledger at capture time, in the same call that carries the observation — no extra round-trip.",
      '`id` must be kebab-case and stable within the run so re-discovery of the same id updates rather than duplicates.',
      "`resolution` is required when type is 'unknown_resolved'; omitted for 'unknown_discovered'.",
      "A blocking `unknown_discovered` (with or without `target_step_id`) inserts one `investigate_unknown` step immediately after the current node; `target_step_id` instead governs the skip side — a later `unknown_resolved` with resolution 'irrelevant' skips that ledger entry's target once it is strictly ahead of the current step. Capped at 1 insertion per unknown id and 3 per run, and one insertion per call: when one call declares several blocking unknowns, only the first gets a step and the interrupt names the rest as open with no investigation step (`uninvestigated_unknown_ids`). The server never infers a target and only ever mutates in reaction to an observation — enforcement stays advisory.",
      "A blocking `unknown_discovered` also raises a CHAIN INTERRUPT: the response carries `structuredContent.chain_interrupt` — `{kind:'chain_interrupt', reason:'blocking_unknown', unknown:{id,statement}, open_blocking_unknowns:[{id,statement}…], uninvestigated_unknown_ids:[…], affected_step_ids:[…], remaining_nodes:[…], paused:<bool>, resume:{chain_id, verbs:[…]}}`. `affected_step_ids` is derived from DECLARED `target_step_id` links only; the server never scans text for affected steps.",
      "By default the interrupt rides on the inserted investigation step and the run continues — answer that step to resume. When the run declared `budget.pauseOnBlocking: true` the run instead PAUSES on a synthetic review with the reserved id '__unknown_interrupt__', the response is the interrupt alone, and it is resolved with `gate_action: 'resume' | 'accept_alternative'` (or run-level `abort`). Either way a `remainder` may be submitted to replace the rest of the run.",
    ],
  },
  {
    name: 'workflow',
    type: '{version,nodes[],edges?,gates?,budget?}',
    description:
      "Submit a structured multi-step run instead of a command string. MUTUALLY EXCLUSIVE with 'command' and 'chain_id' — a call carrying more than one is rejected, never resolved by precedence. SHAPE: `{version:1, nodes:[{id:'kebab-case', promptId:'...', stepName?:'...', args?:{}, inputMapping?:{}, outputMapping?:{}, visibility?:{withhold?:[...], expose?:[...]}, subagentModel?:'heavy'|'standard'|'fast', agentType?:'...', framework?:'...', retries?:0, inlineGateIds?:['gate-id'], inlineGateCriteria?:['raw :: token'], delegated?:<boolean>, await?:'node'|'run'}], edges?:[{from:'node-a', to:'node-b'}], gates?:[<same shapes as the 'gates' parameter>], budget?:{maxNodes?:<=32, maxFanOut?:<=8, maxInsertions?:<=3, declaredCostCeiling?:<number>, pauseOnBlocking?:<boolean, default false>}}`. Full field reference: docs/reference/workflow-ir.md.",
    status: 'working',
    compatibility: 'canonical',
    examples: [
      '{"version": 1, "nodes": [{"id": "research", "promptId": "research_docs"}, {"id": "draft", "promptId": "write_summary"}], "edges": [{"from": "research", "to": "draft"}]}',
      '{"version": 1, "nodes": [{"id": "gather", "promptId": "research_docs", "args": {"topic": "caching"}, "outputMapping": {"findings": "gather"}}, {"id": "review", "promptId": "code_review", "subagentModel": "fast", "visibility": {"withhold": ["chain_history"]}}], "edges": [{"from": "gather", "to": "review"}], "gates": [{"id": "source-quality", "target_step_id": "gather"}], "budget": {"maxInsertions": 1, "declaredCostCeiling": 50000}}',
    ],
    notes: [
      "EDGES ARE DEPENDENCIES, NOT BRANCHES. There is no branching runtime; edges are linearized into one total order (Kahn's algorithm, ties broken by declaration order). With no edges the run order is nodes[] exactly as written, so a client that already knows its order can simply write it.",
      "Node ids are the SAME id space as a gate's target_step_id and an observation's target_step_id. A workflow gate binds to a node by declaring target_step_id: '<node id>'.",
      'Structural caps (maxNodes, maxFanOut, maxInsertions) are ENFORCED and may only NARROW the server defaults — asking for a wider cap is rejected, never silently clamped. declaredCostCeiling is RECORDED on the run and never enforced: the server does not meter client tokens.',
      'Rejection is all-or-nothing and writes nothing: an invalid workflow returns one addressed line per problem ([reason] node "x": detail) and creates no run, no session and no version. Every reason names the node or edge it is about.',
      'Never state-narrowed. Unlike the three gate parameters, this one is advertised in every reachable shape, so it can never be silently dropped from a call.',
    ],
  },
  {
    name: 'remainder',
    type: '{mode,nodes[],edges?}',
    description:
      "Rewrite the rest of a RUNNING chain when a blocking unknown has invalidated its shape. SHAPE: `{mode:'replace'|'append', nodes:[<Workflow IR nodes — same shape as workflow.nodes>], edges?:[{from,to}]}`. 'replace' discards every node strictly AFTER the current one and puts these in their place; 'append' adds them strictly after the current remainder and keeps it. The current node is never touched by either mode. Requires 'chain_id'. You author the alternative; the server only validates it — same node/edge schemas, same structural caps as a `workflow` submission, and rejection is all-or-nothing.",
    status: 'working',
    compatibility: 'canonical',
    examples: [
      '{"mode": "replace", "nodes": [{"id": "confirm-ttl", "promptId": "investigate_unknown"}, {"id": "redraft", "promptId": "write_summary"}], "edges": [{"from": "confirm-ttl", "to": "redraft"}]}',
      '{"mode": "append", "nodes": [{"id": "verify-fix", "promptId": "code_review"}]}',
    ],
    notes: [
      "Accepted ONLY while a blocking unknown is open on the run's ledger, or while the reserved '__unknown_interrupt__' review is pending. A remainder on a run with no open blocking unknown is refused by name, never applied.",
      "Node ids are the same id space as `workflow.nodes[].id`, a gate's `target_step_id` and an observation's `target_step_id`.",
      'Caps: `maxNodes` counts nodes already executed PLUS the submitted remainder, so a replacement cannot buy back budget the run has already spent. One accepted remainder per unknown id, and a per-run ceiling in the shape of `budget.maxInsertions`.',
      "On a PAUSED run (budget.pauseOnBlocking) a remainder must be accompanied by `gate_action: 'accept_alternative'` in the same call. On an unpaused run the remainder alone is the acceptance.",
      "ONE MECHANISM, TWO SPELLINGS: `remainder: {mode:'append', nodes:[…]}` and a `chain_id` call whose `command` begins with `-->` are the same append — the string form parses to this structured form. They share validation, caps and recorded provenance and may not diverge. The string form is NARROWER, not different: it derives each node id from the prompt id and carries no edges.",
      "Accepted nodes are recorded on the run with `origin: 'remainder'` and the id of the unknown that motivated them.",
      'A contributed node has no parse-time step for its authoring data to live on, so it carries {id, promptId, stepName, args, delegated} and nothing else. Declaring any other IR node field — inputMapping, outputMapping, visibility, subagentModel, agentType, framework, retries, inlineGateIds, inlineGateCriteria, await — is REFUSED by name rather than accepted and dropped: the run would never see it. Ask for context isolation with `delegated: true`, and bind a gate with the `gates` parameter and its target_step_id.',
    ],
  },
];

export const prompt_engineCommands: ToolCommand[] = [
  {
    id: 'chain-resume',
    summary: 'Resume chain via chain_id + user_response/gate_verdict/gate_action/remainder',
    parameters: [
      'chain_id',
      'user_response',
      'gate_verdict',
      'gate_action',
      'observations',
      'remainder',
    ],
    status: 'working',
  },
];

export const prompt_engineMetadata = { tool: 'prompt_engine', version: 1 };

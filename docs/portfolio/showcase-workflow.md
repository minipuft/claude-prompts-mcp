# Silent showcase production workflow

Use `showcase_pipeline` to guide a client and its subagents from reference research to a rendered, reviewed silent film. Claude Prompts remains the resource and workflow authority. The client performs research, authors production artifacts, writes renderer code, runs rendering and inspects playback. The MCP server prepares instructions, carries results between steps and handles its configured reviews.

## Run from an installed MCP client

A short request is valid:

```text
>>showcase_pipeline brief:"Create a silent 75-second film"
```

A production request supplies explicit source-file ownership:

```text
>>showcase_pipeline brief:"Create a silent 75-second product showcase: explain the problem and goals, introduce relevant capabilities, then show one evidence-backed interaction and its tangible output." constraints:"1920x1080, 30 fps, silent, readable screen text; use actual evidence or label illustration; do not publish." output_root:"media/showcase/output" files:"media/showcase/src/Showcase.tsx"
```

Only `brief` is required. Optional arguments are `constraints`, `output_root`, `files`, `moodboard` and `seed_refs`. The default output root is `media/showcase/output`, resolved in the client's repository. Empty `files` means the implementation brief is discovery-only; the client must report the needed ownership rather than write source. This is an instruction contract, not a filesystem sandbox.

Inspect the prompt in the currently installed client before running it:

```json
{
  "resource_type": "prompt",
  "action": "inspect",
  "id": "showcase_pipeline",
  "detail": "full"
}
```

The supervising client completes the reference brainstorm and chooses the direction before accepting downstream production. When a subsequent response contains an `EXECUTION BRIEF`, pass that entire brief to the client's subagent mechanism. Return its actual output through `prompt_engine`, preserving the exact `HANDOFF RESULT / node: ...` trailer requested by the server. The supervising client submits any requested review verdict against the actual work; a worker does not grade or advance the run itself.

```json
{
  "chain_id": "<returned chain id>",
  "user_response": "<actual worker output, including its required trailer>"
}
```

If the response requires a gate verdict, use the advertised criteria and report satisfied/inapplicable reminders with reasons. Do not insert a stock PASS. A paused or incomplete production run is not a finished render.

## Seven steps and their consumers

| Step                | Resource                       | Handoff                                                                                 |
| ------------------- | ------------------------------ | --------------------------------------------------------------------------------------- |
| Reference direction | Existing `design_muse`         | Source-backed alternatives and planner-selected direction                               |
| Silent story        | `showcase_story`               | Exact screen copy, ordered beats, timing, claim/evidence table                          |
| Visual treatment    | `showcase_treatment`           | Storyboard, beat-addressed color script, typography, brand disposition and pacing       |
| Motion contract     | `showcase_motion`              | Choreography, holds, transitions, editing rhythm and implementation/validation contract |
| Renderer decision   | Existing `tech_recommendation` | Selected engine plus complete re-issuable implementation brief                          |
| Implementation      | Existing `strategic_worker`    | Renderer/source changes, render commands, actual artifacts and verification receipts    |
| Finish review       | `showcase_review`              | Inspected frames/playback, corrections, export manifest and verification limits         |

The story, treatment, motion, implementation and finish-review steps request native client delegation. Reference and renderer decisions remain supervised. This is one ordered chain; a delegation declaration does not prove simultaneous execution or a particular model provider.

The implementation task receives the immediately preceding renderer decision. Its delegated history also carries the earlier motion contract. Finish review receives the implementation result and the motion contract separately, so an engine recommendation cannot replace the specification it is reviewing.

## Production artifact contracts

The templates ask for complete artifacts under caller-owned paths:

- `story.md` and `beats.json`: audience, thesis, observable before/after, exact text, ordered timed events and provenance.
- `treatment.md` and storyboard frames: reference transfers, visual law, color script, hierarchy, typography and brand decision.
- `motion.md` and timing data: beat choreography, transitions, editing, fps/dimensions/duration, deterministic frame strategy and implementation scope.
- Renderer source and a render manifest: entry point, inputs, actual commands, output paths and validation receipts.
- Video, poster and selected stills.
- `review.md` and `export-manifest.json`: inspected paths/times, findings, fixes, executable check results and outstanding limits.

These are client-side authored contracts. They introduce no MCP parameters or runtime schema. A renderer-owned validator may check the beat/timing manifest. The server's `artifacts.produces` enum is unchanged; video/stills are not new enum values.

A reference image, source-derived depiction, conceptual animation, smoke fixture and captured interaction have different provenance. A Claude or Codex actor must be supported by recorded evidence or visibly presented as illustrative. If the chosen story uses an environment or travel metaphor, the client/resource author explicitly authors reusable prompts, gates and frameworks through `resource_manager`; the server does not autonomously learn or create them. Frameworks structure reasoning. Travel may represent state/context progression, not physical enforcement.

## Checks and reviews

The shipped new resources add production instructions, not new executable gate registrations. Normal execution retains applicable configured reviews. Model review and reminder attestations cannot establish that tests ran or that a render was viewed.

The shared design-muse resource may advertise the existing CloudySky creed reminder. This workflow does not edit that resource or gate. After reviewing applicability, the planner can attest `creed-fidelity` as not applicable to the Claude Prompts project, with that concrete reason in `gate_verdict.reminders.not_applicable` (an entry shaped `{id:"creed-fidelity",reason:"This work concerns Claude Prompts, not the CloudySky visual system."}`). Do not claim there is no visual surface: this work is visual. Do not invent CloudySky evidence or submit an unreviewed PASS.

For a hard artifact check, an operator can author a reusable gate through `resource_manager`, using `shell_verify` or a registered `script_tool`. Record the command's actual result and a meaningful negative control. `MCP_SHELL_VERIFY_ALLOWLIST` controls permitted commands, and `MCP_SHELL_VERIFY_ALLOWED_DIRS` controls permitted directories. Defaults refuse undeclared commands. Never imply that a model's PASS is an exit-code check.

Useful production probes include manifest parsing, finite/nonnegative timings, intended duration/dimensions, referenced outputs, frame counts and a render that consumes the selected manifest. Visual review additionally needs actual frame inspection and playback where available. Publishing, logo replacement and README media replacement remain explicit planner decisions.

## Install and inspect in an isolated workspace

`media/showcase/workflow-spec.json` holds installation payloads for the canonical server tools. It is not a second runtime catalog. Resource files are written only by `resource_manager`.

The helper imports the SDK client from server dependencies when present. If absent, install the matching SDK in a private prefix; do not install through shared worktree `node_modules` symlinks:

```bash
SHOWCASE_SDK_ROOT=$(mktemp -d /tmp/showcase-mcp-client-XXXXXX)
npm install --prefix "$SHOWCASE_SDK_ROOT" --ignore-scripts --no-audit --no-fund @modelcontextprotocol/client@2.0.0
export SHOWCASE_MCP_CLIENT_ROOT="$SHOWCASE_SDK_ROOT"
```

From the repository root, select a readable built server entry explicitly when this worktree has no `dist/index.js`:

```bash
export SHOWCASE_SERVER_ENTRY=/absolute/path/to/server/dist/index.js
node media/showcase/workflow-client.mjs install
node media/showcase/workflow-client.mjs inspect
node media/showcase/workflow-client.mjs smoke
```

The client launches a dedicated STDIO process with this checkout's `server/` as `MCP_WORKSPACE`, this checkout's `server/resources/` as `MCP_RESOURCES_PATH`, and a separate temporary runtime root. It reads a known prompt and refuses mutations unless the returned source root matches this checkout. A server selected from another checkout still reads/writes the explicitly selected workspace.

Fresh resources use complete-draft `validate → create → receipt → inspect`. Existing resources use `inspect → preview update → update(expected_version) → receipt → inspect`: create-draft validation rejects an ID that already exists. Every call payload and response is saved in a unique evidence directory. Each helper launch has a separate temporary runtime/version ledger; a version from an earlier process is not an optimistic-lock token for a fresh process. The install mode obtains the current version in the process that applies the update. Retained launch receipts identify each runtime root. `source_workspace` is read-only for history/compare and cannot redirect resource writes.

The `call --payload <file>` mode accepts one `{name,arguments}` object for a canonical tool. Each helper invocation launches its own temporary runtime; use the installed, ongoing MCP client for a production chain rather than treating separate one-call helper processes as a persistent agent session.

## Recorded verification and its limits

The isolated install and final updates succeeded; receipts show the worktree resource root and loaded resources. The extended smoke in `media/showcase/evidence/smoke-2BuNQy/` rendered all seven real server briefs using explicitly labeled fixture outputs. It verified the original brief, complete prior-output mapping, renderer decision in the implementation task, motion in delegated history, and the separate motion/implementation inputs in finish review. It submitted no gate verdict, performed no creative work and cancelled the incomplete final review.

Smoke uses the documented `%clean` modifier exclusively for protocol/mapping verification. Production invocations do not use it. This proves preparation and context propagation; it does not prove creative quality, executed subagents, production gate reviews, video rendering or publishing.

The first step also supplies a concrete static reference assignment that reads the complete original brief from Original Request Intent. Current builds override it with the mapped brief; this preserves a meaningful task for an older cached runtime that does not apply the first-step mapping. Verify the rendered brief in the actual client, because a loaded-resource receipt does not prove that client's engine behavior.

The supervising session also verified the ACTIVE cached client separately: after the parent update, a normal minimal brief-only launch included the concrete reference assignment, original brief and brainstorm mode. An earlier ACTIVE handoff probe showed the literal upstream fixture and original brief in the delegated story step. Those incomplete probe runs were cancelled without fabricated gate verdicts. ACTIVE first launch/handoff and isolated seven-step mapping are distinct checks; neither is a complete creative production run.

A runtime/documentation discrepancy was found and bounded without source changes: `chain-operator-executor.ts` resolves `inputMapping` by direct flat-key lookup. Dotted paths advertised in the chain reference (`chain_args.brief`, `steps.Name.result`) did not resolve in this renderer. The parent therefore uses flat argument names and `previous_step_result`. The first rendered step's challenge and each mapped specialist handoff were checked against literal sentinels.

The finish-review motion source is `step5_result`: motion is the fourth step, stored under 1-based result key 4, while `TextReferenceStore.buildChainVariables` adds 1 when creating this template alias. The extended smoke verified that field contains the motion sentinel rather than the fifth step's renderer sentinel. The fixed seven-step parent contains no automatic insertion policy authored by these templates.

Root's real team-produced storyboard/render is separate from this labeled smoke and must carry its own source, rendering and visual-review receipts.

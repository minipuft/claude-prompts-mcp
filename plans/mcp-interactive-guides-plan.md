# LLM-Aware Tool Guides & Parameter Surfacing

**Status**: Proposed  
**Created**: 2025-02-15  
**Priority**: High  
**Scope**: `prompt_manager`, `prompt_engine`, `system_status`  
**Owner**: MCP Tooling group

---

## Executive Summary

Operators currently guess command verbs and parameters across our MCP tools, triggering unhelpful schema errors and masking feature gaps (e.g., gate scope flags never exposed, `>>listprompts` routed incorrectly). Rather than duplicating prompt_manager features everywhere, we will make each tool self-describing: automatically harvest its actionable operations + parameters, fold that data into a per-tool `guide`/explain flow, and embed the missing behaviors uncovered during audits (prompt_engine parameter gaps, prompt_manager legacy verbs, system_status planned operations). This creates LLM-friendly interactions that stay in sync with the actual implementations.

---

## Current Issues Snapshot

### prompt_engine gaps
- `gate_scope`, `temporary_gates`, `force_restart`, `chain_id` parameters exist but are untested/unannounced.
- `>>listprompts` command misroutes (searches for a prompt instead of listing).
- Executions do not surface custom quality gates/checks or framework state consistently; `execution_mode` override unclear.
- Gate mode differences (enforce/advise/report) lack visual cues.

### prompt_manager friction
- `modify`, `migrate_type`, `suggest_temporary_gates` require brittle argument payloads; validation errors are not actionable.
- Legacy verbs remain exposed even though better flows exist, confusing operators.

### system_status (system_control) gaps
- Core operations (status/framework management/gate listings) work, but analytics/config/maintenance endpoints are planned yet undocumented.
- No structured way to explain which parameters drive each operation.

---

## Guiding Principles

1. **Auto-maintained metadata** – Harvest action/parameter definitions directly from tool modules (switch statements, handler registries, argument schemas). No manual JSON duplication.
2. **Per-tool guides** – Each MCP tool gains a `guide` action that explains *its own* operations, arguments, and current lifecycle (working/planned/deprecated).
3. **Parameter folding** – Guides must surface nested options (e.g., `gate_scope`, `temporary_gates` structures) with contextual defaults so LLMs can generate correctly shaped payloads.
4. **Legacy reduction** – Use guides to steer operators toward canonical verbs while deprecating redundant or low-value actions.
5. **Validation-first** – Fix concrete behavior gaps (listprompts routing, gate visualization, parameter enforcement) alongside guide rollout so the surfaced data matches reality.

---

## Phase Plan

### Phase 1 – Inventory & Telemetry Baseline
- Catalogue every exposed action/parameter for the three tools by instrumenting their handler registries.
- Verify the previously reported issues (parameter untested, routing bugs) and capture reproducible notes.
- Add lightweight telemetry hooks to measure how often unknown actions/parameters are invoked today.
- Deliverable: JSON inventory + issue matrix per tool, committed under `server/src/tooling/action-metadata/`.
  - **Progress (2025-02-15)**: Created `server/src/tooling/action-metadata/{prompt-manager,prompt-engine,system-control}.json` inventories, documented outstanding routing/parameter issues, and added `usage-tracker.ts` instrumentation hooked into prompt_manager, prompt_engine request validation, and system_control handlers.

### Phase 2 – Automated Metadata Extractors
- Implement a shared extractor that reads each tool’s action definitions (e.g., prompt_manager `handleAction` map, prompt_engine command parser, system_status operation map) and emits structured descriptors (name, summary, args, lifecycle, dependencies).
- Hook extractor outputs into build artifacts consumed by MCP tool descriptors so schema + guide data stay synced automatically.
- Add unit tests ensuring extractors fail CI if an action is added without metadata annotations.
  - **Progress (2025-02-15)**: Added typed descriptors under `server/src/tooling/action-metadata/definitions/**`, wired generator `npm run generate:action-metadata` (tsconfig.metadata) to emit JSON before builds, exported telemetry-friendly metadata for all three tools, and enforced validation via `recordActionInvocation` + `verify:action-metadata`.

### Phase 3 – Tool-Specific Guide Flows & Fixes
1. **prompt_manager**  
   - Add `guide` action that consults metadata to explain workflows (e.g., “Attach gate configuration”) with parameter templates.  
   - Improve validation errors for `modify`, `migrate_type`, `suggest_temporary_gates` by leveraging metadata; mark legacy verbs and generate warnings with canonical alternatives.  
   - Begin retirement workflow for low-value verbs (set lifecycle=`deprecated`, update guide messaging).
     - **Progress (2025-02-15)**: Added metadata-driven `guide` action, augmented validation errors/warnings with lifecycle+issue context, and emit legacy hints for `create_prompt`, `create_template`, `modify`, `migrate_type`, and `suggest_temporary_gates`.

2. **prompt_engine**  
   - Create guide responses for execution commands (`>>prompt`, `chain://`, `>>listprompts`) including gate controls, `execution_mode`, framework overrides.  
   - Fix `>>listprompts` routing bug and expose quality gate/custom check rendering plus gate_mode indicators so guide output reflects actual runtime behavior.  
   - Ensure metadata explicitly documents `gate_scope`, `temporary_gates`, `force_restart`, and `chain_id` so LLM clients can set them correctly.
     - **Progress (2025-02-15)**: Added built-in `>>guide` command routed through prompt_engine metadata, added fallback prompt catalog rendering for `>>listprompts`, and injected gate control summaries (quality gates/custom checks/gate_mode/scope/inheritance) into the formatted output.

3. **system_status (system_control)**  
   - Surface existing operations (status/framework/gates) with parameter notes and show planned endpoints (analytics/config/maintenance) as `planned` lifecycle entries.  
   - Guide should clarify how to trigger analytics/history/config paths once implemented, avoiding doc references.
     - **Progress (2025-02-15)**: Introduced `system_control` guide action tied to metadata descriptors and updated `>>help` routing so LLMs receive lifecycle-aware operation summaries (including planned analytics/config/maintenance hooks).

### Phase 4 – Legacy Cleanup & Continuous Sync
- Remove or hide fully deprecated prompt_manager verbs once guide telemetry shows negligible usage.  
- Add regression tests verifying each tool’s `guide` action stays current with metadata and that unknown operations yield smart guidance.  
- Establish a lint/CI rule requiring new tool actions to include metadata annotations so future extensions remain discoverable.  
- Monitor telemetry post-launch to confirm reduction in unknown-action errors and parameter misuse.
  - **Progress (2025-02-15)**: Blocked legacy `create_prompt` / `create_template` actions unless `allow_legacy` is explicitly set, added regression tests for every guide surface (prompt_manager, prompt_engine helper, system_control) plus routing coverage, and wired `validate:metadata` (invokes `verify:action-metadata`) into `validate:all` so CI fails when metadata drifts.

---

## Success Metrics
- 0 instances of raw enum validation errors for unsupported actions (replaced by guide-driven responses).
- Demonstrable fixes for the prompt_engine issues list (validated via automated tests).  
- ≥80% of guide invocations return per-tool, context-aware instructions generated from metadata (no static doc references).  
- Legacy prompt_manager verbs usage drops below 5% before removal.  
- Analytics shows consistent usage of newly surfaced parameters (gate_scope, chain controls) without error spikes.

---

## Validation & Rollout Checklist
1. Metadata extraction unit tests (per tool).  
2. Integration tests covering new guide actions and corrected behaviors (listprompts, gate visualizations).  
3. Telemetry dashboards updated with guide usage + unknown-action metrics.  
4. Migration notes logged in this plan after each phase to track progress and outstanding tasks.

---

## Open Questions
- Should guides call into prompt_engine for richer reasoning or stay deterministic?  
- How do we expose planned-but-unreleased operations without confusing users (e.g., mark as `planned` with ETA)?  
- Do we auto-generate sample payloads for complex parameters (temporary gates) or rely on descriptive text?

All clarifications should be captured in this plan as phases progress.

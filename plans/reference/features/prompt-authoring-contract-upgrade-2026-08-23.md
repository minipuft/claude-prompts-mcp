---
title: "Prompt authoring contract upgrade — P0/P1/P2"
date: 2026-08-23
status: reference
tags: [prompt-engine, resource-manager, authoring]
---

# Prompt Authoring Contract Upgrade

## Intent Declaration

**Work Type**: feature with two bug-fix foundations
**Confidence**: high
**Scope**: `prompt_engine` request contract/pipeline, prompt `resource_manager` lifecycle and
contract, `>>create_prompt`, docs, generated metadata, and regression/integration tests. Medium
risk: public MCP input changes plus resource writes; no new MCP tool or persistence table.
**Problem Statement**: Structured prompt arguments are coerced through command-string syntax,
prompt authoring duplicates and contradicts the canonical resource contract, and write success is
reported without an addressable post-refresh receipt. The desired state is one typed argument path,
one canonical validation/write owner, and a guarded inspect -> preview -> update -> verify workflow.

## Existing Systems Audit

| Capability                  | Existing owner to extend                              | Decision                                                               |
| --------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| Prompt request validation   | `prompt-engine.schema.ts` + `McpToolRequest`          | Add typed `inputs`; keep `options` compatibility                       |
| Inline argument parsing     | `ParsingStage`                                        | Merge typed values after parsing so inline values win                  |
| Produced-prompt validation  | `diagnosePromptWrite` + `ResourceVerificationService` | Reuse for non-mutating `validate`                                      |
| Prompt persistence/rollback | `FileOperations` + `ResourceMutationTransaction`      | Keep as the only writer                                                |
| Registry refresh            | `PromptResourceDependencies.onRefresh`                | Verify the written id after refresh                                    |
| Edit history                | `VersionHistoryService`                               | Use current version as optimistic concurrency token                    |
| Guided authoring            | `examples/create_prompt`                              | Thin to canonical validate/create calls; remove duplicate schema logic |

No fourth MCP tool, graph store, maintenance prompt, or alternate writer is introduced.

## Contract Decisions and Consequence Tracing

### `prompt_engine.inputs`

- **WRITES**: MCP clients and the prompt executor request adapter.
- **READS**: request normalization stores it; parsing merges it into prompt arguments.
- **DECIDES**: inline command arguments override `inputs`; `inputs` override legacy `options` and
  prompt defaults. Non-scalar values never enter command-string grammar.
- **VIEW**: hand-written Zod schema, generated parameter metadata, docs, and schema snapshots.

### `resource_manager action:"validate"`

- **WRITES**: nothing; it accepts the same prompt draft fields as `create`.
- **READS**: prompt lifecycle reuses canonical reference, tool, schema, and template diagnostics.
- **DECIDES**: valid content is the loader's union: user template OR chain steps OR system message.
- **VIEW**: markdown result plus structured draft/diagnostics; action metadata, tool contract, docs.

### `expected_version`

- **WRITES**: clients copy it from `inspect`, `validate`, or mutation receipts.
- **READS**: prompt update compares it with `VersionHistoryService.loadHistory()` before any
  snapshot or file write.
- **DECIDES**: mismatch refuses the update with no write/version consumption; omission preserves
  backward compatibility.
- **VIEW**: contract/schema/router/types, full inspect, validate, and create/update receipts.

### Write receipt

- **WRITES**: create/update after the filesystem transaction and refresh attempt.
- **READS**: clients and `>>create_prompt` maintenance guidance.
- **DECIDES**: a normal hot-refresh mutation is successful only when the refreshed registry sees
  the canonical id; a requested full restart reports `restart_pending` instead of claiming load.
- **VIEW**: structured content contains action/id, config/server/prompts roots, affected files,
  ship status, refresh state, and current version.

## Implementation Table

| Row | Tier | File / owner                                    | Change                                                         | Depends       | Validation                      |
| --- | ---- | ----------------------------------------------- | -------------------------------------------------------------- | ------------- | ------------------------------- |
| 1.1 | P0   | prompt engine schema/contract/types/executor    | Add typed `inputs` pass-through                                | —             | schema + typecheck              |
| 1.2 | P0   | normalization/parsing stages                    | Keep structured inputs out of command text; enforce precedence | 1.1           | unit regression                 |
| 1.3 | P0   | prompt-engine integration tests                 | Cover nested arrays/objects, gates, quotes, and backslashes    | 1.2           | focused Jest                    |
| 1.4 | P0   | prompt lifecycle + file-operation result        | Emit target identity and read-after-refresh receipt            | —             | lifecycle + integration tests   |
| 2.1 | P1   | resource-manager metadata/schema/router/handler | Add prompt-only non-mutating `validate` action                 | 1.4           | contract snapshot + integration |
| 2.2 | P1   | prompt lifecycle validation helpers             | Reuse canonical draft validation and loader content union      | 2.1           | invalid/valid union tests       |
| 2.3 | P1   | `examples/create_prompt` via resource_manager   | Remove duplicate builder contract and route validate -> create | 2.2           | real prompt render smoke        |
| 3.1 | P2   | version history reader + prompt update          | Add optional `expected_version` stale-write refusal            | 2.1           | conflict/no-side-effect test    |
| 3.2 | P2   | prompt inspect/validate/mutation responses      | Project version and verification receipt for maintenance       | 3.1           | end-to-end maintenance flow     |
| 3.3 | P2   | docs + changelog + generated contracts          | Document canonical workflow and precedence                     | 1.3, 2.3, 3.2 | format/contracts                |
| 4.1 | QA   | transport/integration/full suite                | Prove STDIO + fresh-instance HTTP behavior and run repo gates  | 3.3           | project validation suite        |

## Completion Criteria and Test Inventory

| #   | Criterion / behavior                      | Observable proof                                                      | Test type          | Planned test surface             | Status                                           |
| --- | ----------------------------------------- | --------------------------------------------------------------------- | ------------------ | -------------------------------- | ------------------------------------------------ |
| C1  | Nested typed inputs survive unchanged     | Rendered prompt receives exact object/array                           | unit + integration | parsing/prompt-engine tests      | ✓ 203 focused tests + typed-inputs conformance   |
| C2  | Inline arguments win deterministically    | inline > inputs > options/default                                     | unit               | parsing-stage test               | ✓ parsing precedence regression                  |
| C3  | Validate never mutates                    | valid/invalid draft returns diagnostics; no files/version             | integration        | resource-manager workflow        | ✓ side-effect spies remain zero                  |
| C4  | Loader-supported content union creates    | template-only, chain-only, and system-only drafts validate/create     | unit + integration | lifecycle tests                  | ✓ all three content forms                        |
| C5  | Write target is observable                | receipt names resolved roots/files/ship/load/version                  | integration        | resource-manager workflow        | ✓ temp-workspace and live MCP receipts           |
| C6  | Refresh mismatch is not false success     | missing refreshed id yields explicit verification failure             | unit               | lifecycle processor              | ✓ verification-failure response asserted         |
| C7  | Stale maintenance writes are refused      | mismatched expected version writes and versions nothing               | integration        | prompt update/versioning         | ✓ unit + claims-conformance refusal              |
| C8  | `>>create_prompt` uses canonical contract | guided output calls validate/create with inline bodies and full tools | integration smoke  | prompt engine + resource manager | ✓ local HTTP MCP authoring smoke                 |
| C9  | Public contract stays synchronized        | generated metadata/snapshot/docs agree                                | contract           | contract validation              | ✓ generated contracts and conformance coverage   |
| C10 | Both transports remain valid              | STDIO verifier and HTTP integration pass                              | integration/E2E    | existing transport suites        | ✓ verify:mcp 18/18 + HTTP structured-content E2E |

Completeness requirement: every criterion above needs a passing receipt; changed service error paths
must have refusal tests; mocks must use the real return shapes.

## Sources & Inspiration

| Source                                                                   | Applied decision                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `shared/utils/jsonUtils.ts` + normalization/parsing stages               | Direct evidence of object/array coercion                      |
| `modules/prompts/prompt-schema.ts`                                       | Canonical content union for valid prompt YAML                 |
| `ResourceVerificationService` + `ResourceMutationTransaction`            | Existing schema and rollback owners                           |
| `VersionHistoryService`                                                  | Existing per-resource current-version source                  |
| `plans/technical-debt/resource-manager-settability-matrix-2026-08-13.md` | Existing authoring inconsistencies and compensation inventory |
| `docs/guides/mcp-contract-maintenance.md`                                | Contract-layer synchronization procedure                      |

## Resolved Unknowns

- ✓ The existing HTTP MCP harness now asserts `resource_manager` structured content at the wire;
  the local built-server drive additionally exercised a real prompt mutation and render.
- ✓ Retain a thin deterministic script adapter for author-field mapping only. Canonical validation,
  persistence, refresh verification, and version checks stay in `resource_manager`.

## Implementation Record

- New validation, concurrency, and receipt decisions were extracted behind focused services rather
  than increasing the existing lifecycle processor's complexity.
- A stale installed MCP process resolved a plugin-cache resource root and dropped `dry_run`; the
  accidental mutation was restored. Every repository prompt mutation was then driven through the
  freshly built local HTTP server and verified by root, affected-file, refresh, and version receipt.
- The first HTTP conformance run found `inputs` missing from the registration boundary's explicit
  allowlist despite passing type and focused tests. The allowlist, internal request schema, partial
  validator, and claims corpus now carry it end to end.
- Validation receipts: 48/48 repository gates; 2,728 unit tests across 211 suites (1 skipped);
  105/105 claims-conformance scenarios; 18/18 MCP surface checks; HTTP mutation/render smoke passed.

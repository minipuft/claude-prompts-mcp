---
title: "Codex Prompts MCP Parity Remediation"
date: 2026-08-03
status: done
tags: []
---

# Codex Prompts MCP parity remediation

Date: 2026-08-03  
Lifecycle: complete  
Work type: bug_fix  
Secondary type: refactor  
Risk: high — plugin launch, persistent state, local installation

## Intent

Transform the Codex plugin from a Claude-root-token launch that cannot start and a package-local runtime that cannot write under the normal sandbox into a self-contained, plugin-only MCP installation with workspace-owned SQLite/log output. Preserve the curated 26-prompt catalog and the working global `claude_prompts_mcp` fallback until every acceptance gate passes.

### Acceptance

1. The installed plugin launches without `CLAUDE_PLUGIN_ROOT` in argv or environment.
2. SQLite and logs are created beneath an isolated writable runtime root; the installed cache remains immutable.
3. The installed plugin and bundled server have fresh version identities and hashes.
4. Initialize, tool schemas, read behavior, mutation/restart behavior, and error behavior match the working global server.
5. A real plugin-only Codex invocation succeeds under normal `workspace-write` sandboxing.
6. Prompt inventory remains exactly 26.

### Non-goals

- Do not expose all 117 checkout prompts.
- Do not edit prompt, template, or chain resources directly.
- Do not remove or disable the global MCP before acceptance.
- Do not add a shell-specific launcher or network-time `npx` dependency.
- Do not commit or publish remotely.

## Diagnosis

**Host/package boundary mismatch**: the manifest assumes Claude-specific interpolation, while SQLite and logging assume the installed package is writable. Same-version file tarballs add a third cache-identity failure mode.

## Design

### Launch boundary

First measure whether Codex resolves a plugin-relative MCP command under the installed plugin root. If confirmed, invoke the bundled executable directly with `--transport=stdio` and `--client=codex`. Set only a constant relative writable runtime root. Reject shell expansion, global executables, and network resolution.

### Runtime paths

Extend the canonical `PathResolver` rather than creating a parallel resolver:

- `getRuntimeRoot()`: `MCP_RUNTIME_ROOT` -> effective workspace -> package root.
- `getRuntimeStatePath()`: `<runtimeRoot>/runtime-state`.
- `getLogsPath(configuredDirectory)`: retain absolute configuration; otherwise resolve beneath `runtimeRoot`.

The Codex launcher supplies an OS-temp workspace and `MCP_RUNTIME_ROOT=<os.tmpdir()>/codex-prompts/server`, because Codex does not expose the invoking project path to the MCP child. Package resources remain package-owned. The first SQLite initializer receives the explicit DB path through the existing `DatabaseConfig.dbPath` seam.

### Lifecycle

- Global direct MCP: disabled after Tier 6 and a separate post-restart plugin-only cutover test passed; registration retained for rollback.
- Codex plugin source: migrating through Tiers 3-5.
- Installed cache: disposable validation copy.
- Plugin-only path: canonical after Tier 6; global direct MCP remains an explicit fallback pending a separate cutover decision.
- Old `vendor/claude-prompts-3.1.0.tgz`: removed after the 3.1.2 lock, install, hashes, and Tier 6 tests passed.

## Verified ownership

| Concern                 | Existing owner                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| Plugin launch           | `/home/minipuft/Applications/codex-prompts/.mcp.json`                                                       |
| Plugin identity         | downstream `.codex-plugin/plugin.json`, `package.json`, `package-lock.json`                                 |
| Hook workspace fallback | downstream `hooks/_codex_bootstrap.py`                                                                      |
| Path precedence         | `server/src/runtime/paths.ts`                                                                               |
| Logger construction     | `server/src/runtime/context.ts`                                                                             |
| Earliest SQLite startup | `server/src/runtime/module-initializer.ts` -> `resource-change-tracking.ts` -> `resource-change-tracker.ts` |
| SQLite path seam        | `server/src/infra/database/sqlite-engine.ts` `DatabaseConfig.dbPath`                                        |
| STDIO regression        | `server/tests/e2e/mcp-server-smoke.test.ts`                                                                 |
| Version sync            | `server/scripts/sync-versions.js`                                                                           |
| Artifact validation     | `server/scripts/verify-package-artifact.js`                                                                 |

## Implementation plan

### Tier 3 — launch path

| #   | Status | File                                | Change                                                                                                           | Verify                                                    |
| --- | ------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 3.1 | ✓      | Installed dev cache                 | Reversible probe of plugin-relative command resolution                                                           | Codex logs resolved executable; no module-not-found error |
| 3.2 | ✓      | downstream `.mcp.json`              | Replace root-token argv/env with measured `node` + relative entrypoint + plugin-root `cwd`, and Codex/STDIO args | JSON parse; no root token; raw initialize starts          |
| 3.3 | ✓      | downstream `tests/test_adapters.py` | Add manifest contract assertions                                                                                 | `python3 -m pytest tests/test_adapters.py`                |

**Tier 3 gate:** downstream pytest plus plugin-only startup with temporary unrestricted writes. This proves launch only; normal sandbox is reserved for Tier 6.

### Tier 4 — writable state and logs

| #   | Status | File                                                                 | Change                                                                                           | Verify                          |
| --- | ------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------- |
| 4.1 | ✓      | `server/src/runtime/paths.ts`                                        | Add runtime-root/state/log methods and resolved-path fields                                      | Focused unit tests              |
| 4.2 | ✓      | `server/src/runtime/context.ts`                                      | Construct log file from `PathResolver`                                                           | Isolated foundation/server test |
| 4.3 | ✓      | `server/src/infra/observability/tracking/resource-change-tracker.ts` | Accept explicit `dbPath`; pass existing SQLite config                                            | Tracker integration tests       |
| 4.4 | ✓      | `server/src/runtime/resource-change-tracking.ts`                     | Forward resolved DB path                                                                         | Typecheck                       |
| 4.5 | ✓      | `server/src/runtime/module-initializer.ts`                           | Compute and inject first SQLite DB path                                                          | Read-only-package launch        |
| 4.6 | ✓      | downstream `hooks/_codex_bootstrap.py`                               | Default Codex workspace to the OS-temp `codex-prompts` workspace, retain explicit env precedence | Adapter subprocess tests        |
| 4.7 | ✓      | `server/tests/e2e/mcp-server-smoke.test.ts`                          | Assert DB/log placement and unchanged package tree                                               | Targeted Jest test              |
| 4.8 | ✓      | new `server/tests/unit/runtime/paths.runtime.test.ts`                | Test runtime path precedence and isolation                                                       | Targeted Jest test              |

**Tier 4 gate:** typecheck, focused tests, then packaged-server launch from a read-only copy with a writable temporary runtime root. DB/log writes must occur only under the runtime root.

### Tier 5 — fresh artifacts and install

| #   | Status | File                                         | Change                                                               | Verify                                                                        |
| --- | ------ | -------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 5.1 | ✓      | server package/lock + synchronized manifests | Bump 3.1.0 -> 3.1.2 using version-sync workflow                      | `npm run validate:versions`                                                   |
| 5.2 | ✓      | downstream `vendor/claude-prompts-3.1.2.tgz` | Build, pack, inspect, and verify with temp npm cache                 | Manual tar inspection reports 3.1.2; package-size verifier deviation recorded |
| 5.3 | ✓      | downstream package/lock/plugin manifest      | Bump plugin 0.1.0 -> 0.1.2 and refresh install against 3.1.2 tarball | Source, lock, and node_modules versions/hashes agree                          |
| 5.4 | ✓      | local Codex dev install                      | Reinstall through supported marketplace commands                     | Cache plugin=0.1.2; nested server=3.1.2                                       |

**Tier 5 gate:** exact versions and hashes agree across source tarball, downstream lock/install, and Codex cache.

### Tier 6 — acceptance

| #   | Status | Test                       | Pass condition                                                                      |
| --- | ------ | -------------------------- | ----------------------------------------------------------------------------------- |
| 6.1 | ✓      | Normalized JSON-RPC parity | Initialize and all three tool contracts/behaviors match; prompt count=26            |
| 6.2 | ✓      | Mutation/restart parity    | Create, inspect, render, update, restart, delete, restart sequence matches baseline |
| 6.3 | ✓      | Real plugin-only Codex     | Tool call succeeds in normal sandbox; no launch, EROFS, or read-only DB error       |
| 6.4 | ✓      | Filesystem audit           | State/logs under workspace `server/`; installed cache has no mutable outputs        |
| 6.5 | ✓      | Evidence notes             | Commands, results, versions, hashes, and lifecycle decision recorded                |

**Tier 6 gate:** all rows pass. The separate explicit cutover completed after restart; the global registration remains configured but disabled for reversible rollback.

## Testing strategy

| What to test                       | Test type              | Location                                          | Why                                               |
| ---------------------------------- | ---------------------- | ------------------------------------------------- | ------------------------------------------------- |
| Manifest path and token absence    | Static contract        | downstream pytest                                 | Fast regression for the exact launch defect       |
| Runtime path precedence            | Unit                   | `server/tests/unit/runtime/paths.runtime.test.ts` | Deterministic env/path edge coverage              |
| Earliest SQLite injection          | Integration            | tracker and startup tests                         | Singleton path is decided on first initialization |
| Actual state/log placement         | E2E subprocess         | MCP smoke + temporary packaged copy               | Exercises composition and filesystem permissions  |
| MCP protocol and schemas           | Differential JSON-RPC  | `/tmp` probe                                      | Exact comparison to working global baseline       |
| Stateful operations across restart | Differential mutation  | `/tmp` probe                                      | Proves persistence, hot reload, and cleanup       |
| Real host sandbox                  | Manual host acceptance | plugin-only `codex exec`                          | Captures host resolution and sandbox behavior     |
| Curated catalog                    | Inventory assertion    | parity probe                                      | Prevents accidental 117-prompt exposure           |

## Done criteria

| Criterion                               | Validation                       | Pass condition                                                        |
| --------------------------------------- | -------------------------------- | --------------------------------------------------------------------- |
| Launch independent of Claude root token | Manifest scan + Codex logs       | Token absent; executable resolves                                     |
| Writable runtime                        | Read-only-package test           | DB/logs exist only under runtime root                                 |
| Fresh identity                          | Versions, lock integrity, hashes | 3.1.2 server and 0.1.2 plugin everywhere                              |
| Protocol parity                         | Normalized JSON-RPC diff         | Empty diff for required surface/behaviors                             |
| Mutation parity                         | Restart sequence                 | Every expected transition passes                                      |
| Default sandbox                         | Real plugin-only call            | Tool available; no filesystem error                                   |
| Catalog curation                        | Prompt inventory                 | Exactly 26                                                            |
| Migration closeout                      | Artifact/reference search        | No active 3.1.0 downstream reference; old tarball removed after guard |

## Documentation

| Doc                                                | Update needed                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `plans/codex-prompts-port-implementation-notes.md` | Record measured launch/runtime behavior and Tier 3-6 evidence                    |
| downstream `README.md`                             | Update troubleshooting/install version only if commands or visible paths changed |
| `CHANGELOG.md`                                     | Fixed: Codex relative launch and sandbox-writable state/log paths                |

## Risks and rollback

| Risk                                                  | Impact                   | Mitigation                                             | Rollback                                         |
| ----------------------------------------------------- | ------------------------ | ------------------------------------------------------ | ------------------------------------------------ |
| Codex does not resolve relative MCP commands          | Plugin still absent      | Probe before source edit                               | Restore current dev install; keep global MCP     |
| Runtime root changes resource selection               | Wrong prompt inventory   | Separate `MCP_RUNTIME_ROOT` from content workspace     | Remove runtime env/method use                    |
| SQLite singleton initialized before explicit DB path  | Write still hits package | Inject at earliest tracker construction and E2E assert | Revert injection; global remains active          |
| Version bump collides with unrelated worktree changes | Review/release noise     | Minimal hunks; inspect diffs before and after sync     | Revert only owned version lines                  |
| Cached plugin copy remains stale                      | False validation         | Assert installed versions and hashes                   | Remove/reinstall dev plugin cache                |
| Platform-specific executable behavior                 | Non-Linux plugin failure | Avoid shell wrapper; document measured host/CI scope   | Keep direct global MCP fallback on affected host |

## Release

Commit convention: `fix(codex-plugin): make launch and runtime paths sandbox-safe`  
Scope: `codex-plugin`  
No commit, tag, or publication without explicit approval.

## Growth capture

- [x] Capture the host/package boundary mismatch if independently observed again.
- [x] Record Codex relative-command behavior as measured project knowledge.
- [x] Record runtime-root separation as a reusable MCP packaging consideration in implementation notes.

## Deviations

1. Tier 3 measured that a relative `command` is resolved from the session cwd, not the plugin root. The working Codex 0.146 shape is `command: node`, a relative entrypoint argument, and `cwd: .`; `codex mcp get codex-prompts` resolves `cwd` to the installed plugin root and a real plugin-only tool call passed. Runtime-root injection remains Tier 4 because a relative environment path would otherwise resolve beneath that read-only plugin cwd.
2. Tier 3 `validate:all` reached `validate:format` and failed on pre-existing unrelated worktree state: deleted tracked plan files and an existing `README.md` formatting warning. Tier-specific downstream tests, server typecheck, lint ratchet, test-typecheck ratchet, and all 1,912 unit tests passed.
3. Tier 4 measured that Codex strips `PWD`, `INIT_CWD`, and project/workspace environment from plugin MCP subprocesses when `cwd: .` resolves to the installed plugin root. A project-specific runtime path therefore cannot be derived by the server on Codex 0.146. The conservative cross-platform fallback is `<os.tmpdir()>/codex-prompts/server`, set by a focused Node launcher and mirrored by hook bootstrap; explicit `MCP_WORKSPACE` and `MCP_RUNTIME_ROOT` still override it. This preserves restart persistence within the OS temp lifecycle and passes the default writable-root model, but project isolation remains a documented host limitation.
4. Tier 5 selected server version 3.1.2 rather than planned 3.1.1 after the npm registry showed 3.1.1 already published. The 3.1.2 source, vendored tarball, downstream install, and Codex cache identities and hashes agree; final plugin identity is 0.1.2.
5. Tier 5 `verify:package-artifact` fails the repository's current package-size budgets: 2,641,372 packed bytes exceed 2,500,000 and 16,516,450 unpacked bytes exceed 10,000,000. Manual tar identity/content inspection passed, but the budget failure remains a release blocker outside the parity identity gate.
6. Reinstalling the plugin removed cache versions while their hooks were still attached to the original live session, causing repeated missing-hook failures. The user restored temporary compatibility paths as needed; after restart and cutover validation, the orphaned 0.1.1 compatibility cache was removed. Only cache 0.1.2 remains.
7. Tier 6 exposed a second host boundary: headless `codex exec` cancels plugin MCP calls that use the default approval mode because no interactive approval reader is available. A reversible cache probe proved `default_tools_approval_mode: "approve"` fixes the cancellation while retaining `workspace-write`. The source manifest now declares that mode, the plugin was bumped to 0.1.2, and a clean installed-cache test completed `system_control` plus `resource_manager` with exactly 26 prompts.
8. Final Tier 6 differential results: protocol initialization and three tool contracts match exactly; six non-catalog behavior cases match after normalization; the intentional prompt inventory delta is 117 global versus 26 plugin; all ten create/update/restart/delete mutation phases match exactly. Filesystem audit found four mutable DB/log files under `/tmp/codex-prompts/server` and zero under cache 0.1.2.
9. Final server gates passed typecheck, lint ratchet, test-typecheck ratchet, and 159 suites / 1,917 unit tests. `validate:all` again stops at existing root formatting/deleted-plan state (`CONTRIBUTING.md`, `README.md`, `plans/acquisition-recovery.md`, and four deleted tracked plan files); this is unrelated to the Tier 3-6 artifacts and remains a repository-wide gate failure.
10. Post-restart cutover validation ran a fresh normal `workspace-write` session without an override: only `mcp__codex_prompts__*` tools were present, the catalog remained 26, and `>>test_default count:"9"` rendered `Generate exactly 9 items.` The global `claude_prompts_mcp` registration is now persistently `enabled = false`; `/tmp/codex-config-before-claude-prompts-disable.toml` is the rollback backup.

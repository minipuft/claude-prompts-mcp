---
title: "Plugin data persistence — implementation notes"
date: 2026-09-14
status: active
tags: [runtime, hooks, distribution, plugin]
---

# Implementation Notes — `plans/plugin-data-persistence-2026-09-14.md`

Session voice. Reader-facing text belongs in the commit subject, the CHANGELOG or the docs.

## Origin (2026-09-14)

Found while planning the tutorial rework. The owner ruled that the tutorial's first step is asking Claude to write a
prompt, which made "where does that prompt live" the reader's first experience. Measured in the source: `.mcp.json`
sets `MCP_WORKSPACE=${CLAUDE_PLUGIN_ROOT}` only, and `render-distributions.mjs` drops `MCP_RUNTIME_ROOT` from that
projection. Claude Code's docs say the plugin root changes on each update. On this machine claude-prompts loads from
the source checkout, so a real update could not be observed; per-plugin data directories exist, empty, for
marketplace-installed plugins (`~/.claude/plugins/data/<plugin>-<marketplace>/`), and one named
`claude-prompts-inline` exists from a `--plugin-dir` load in March.

## Row 0.1 accepted (2026-09-14)

Worker P built a throwaway plugin under a temp directory and ran one `claude -p` session with `--plugin-dir`.

| Question                                                                    | Claude Code 2.1.272            |
| --------------------------------------------------------------------------- | ------------------------------ |
| `${CLAUDE_PLUGIN_DATA}` substituted in `.mcp.json` `env`                    | yes                            |
| substituted in `args`                                                       | yes                            |
| `CLAUDE_PLUGIN_DATA` in the MCP server's environment without being declared | yes (`CLAUDE_PLUGIN_ROOT` too) |
| in the `SessionStart` hook's environment, and substituted in its command    | yes                            |
| data directory exists when the server's first line runs                     | yes, empty                     |
| bare `PLUGIN_DATA` / `PLUGIN_ROOT`                                          | not set                        |

The positive control held: `${CLAUDE_PLUGIN_ROOT}` resolved in env, args and the hook command. `~/.claude/settings.json`,
`installed_plugins.json` and `known_marketplaces.json` hashes were unchanged, and the probe's data directory was
removed.

**This is the mirror image of the Codex measurement** in the agent-plugins migration (DEV-T4-3), where `PLUGIN_DATA`
reached hooks but not the MCP child. The two clients differ, which is why R2 keeps the canonical file unchanged.

**Naming.** A `--plugin-dir` plugin gets `~/.claude/plugins/data/<name>-inline`. Marketplace installs follow
`<name>-<marketplace>`, inferred from existing directories rather than a fresh install.

**Consumers the worker must enumerate:**

- the renderer and its self-test, which asserts the drop;
- `hooks/lib/workspace.py` `get_state_db_path()`;
- the hook-owned `hooks-state.db` under `{CLAUDE_PLUGIN_ROOT}/server/runtime-state`, which is transient session rows,
  noted rather than moved unless the worker finds a durable reader;
- `scripts/hook-harness.mjs`;
- `extension-publish.yml`'s render check;
- CLAUDE.md §Environment (paths) and its `AGENTS.md` projection;
- any doc that says the Claude Code plugin's workspace is the plugin root.

## Worker W accepted in part (2026-09-14)

Rows 1.1, 1.2 and 1.4 merged. Planner probes re-ran the render check, its self-test and the new hook cases. Row 1.3's
drive found the gap that row 1.5 now owns: a workspace resolves resource directories by existence, and an empty data
directory has none.

**Owner's `--plugin-dir` dev setup, read from the code by W:**

- **Moves:** `state.db` goes from the checkout's `runtime-state/` (1.9 MB, live) to
  `~/.claude/plugins/data/claude-prompts-inline/runtime-state/`, starting empty. Gate toggles, framework selection,
  argument history and version history start over, and logs move too.
- **Stays:** resources, because the shell's `MCP_RESOURCES_PATH` still wins; the packaged config; and hook-owned
  `hooks-state.db` / `verify-state.db` in `server/runtime-state`.
- **Hooks:** until the new server writes its first `state.db`, the hooks fall back to the checkout's stale one. To keep
  history, copy the old `state.db` into the data directory once. That is the owner's call.

**Closed, not rows:**

- **Project-scope skills-sync export** resolves a relative `outputDir.project` against `MCP_WORKSPACE`
  (`skills-sync/service.ts` near 784). The plugin server's value moves from the plugin root to the data directory, and
  neither is the user's project. ✗ KILLED (2026-09-14 · no plugin user runs a project-scope export from the plugin
  server's workspace, and the old base was not the project either · revives if a user reports an export landing in
  the plugin data directory)
- **Codex hooks and `CLAUDE_PLUGIN_DATA`**: unmeasured. If Codex sets the variable, its hooks check a directory the
  Codex server never writes. ✗ KILLED (2026-09-14 · harmless unless a `state.db` exists there, and codex-prompts runs
  its own launcher · revives if a Codex hook reads a `state.db` its server did not write)
- **`docs/guides/gates.md` near 317** shows the plugin with `MCP_WORKSPACE=~/.claude/`, which the plugin's own env
  overrides. ✗ KILLED (2026-09-14 · wrong before this change, and the file is mid-edit in the `claude-prompts-mcp-findings`
  worktree · revives when that worktree's changes merge, as a row of its own)
- **`AGENTS.md` sits 575 bytes under its budget** after row 1.4. Recorded for the next guidance edit.

## Shared node_modules emptied mid-run (2026-09-14)

**What happened.** The main checkout's root `node_modules` was emptied at 22:23:18, down to 0 entries with its
`.package-lock.json` gone. `server/node_modules` followed at 22:23:28. Both lockfiles were unchanged. Every worktree
symlinks to these trees, so commits failed at commit-msg (commitlint missing) and every worker's tests and build tools
were gone. A commit at 22:19:45 had still passed commitlint; the next attempt, at 22:24:54, failed.

**Restored.** The planner ran `npm ci` at the main checkout root (403 packages) and in `server/` (690 packages) from the
committed lockfiles. `validate:lockfile-sync` reports OK, `core.hooksPath` is unchanged, and the checkout is clean.

**Ruled out, each by reading or measuring:**

- worker W2's drive staging: `rm -rf` only on `/tmp/w2-drive/<x>`, `cp -r` without dereferencing, and no symlinks
  anywhere under the drive directory;
- `drive.mjs`, which removes nothing;
- `scripts/stage-server-runtime.sh`, which deletes only inside its target argument;
- W2's new e2e test, which removes only its own `mkdtemp` workspaces;
- the jest `package-resources-guard` setup and teardown;
- the repo's git hooks (`commit-msg`, `pre-commit`, `pre-push`), none of which runs npm, rsync or rm;
- `scripts/sync-to-cache.sh`, which only copies;
- other Claude sessions in the main checkout, none of whose transcripts changed in the window;
- W2's commits, at 22:19 (hooks passed) and 22:35 (after the restore).

**Cause: unidentified.** Two trees emptied ten seconds apart, root first, with each directory itself kept. That looks like
a delete that ran through a path resolving into each tree. No command recorded in this run matches it. A command
outside the run, including one in the owner's terminal, is not excluded; the owner is asked.

**Guard adopted.** Workers W2 and R bracket every test suite, drive and commit with a fingerprint of the shared trees:
entry counts for root and `server/node_modules`, plus the presence of `jest` and `commitlint`. They stop and report the
bracketed command on any drop, so a repeat names its own cause.

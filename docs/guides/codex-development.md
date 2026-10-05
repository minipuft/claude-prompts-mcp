# Develop Claude Prompts MCP with Codex hooks active

Use this guide to test the current Claude Prompts MCP checkout through the
`codex-prompts` wrapper, including its routing, chain, and gate hooks. Claude
Prompts composes workflow guidance and evaluates gates; Codex executes the client
work. The normal `dev` mode packages the latest engine and shared hooks together
so the wrapper can use them in the same session.

## Prerequisites

- Node.js 24, Python 3, Git, and a Codex CLI with native plugin commands.
- Installed, locked `server/` dependencies, including `smol-toml`.
- A `codex-prompts` checkout beside this repository, or `--wrapper PATH` pointing
  to it. The staging input includes tracked wrapper runtime files.
- The three explicit configuration entries below. Keep their table spellings;
  the direct entry's `command` and `args` must each occupy one line.

The operator script uses `$CODEX_HOME/config.toml`, defaulting to
`~/.codex/config.toml`. `--config PATH` selects another configuration and its
adjacent plugin cache. Native `dev` installation requires the basename
`config.toml`, because the Codex installer selects its home directory.

```toml
[mcp_servers.claude_prompts_mcp]
command = "node"
args = ["/absolute/path/to/claude-prompts-mcp/server/dist/index.js", "--client=codex"]
enabled = true

[plugins."codex-prompts@minipuft"]
enabled = false

[plugins."codex-prompts@codex-prompts-dev"]
enabled = false
```

Keep the existing `~/.config/codex-prompts/config.json` resource configuration:
its `resourcesPath` points to this checkout's canonical `server/resources/` directory.
The staged engine also contains packaged fallback resources. This external user
setting decides the live resource source; staging does not rewrite it. Existing
native skills and generated rule projections keep their separate sync mechanism.

## Refresh and activate development mode

Run these commands from the Claude Prompts MCP checkout:

```bash
node scripts/codex-server.mjs status
node scripts/codex-server.mjs dev
node scripts/codex-server.mjs status
```

The script resolves the engine checkout from its own location, so an absolute
script path works from another directory. To choose a different wrapper or an
isolated Codex home, use:

```bash
node scripts/codex-server.mjs dev --wrapper /path/to/codex-prompts --config /path/to/codex-home/config.toml
```

`dev` runs `npm run build` and `npm run verify:mcp` inside `server/`, then
materializes a plugin at
`<codex-home>/dev-marketplace/plugins/codex-prompts`. It copies the wrapper's
Codex adapters and places the current engine and shared Python hooks under
`node_modules/claude-prompts/`. Root `hooks/lib` is deliberately omitted so the
existing adapter bootstrap resolves the packaged upstream hook library.

Before installation, the staged artifact must pass MCP initialization,
tool discovery, shared-hook resolution, and symbolic prompt-routing checks.
The script registers the managed local `codex-prompts-dev` marketplace, installs
through native Codex plugin commands, and compares installed artifact hashes.
It enables `codex-prompts@codex-prompts-dev`, disables the direct and published
entries, and sets `features.hooks = true`. No plugin publication is needed.

**Run `dev` again after engine, shared-hook, or Codex-adapter changes.** Each call
rebuilds, verifies, stages, and refreshes the installation. There is no automatic
watcher. Source edits alone do not update the installed plugin.

## Reconnect and verify the session

Reconnect or restart Codex after switching or refreshing: existing MCP processes
keep their loaded code. When Codex reports hooks awaiting review, open `/hooks`
and review the definitions. Codex tracks trust by definition hash; new or changed
definitions require review. This script does not grant or bypass hook trust.
Updating shared hook code does not itself prove a definition's hash changed.

Check `status` for source, staged, and installed bundle, shared-hook, adapter, and
resource hashes. After a successful refresh, available drift fields should be
`false`; `null` means evidence is unavailable. Investigate reported errors or
drift before relying on the installation. Resource hashes cover packaged inputs,
not the independent live user configuration.

In the reconnected session, call `system_control(action:"status")` to confirm the
attached MCP server responds, then invoke a symbolic command such as
`>>strategic_implement` to check routing. Observe the relevant hook and
gate behavior for the workflow you are testing. A configured path, cached version,
or clean hash comparison cannot identify what an already running session loaded.

## Other modes and isolated checks

```bash
node scripts/codex-server.mjs engine-only
node scripts/codex-server.mjs prod
node --test scripts/codex-server.test.mjs scripts/codex-dev-plugin.test.mjs
node scripts/codex-server.mjs status --config /tmp/codex-test/config.toml
```

`engine-only` builds and verifies, enables the direct checkout MCP entry with
`--client=codex`, and disables both wrapper entries for isolated engine testing.
`prod` enables the existing cached `codex-prompts@minipuft` release and disables
direct and dev entries. It does not install, update, or build that release; the
published cache must already exist. Reconnect after either switch. `status` is
read-only and reports configuration and provenance, with session identity unknown.

The Node tests use temporary homes and fixture subprocesses. They do not establish
that your current Codex session loaded the plugin or approved its hooks.

## Backups and failed refreshes

Configuration backups named `config.toml.bak.codex-server.*` are private (`0600`);
artifact backups use private directories. Retain their permissions because the
original configuration may contain credentials. Changes preserve unrelated settings
and comments. Missing entries, invalid TOML, unsupported layouts, linked config
files, conflicting marketplace sources, and unmanaged staging targets are refused.

On installation failure, rollback restores prior managed stage, installed artifact,
and settings when it can safely do so. A newly valid marketplace registration may
remain for retry. Concurrent external edits are preserved; an incomplete rollback
is reported instead of overwriting them. Switching and staging use lock files;
check that no operation is active before removing a leftover lock.

See [Codex hooks](https://developers.openai.com/codex/hooks) for trust review and
[client integration](client-integration.md) for client-aware handoffs.

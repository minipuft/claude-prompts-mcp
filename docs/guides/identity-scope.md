# How to Configure Multi-Tenant Identity Scope

This guide shows you how to isolate state per workspace or organization when deploying the MCP server to multi-user environments. Use this when multiple Claude Code instances, Codex sessions, or API clients share a single server.

## Prerequisites

- Claude Prompts MCP server v1.7+
- Node.js >= 22.13.0 (required for unflagged native SQLite)
- Understanding of your deployment transport (STDIO vs streamable-HTTP)

## How It Works

The server extracts identity from MCP SDK transport metadata and uses it to isolate all persisted state (chain sessions, framework switches, gate system state) per workspace.

```
MCP SDK extra ──► RequestIdentityResolver ──► continuityScopeId ──► SQLite scoped queries
   │                                              │
   ├─ authInfo.extra (OAuth claims)               ├─ workspaceId (highest priority)
   ├─ requestInfo.headers (gateway headers)       ├─ organizationId (fallback)
   └─ launch defaults (CLI flags)                 └─ "default" (single-tenant fallback)

MCP request options ──► RequestIdentityResolver ──► clientProfile ──► handoff strategy
   │                                                │
   └─ options.client_profile (hint)                ├─ task_tool_v1 (Claude Code)
                                                    ├─ spawn_agent_v1 (Codex)
                                                    ├─ gemini_subagent_v1 (Gemini)
                                                    ├─ opencode_agent_v1 (OpenCode)
                                                    ├─ cursor_agent_v1 (Cursor)
                                                    └─ neutral_v1 (unknown fallback)
```

All scope parameters are optional. Single-tenant deployments (STDIO with Claude Desktop) work unchanged with the `default` scope.

## Configure Identity for STDIO (Claude Desktop / CLI)

Use CLI flags to pin identity at launch time:

Client presets: `claude-code`, `codex`, `gemini`, `opencode`, `cursor`, `unknown`.

| Client preset | Handoff profile      | Status               | Handoff note                                                 |
| ------------- | -------------------- | -------------------- | ------------------------------------------------------------ |
| `claude-code` | `task_tool_v1`       | canonical            | Task tool flow                                               |
| `codex`       | `spawn_agent_v1`     | canonical            | `spawn_agent` preferred with runtime fallback guidance       |
| `gemini`      | `gemini_subagent_v1` | canonical            | Gemini sub-agent capability guidance                         |
| `opencode`    | `opencode_agent_v1`  | canonical            | OpenCode agent capability guidance                           |
| `cursor`      | `cursor_agent_v1`    | experimental/testing | Cursor handoff strategy is enabled but explicitly in testing |
| `unknown`     | `neutral_v1`         | canonical            | Neutral fallback instructions                                |

```bash
# Pin to a specific workspace
node dist/index.js --transport=stdio --workspace-id=my-workspace

# Pin to an organization (workspace falls back to organization)
node dist/index.js --transport=stdio --organization-id=my-org

# Pin handoff client profile at launch (recommended for deterministic client routing)
node dist/index.js --transport=stdio --client=codex

# Locked mode: reject any per-request overrides
node dist/index.js --transport=stdio --workspace-id=my-workspace --identity-mode=locked
```

For Claude Desktop, add the flags to your MCP server configuration:

```json
{
  "mcpServers": {
    "claude-prompts": {
      "command": "node",
      "args": [
        "/path/to/dist/index.js",
        "--transport=stdio",
        "--workspace-id=team-alpha",
        "--client=claude-code"
      ]
    }
  }
}
```

## Configure Identity for HTTP (Multi-Tenant Gateway)

When deployed behind an API gateway (Kong, Envoy, NGINX) that injects identity headers:

```bash
# The port comes from the PORT env var or `server.port` in config.json.
# There is no --port flag; the CLI parses with strict:false, so one would be
# accepted silently and ignored.
PORT=3000 node dist/index.js --transport=streamable-http
```

The server reads these headers automatically:

| Header                           | Maps To              | Priority   |
| -------------------------------- | -------------------- | ---------- |
| `x-workspace-id`, `x-project-id` | `workspaceId`        | Highest    |
| `x-organization-id`, `x-org-id`  | `organizationId`     | Fallback   |
| `x-actor-id`, `x-user-id`        | `actorId`            | Audit only |
| `mcp-session-id`                 | `transportSessionId` | Audit only |

OAuth token claims (via `authInfo.extra`) take priority over headers when both are present.

## Configure via config.json

Add an `identity` section to your `config.json`:

```json
{
  "identity": {
    "mode": "permissive",
    "allowPerRequestOverride": true,
    "launchDefaults": {
      "organizationId": "my-org",
      "workspaceId": "my-workspace"
    }
  }
}
```

CLI launch flags (`--workspace-id`, `--organization-id`, `--client`) override `identity.launchDefaults` in memory for that server process.

### Policy Modes

| Mode                   | Behavior                                                                                                                                  | Use Case                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `permissive` (default) | HTTP: per-request claims override launch defaults. STDIO: launch defaults preferred, overrides allowed if `allowPerRequestOverride: true` | Multi-tenant gateways, development  |
| `locked`               | Launch defaults always authoritative. Override attempts are logged and rejected.                                                          | Production single-workspace servers |

### Resolution Priority

The server resolves identity through this hierarchy (first match wins):

| Source                                             | Transport | When Used                       |
| -------------------------------------------------- | --------- | ------------------------------- |
| OAuth token claims (`authInfo.extra`)              | HTTP      | Gateway forwards JWT claims     |
| Request headers (`x-workspace-id`)                 | HTTP      | Gateway injects headers         |
| Launch defaults (`--workspace-id`)                 | Both      | CLI flags or config             |
| Derived project scope (`CLAUDE_PROJECT_DIR` → cwd) | Both      | Nothing explicit was configured |
| Default (`"default"`)                              | Both      | No directory yields a basename  |

### Derived Project Scope

When neither a CLI flag nor `identity.launchDefaults.workspaceId` supplies a workspace, the server
derives one from its launch environment: `CLAUDE_PROJECT_DIR` if set, otherwise the working
directory. The value is reduced to a **basename** — `/home/dev/spicetify-theme` becomes
`spicetify-theme` — so a full home-directory path is not written into `kv_state.workspace_id` or
printed in logs.

Explicit configuration always outranks derivation, so setting `--workspace-id` cannot be
overwritten by the directory the server happens to start in.

The resolved value and its source are reported once at startup:

```
[INFO] Project scope id: spicetify-theme (source: CLAUDE_PROJECT_DIR)
[INFO] Project scope id: claude-prompts-mcp (source: cwd)
[INFO] Project scope id: workspace-a (source: explicit configuration)
```

**Check this line before trusting isolation.** If two projects report the same scope id, they share
one row and a framework switch in either is visible to both. That happens when the launcher gives
every server the same working directory and does not set `CLAUDE_PROJECT_DIR` — the fix is to pass
`--workspace-id` explicitly in the MCP server registration.

Scopes that have never been written adopt the configured `frameworks.defaultFramework`, not
whatever another workspace is currently using. One exception covers upgrades: the first scoped load
adopts a pre-scoping `default` row if one exists, so an existing install does not appear to reset.

### Client Profile Resolution Priority (Handoff Routing)

The server resolves handoff client profile through this hierarchy (first match wins):

| Source                                                            | Transport   | When Used                                        |
| ----------------------------------------------------------------- | ----------- | ------------------------------------------------ |
| Launch defaults (`identity.launchDefaults.client*`)               | Both        | Authoritative deployment default                 |
| Trusted request metadata (`authInfo.extra`, `x-client-*` headers) | Mostly HTTP | Gateway/auth integration provides client profile |
| Request hint (`options.client_profile`)                           | Both        | Caller passes protocol-level hint                |
| SDK heuristic (`clientInfo.name/version`)                         | Both        | MCP SDK exposes client metadata                  |
| Unknown fallback                                                  | Both        | No profile signal available (`neutral_v1`)       |

### Why Launch Flags Are Authoritative on STDIO

Most STDIO launches provide limited transport metadata, and clients may not expose stable identity fields to MCP servers consistently across versions.

In practice:

- `--client` at launch time is the most deterministic signal for handoff profile selection.
- HTTP header signals (`x-client-*`) are stronger in managed gateway deployments than in local desktop/CLI STDIO sessions.
- SDK heuristics are fallback only and should not be treated as a strict contract.

## Verify Scope Isolation

1. **Check resolved identity** via system_control:

   ```
   system_control(action: "whoami")
   ```

   Returns the resolved identity context including `continuityScopeId`, source provenance, and policy mode.

2. **Test isolation** by running the same chain from two different workspaces:

   ```bash
   # Terminal 1: workspace-a
   node dist/index.js --transport=stdio --workspace-id=workspace-a

   # Terminal 2: workspace-b
   node dist/index.js --transport=stdio --workspace-id=workspace-b
   ```

   Chain sessions, framework state, and gate state are fully isolated between workspaces.

3. **Run tenant isolation tests**:

   ```bash
   cd server
   npm run test:integration -- --testPathPattern=tenant
   ```

   Expected: 16 tests passing (workspace continuity + tenant isolation).

## What Gets Isolated

| State              | Isolated Per Scope | Notes                                                |
| ------------------ | ------------------ | ---------------------------------------------------- |
| Chain sessions     | Yes                | Same `chain_id` runs independently across workspaces |
| Framework switches | Yes                | Workspace A on CAGEERF, workspace B on ReACT         |
| Gate system state  | Yes                | Enable/disable, health metrics, validation history   |
| Argument history   | Yes                | Per-workspace argument tracking                      |
| Resource index     | No                 | Shared file-based resources (prompts, gates, styles) |

## Troubleshooting

**Issue:** All state lands in `default` scope despite passing `--workspace-id`
**Fix:** Verify the flag format. Both `--workspace-id=value` and `--workspace-id value` are accepted. Check `system_control(action: "whoami")` to see what the server resolved.

**Issue:** HTTP gateway headers are not picked up
**Fix:** Headers must be lowercase (`x-workspace-id`, not `X-Workspace-ID`). The server normalizes case, but ensure your gateway passes them on the HTTP request to the MCP endpoint.

**Issue:** Locked mode rejects requests
**Fix:** In `locked` mode, `launchDefaults` must be set. If no launch defaults are configured, the server falls back to `default` scope and logs a warning.

## See Also

- [Workspace Identity Migration](workspace-organization-identity-migration.md) -- naming migration history
- [Client Integration](client-integration.md) -- per-client install snippets and verification steps
- [Client Capabilities Reference](../reference/client-capabilities.md) -- presets, profile mapping, and limits
- [Injection Control](injection-control.md) -- per-request framework injection
- [Architecture Overview](../architecture/overview.md) -- pipeline stage reference

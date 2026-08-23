---
paths:
  - "hooks/**"
  - ".claude-plugin/**"
  - "manifest.json"
  - "mcp.json"
  - "server/scripts/synchronize-downstream-lock.js"
---

# Multi-Platform Extension Alignment

**Upstream hook behavior here; downstream host adapters translate it without forking its policy.**

## Distribution Boundaries

| Host           | Repository         | Integration shape                                        |
| -------------- | ------------------ | -------------------------------------------------------- |
| Claude Desktop | this repo          | `manifest.json`; no hooks                                |
| Claude Code    | this repo          | `.claude-plugin/plugin.json` + `hooks/hooks.json`        |
| Gemini CLI     | `gemini-prompts`   | npm dependency, shared `hooks/lib`, thin Python adapters |
| Codex CLI      | `codex-prompts`    | npm dependency, shared `hooks/lib`, Codex adapters       |
| OpenCode       | `opencode-prompts` | independent TypeScript behavioral port                   |

Host-specific event names, payload parsing, and tool aliases belong in adapters. Shared policy and
Python behavior belong in `hooks/lib/`; do not branch shared logic on the host.

## Change Gate

When hook behavior changes:

- Update the upstream hook and `hooks/hooks.json` together.
- Re-check Gemini and Codex adapters, matcher names, and tool aliases against the changed event.
- Port the behavior explicitly to OpenCode; it does not consume the Python adapter layer.
- Update `hooks/README.md` and downstream compatibility docs.
- Re-lock downstream packages with `server/scripts/synchronize-downstream-lock.js` after release.

When the MCP launch surface changes, keep `manifest.json`, `.claude-plugin/plugin.json`, and
`mcp.json` aligned; downstream repositories own their host-native config files.

## Dated Capability Evidence

Codex divergences were last measured on 2026-08-21 with Codex CLI 0.148.0: subagent task payloads
were unavailable for portable enforcement, and plugin `.mcp.json` variables were not interpolated.
Re-verify these claims after a Codex upgrade rather than treating the version snapshot as policy.
OpenCode remains a behavioral port with a different hook event surface.

Session-start hooks must finish within five seconds, take a cheap path before heavy work, and fail
silently when they are advisory. A host that treats hook-launch failure as blocking needs a shipped
adapter before the hook is registered.

Client capability matrix: `docs/reference/client-capabilities.md`. Skills and rule propagation:
`docs/guides/skills-sync.md`.

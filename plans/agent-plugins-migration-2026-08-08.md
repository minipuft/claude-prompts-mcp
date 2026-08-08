---
title: "Agent Plugins Migration — Single Source Tree, Rendered Distributions"
date: 2026-08-08
status: deferred
tags: []
---

# Agent Plugins Migration — Single Source Tree, Rendered Distributions

**Status**: Deferred — activates after acquisition-recovery Tier 2b closes; owner validates each client manually
**Owner**: minipuft (manual client checks per phase are an explicit gate, not a courtesy)
**Parent**: `plans/acquisition-recovery.md` Tier 6 (pointer); subsumes Tier 5's marketplace research
**Standard**: [Agent Plugins 1.0.0](https://agent-plugins.org/) — announced 2026-08-06 by OpenAI
with AWS, Cursor, GitHub, Microsoft, Vercel. **Two days old at plan time — pin, don't chase.**

## Why

Four per-client repos (minipuft-plugins, gemini-prompts, opencode-prompts, codex-prompts) exist
because storefronts bind to repo shape at install time. The cost is drift, not effort — evidenced
2026-08-06 (marketplace served 3.1.1 against the 3.2.1 release until sync merged; codex-prompts
has no self-heal at all). The fix is single-source + rendered artifacts. Agent Plugins 1.0 now
provides the canonical source _shape_ for free, and its launch clients (Codex, ChatGPT, Cursor,
GitHub Copilot, Kiro, VS Code) are new acquisition surfaces this repo has never touched.

## What the standard actually specifies (verified against spec 2026-08-08)

- `plugin.json` manifest — only permitted top-level fields: `$schema`, `name`, `version`,
  `description`, `author`, `homepage`, `repository`, `license`, `keywords`, `extensions`.
- `skills/<name>/SKILL.md` — fixed path, conforms to agentskills.io (our `skills:export`
  already emits this shape).
- `mcp.json` — fixed file, `mcpServers` map; stdio/streamable-http; MUST NOT be inline in
  `plugin.json`. Placeholders `${PLUGIN_ROOT}` / `${PLUGIN_DATA}` expand in `args`/`env`
  values/`cwd` only — NOT in `command`.
- **Client extensions**: reverse-domain namespace dirs (`com.example.client/`) and/or
  `extensions` manifest field. **This is where hooks live** — v1 defines NO core hooks,
  commands, agents, or rules. Each client's hook format stays client-native, but inside ONE
  package, namespaced. This dissolves the "cramped hooks" concern by spec design.
- Containment: all reads/executes must resolve inside plugin root; persistent data goes to
  client-provided `PLUGIN_DATA`.
- **Anthropic is absent** — not a maintainer, Claude Code not a launch client. Claude Code's
  marketplace format remains a permanent legacy render until they adopt.

## Alignment matrix (the four surfaces the owner named)

| Surface                            | Today                                             | During migration                                                                              | End state                                                                              |
| ---------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **npm package** (`claude-prompts`) | The engine; publishes on release                  | UNCHANGED — migration never touches the server's public API                                   | `mcp.json` declares it (`npx claude-prompts` stdio); still the single engine           |
| **Hooks**                          | Hand-maintained per downstream repo, four formats | Moved into `plugin/<ns>/` namespace dirs in THIS repo; downstream copies become render output | One source per client namespace; renderer emits each client's native location          |
| **Marketplaces**                   | Each listing pins a downstream repo URL           | URLs never change — repos stay, demoted to artifacts                                          | Listings keep pointing at rendered repos; Agent Plugins clients get the native package |
| **GitHub workflows**               | Release train ends at downstream version-sync PRs | Train grows render+push jobs; sync scripts retire as renders replace them (same-PR cleanup)   | npm → extensions → dist → **render all distributions** → verify; drift check in CI     |

## Phases (each ends with owner manual check on the affected client)

**P0 — Pin + map (decision-bearing, blocks everything).**
Snapshot both JSON schemas (`plugin.schema.json`, `mcp.schema.json`) into `tooling/contracts/`
vendored copies — validate against the pin, not the live URL. Verify per-client consumption:
which of Codex/Cursor/ChatGPT/Copilot/Kiro/VS Code actually installs an Agent Plugin today, and
what namespace each claims (also: what namespace do Claude Code / Gemini / opencode need us to
invent or discover). Decide our `name` (spec: lowercase, 1–64, no `--`/`..`).
**Prerequisite fix**: the packaged-server MCP_WORKSPACE defect (state/logs written
package-relative) violates the `PLUGIN_DATA` model — fix it here, it blocks any client where the
plugin root is read-only or sandboxed (already breaks under Codex's MCP-child sandbox).

**P1 — Canonical source tree.**
Create `plugin/` in this repo in Agent Plugins shape: `plugin.json`, `skills/` (wire
`skills:export` output), `mcp.json`, plus one namespace dir per client holding its hooks —
migrated FROM the downstream repos (they are the current source of truth; move, don't rewrite).
Schema-validate in `validate:all`.

**P2 — Renderer.**
One generator (extend the `build-extension.sh` / skills-sync family) emitting:
(a) the native Agent Plugin directory — this IS the Codex/Cursor/etc. artifact;
(b) legacy renders for non-supporting clients: Claude Code marketplace shape → minipuft-plugins,
Gemini extension shape → gemini-prompts, opencode shape → opencode-prompts.
Gates: schema validation against the P0 pins; a **drift check** proving rendered output ==
committed downstream state (the `validate:contracts` pattern, applied cross-repo).

**P3 — Workflow alignment.**
Release train: render jobs push to downstream repos (auto-merge with state verification + BEHIND
self-heal — the hardening from this cycle, now written once in the generator's workflow).
Downstream repos get GENERATED banners + a CI check rejecting hand edits (the `_generated/`
discipline, repo-scale). `validate:versions --distribution` grows: `plugin.json` version + every
rendered manifest must equal the release version. Retire `synchronize-downstream-lock` targets as
renders absorb them — same PR, per cleanup-standards.

**P4 — Pilot: codex-prompts.**
Newest repo, least history, and its client is a launch consumer of the standard. Render it
natively; owner installs in Codex and validates end-to-end (hooks fire, MCP server boots, state
lands in `PLUGIN_DATA`). Nothing else migrates until this passes.

**P5 — Fold remaining clients, one per PR.**
Order: opencode → gemini → minipuft-plugins LAST (most users, most history, and its client
doesn't consume the standard — pure legacy render, highest blast radius). Owner manual check per
client before the next starts.

**P6 — Retirement + docs.**
Delete superseded sync scripts, hand-edit paths, and stale downstream CONTRIBUTING text in the
same PRs that obsolete them. Update `docs/` map + downstream READMEs to describe the rendered
model (current state only, no breadcrumbs). New listings pass: submit the native plugin to the
Agent Plugins-consuming surfaces (per-item owner approval, standing external-submissions rule).

## Risks / invariants

- **Spec churn**: 1.0.0 is days old. The P0 pin is the defense; re-pin deliberately, never track
  the live schema URL in CI.
- **Anthropic non-adoption**: Claude Code legacy render is load-bearing indefinitely. Watch for
  an Anthropic namespace/adoption announcement — it would collapse P5's hardest branch.
- **Listing URLs are sacred**: every Tier 2b listing pins a repo URL. Repos are demoted, never
  renamed/archived, or the acquisition work this plan descends from is undone.
- **The npm surface is out of scope**: `claude-prompts` public API (MCP tools, CLI, resource
  formats) does not change. Any phase that finds itself editing the server's contract has left
  this plan.
- **One live target per agent**: renders that push to the same downstream repo serialize.

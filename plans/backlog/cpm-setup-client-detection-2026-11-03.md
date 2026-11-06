---
title: "cpm setup: one command finds installed AI clients and configures each"
date: 2026-11-03
status: backlog
tags: [cli, install, clients]
---

# cpm setup: Client Detection

**Status**: BACKLOG. Saved on the owner's ruling of 2026-11-03 (interview round 1, `cpm-setup`: "write it down as a future plan, no work started"). No rows have run.
**Owner**: minipuft
**Created**: 2026-11-03
**Source**: `plans/archive/readme-client-setup-2026-11-03.md` row 2.3

## Why this exists

Installing today means finding your client in the README table and following its steps by hand.
upstash/context7 ships `npx ctx7 setup`, one command that finds the agents installed on the machine
and configures each one (surveyed 2026-11-02). `cpm` already exists as a standalone CLI
(`cli/src/commands/`, Node >= 18.18) with an `init` command, but it has no command that writes a
client's MCP configuration.

## What it would need to decide (open, not ruled)

- Which clients it detects, and how: config file present, binary on `PATH`, or both. The client list
  and each config path already live in `docs/reference/clients.json`, which would become the
  command's source too, so the README table and the installer cannot disagree.
- Plugin clients (Claude Code, Codex, OpenCode, Gemini CLI) install through their own plugin or
  extension command; MCP-config clients (Claude Desktop, Cursor, VS Code, Windsurf) need a JSON
  or TOML edit. Whether `cpm setup` runs the plugin commands or prints them.
- Editing a user's config file safely: back it up, merge rather than overwrite, and refuse a file it
  cannot parse.
- Whether it belongs in `cpm` (Node >= 18.18) or the server package (Node >= 22.13).

## Revives when

The owner moves it out of backlog, or a second request for one-command setup arrives (an issue or a
downstream repository asking for it).

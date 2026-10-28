#!/usr/bin/env bash
# Shared environment for the hero recording. Sourced by record.sh and drive.sh.
# Everything the demo touches lives under $DEMO so a re-record starts clean and
# nothing from the operator's own prompt library or state.db leaks into the take.
HERO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERO_DIR/../../../.." && pwd)"
export DEMO="${DEMO:-/tmp/cpm-hero}"   # hooktrace.sh and trace.py read it from the pane environment
SESSION="${SESSION:-cpmhero}"
COLS="${COLS:-120}"
ROWS="${ROWS:-36}"
MODEL="${MODEL:-sonnet}"            # README caption names the model; keep it truthful
TAKE_MODEL="${TAKE_MODEL:-sonnet}"  # only a take on this model lands in the hero dir; any other model is a rehearsal under $DEMO

export CLAUDE_PLUGIN_ROOT="$REPO"   # hooks/lib/workspace.py resolves the hook tree from this
export MCP_WORKSPACE="$DEMO/claude-prompts"
export MCP_RUNTIME_ROOT="$DEMO/claude-prompts"
export MCP_SHELL_VERIFY_ALLOWLIST="npm test"
export MCP_SHELL_VERIFY_ALLOWED_DIRS="$DEMO/greeter"
export LC_ALL=C.UTF-8              # the driver greps "…" and "·" from the pane; a C locale makes those bytes never match
unset MCP_RESOURCES_PATH            # a shell export here would override MCP_WORKSPACE (measured 2026-10)
# Markers and cast start times use the monotonic clock, never `date`: under WSL2 the wall clock is
# corrected in forward jumps of ~3 s (measured 2026-10-21, ten seconds lost over one take) while
# asciinema timestamps events monotonically, so wall-clock markers landed late and the two casts
# disagreed about when the same moment happened.
now_mono() { cut -d' ' -f1 /proc/uptime; }

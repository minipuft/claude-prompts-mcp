#!/usr/bin/env bash
# Record the hero demo: a real Claude Code session, driven by drive.sh inside tmux,
# captured by asciinema into hero.cast. The cast is the committed source; render.sh
# turns it into the README GIF and MP4 without re-running anything.
#
#   bash assets/demos/src/hero/record.sh            # full take
#   bash assets/demos/src/hero/record.sh --smoke    # boots, routes >>status, quits
set -euo pipefail
source "$(dirname "$0")/env.sh"
MODE="${1:-full}"

for bin in claude tmux asciinema3 jq node; do command -v "$bin" >/dev/null || { echo "missing: $bin" >&2; exit 1; }; done
[ -f "$REPO/server/dist/index.js" ] || (cd "$REPO/server" && npm run build)

# 1. Fresh demo root: fixture project + empty MCP workspace + generated client config.
rm -rf "$DEMO"; mkdir -p "$DEMO/claude-prompts" "$DEMO/greeter"
cp -r "$HERO_DIR/fixture/." "$DEMO/greeter/"
(cd "$DEMO/greeter" && git init -q && git add -A && git -c user.name=demo -c user.email=demo@example.com commit -qm "greeter: tests describe the banner" )

jq -n --arg repo "$REPO" --arg ws "$MCP_WORKSPACE" --arg allow "$MCP_SHELL_VERIFY_ALLOWLIST" --arg dirs "$MCP_SHELL_VERIFY_ALLOWED_DIRS" '{
  mcpServers: { "claude-prompts": {
    command: "node",
    args: [($repo + "/server/dist/index.js"), "--transport=stdio"],
    env: { MCP_WORKSPACE: $ws, MCP_RUNTIME_ROOT: $ws,
           MCP_SHELL_VERIFY_ALLOWLIST: $allow, MCP_SHELL_VERIFY_ALLOWED_DIRS: $dirs }
  } } }' > "$DEMO/mcp.json"

# Hooks: the plugin's hooks.json with ${CLAUDE_PLUGIN_ROOT} resolved to this checkout,
# so >> routing, gate reminders and chain tracking behave exactly as the installed plugin.
# Each hook command is wrapped by hooktrace.sh, which passes it through untouched and writes
# what went in and out to trace.jsonl for the trace pane. Tool results stay collapsed in the
# session pane (verbose off): the trace pane is where the inner workings are shown.
jq --arg repo "$REPO" --arg trace "$HERO_DIR/hooktrace.sh" '{
  hooks: (.hooks
    | walk(if type == "string" then gsub("\\$\\{CLAUDE_PLUGIN_ROOT\\}"; $repo) else . end)
    | walk(if type == "object" and has("command") and has("name") then .command = ($trace + " " + .name + " " + .command) else . end)),
  statusLine: { type: "command", command: "true" }, verbose: false }' \
  "$REPO/hooks/hooks.json" > "$DEMO/settings.json"   # empty statusline: the operator's own bar is not part of the demo
: > "$DEMO/trace.jsonl"

# 2. Claude Code in a tmux pane sized like the recording.
tmux kill-session -t "$SESSION" 2>/dev/null || true
pkill -f "^bash .*drive\.sh" 2>/dev/null || true   # anchored: never matches the shell that invoked us
mkdir -p "$DEMO/bin"
cat > "$DEMO/bin/claude" <<WRAP
#!/usr/bin/env bash
# What the driver types as plain \`claude\`: this checkout's server, the plugin's hooks, and
# nothing from the operator's user settings (--setting-sources project; the fixture has none).
exec env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT DISABLE_AUTOUPDATER=1 \\
  $(command -v claude) --model $MODEL --mcp-config "$DEMO/mcp.json" --strict-mcp-config \\
  --setting-sources project --settings "$DEMO/settings.json" --permission-mode acceptEdits \\
  --allowedTools 'mcp__claude-prompts__prompt_engine' 'mcp__claude-prompts__resource_manager' \\
                 'mcp__claude-prompts__system_control' 'Bash(npm test)' 'Read' 'Edit' 'Write' "\$@"
WRAP
chmod +x "$DEMO/bin/claude"
tmux new-session -d -s "$SESSION" -x "$COLS" -y "$ROWS" -c "$DEMO/greeter" \
  "env PATH=$DEMO/bin:\$PATH PS1='\\[\\e[1;32m\\]❯\\[\\e[0m\\] ' bash --norc --noprofile"
tmux set-option -t "$SESSION" status off   # the green tmux bar is not part of the demo
tmux set-option -t "$SESSION" focus-events on   # otherwise Claude Code prints a "tmux focus-events off" tip into the frame

# 2b. The trace pane: a second, narrower session following trace.jsonl. Shell-gate runs reach it
# from the server log (one `shell_verify` line per run, written by the server's composition root).
TRACE_SESSION="${SESSION}trace"; TRACE_COLS=48
tmux kill-session -t "$TRACE_SESSION" 2>/dev/null || true
tmux new-session -d -s "$TRACE_SESSION" -x "$TRACE_COLS" -y "$ROWS" -c "$DEMO" \
  "env DEMO=$DEMO TRACE_COLS=$TRACE_COLS python3 $HERO_DIR/trace.py $DEMO/trace.jsonl"
tmux set-option -t "$TRACE_SESSION" status off
mkdir -p "$DEMO/claude-prompts/logs"
# Detached from this script's stdout: a backgrounded `tail -F` that inherits it keeps the
# caller's pipe open after the take, and an invoking tool then waits forever (measured 2026-10-21).
setsid bash -c 'tail -n0 -F "$1" 2>/dev/null | while IFS= read -r line; do
    case "$line" in *" shell_verify "*) python3 -c "import json,sys,time; j=json.loads(sys.argv[1].split(\" shell_verify \",1)[1]); j.update(kind=\"shell\", t=time.clock_gettime(time.CLOCK_BOOTTIME)); print(json.dumps(j))" "$line" >> "$2";; esac
  done' _ "$DEMO/claude-prompts/logs/mcp-server.log" "$DEMO/trace.jsonl" </dev/null >/dev/null 2>&1 &
TAILER=$!

# 3. Drive and record concurrently. asciinema attaches to the pane; drive.sh types into it.
# A take on the caption's model replaces the committed casts; a smoke or a rehearsal on another
# model stays under $DEMO (a haiku rehearsal overwrote the sonnet take once, 2026-10-21).
OUT="$HERO_DIR/hero.cast"; TRACE_OUT="$HERO_DIR/trace.cast"
[ "$MODEL" = "$TAKE_MODEL" ] || { OUT="$DEMO/rehearsal.cast"; TRACE_OUT="$DEMO/rehearsal-trace.cast"; }
[ "$MODE" = "--smoke" ] && { OUT="$DEMO/smoke.cast"; TRACE_OUT="$DEMO/smoke-trace.cast"; }
: > "$DEMO/markers.txt"
# No idle-time limit at record time: markers are wall-clock seconds and the two casts share one
# clock, so idle is compressed once, in warp.mjs, after both are aligned.
now_mono > "$DEMO/tB0"
asciinema3 rec --headless --overwrite --window-size "${TRACE_COLS}x${ROWS}" \
  -t "claude-prompts hero demo — trace" -c "tmux attach -t $TRACE_SESSION" "$TRACE_OUT" &
TRACE_REC=$!
sleep 0.5
now_mono > "$DEMO/t0"
( bash -x "$HERO_DIR/drive.sh" "$MODE" > "$DEMO/driver.log" 2>&1; echo "driver exit=$?" >> "$DEMO/driver.log" ) &   # its own trace: a silent driver death cost a take on 2026-10-20
DRIVER=$!
echo "[$(date +%T)] asciinema start"; asciinema3 rec --headless --overwrite --window-size "${COLS}x${ROWS}" \
  -t "claude-prompts hero demo" -c "tmux attach -t $SESSION" "$OUT"
echo "[$(date +%T)] asciinema end"; wait $DRIVER || true
sleep 1; tmux kill-session -t "$TRACE_SESSION" 2>/dev/null || true; wait $TRACE_REC || true
kill -- -"$TAILER" 2>/dev/null || kill "$TAILER" 2>/dev/null || true   # the whole tailer group: tail, the loop, both
pkill -f "^tail -n0 -F $DEMO/claude-prompts/logs/mcp-server.log" 2>/dev/null || true
node "$HERO_DIR/markers.mjs" "$OUT" "$DEMO/markers.txt" "$DEMO/t0"
node "$HERO_DIR/markers.mjs" "$TRACE_OUT" "$DEMO/markers.txt" "$DEMO/t0" "$DEMO/tB0"
echo "cast: $OUT"; echo "trace: $TRACE_OUT"; echo "markers:"; cat "$DEMO/markers.txt"

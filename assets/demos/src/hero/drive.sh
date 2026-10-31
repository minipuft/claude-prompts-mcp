#!/usr/bin/env bash
# Types the storyboard into the tmux pane and waits on screen content, never on
# fixed sleeps (the VHS Wait+Screen pattern, applied to a real agent session).
# Each beat drops a marker so render.sh can cut and re-time it.
set -u   # no pipefail: `pane | grep -q` closes the pipe on first match and pipefail would report that SIGPIPE as a miss
source "$(dirname "$0")/env.sh"
MODE="${1:-full}"
pane() { tmux capture-pane -p -t "$SESSION" -S -200; }
wait_for() { # wait_for <regex> <timeout-seconds>
  local re="$1" t="${2:-60}" i=0
  until grep -Eiq "$re" <<< "$(pane)"; do sleep 0.5; i=$((i+1)); [ $i -ge $((t*2)) ] && { echo "timeout waiting for /$re/" >&2; pane | tail -15 >&2; return 1; }; done
  return 0   # an until-loop returns its body's last status, which is the false `[ i -ge max ]` test
}
type_line() { tmux send-keys -t "$SESSION" -l -- "$1"; sleep 0.6; tmux send-keys -t "$SESSION" Enter; }
mark() { printf "%.3f %s\n" "$(echo "$(now_mono) - $(cat "$DEMO/t0")" | bc)" "$1" >> "$DEMO/markers.txt"; }
settle() { sleep "${1:-2}"; }
busy() { grep -Eq '\([0-9]+s .*(tokens|thinking|thought)|esc to interrupt' <<< "$(pane)"; }   # Claude Code's spinner line while a turn runs
wait_turn() { # wait_turn <timeout>: wait until the current turn has started and then finished (idle for 3 polls)
  local t="${1:-300}" i=0 seen=0 idle=0
  while :; do
    if busy; then seen=1; idle=0; else idle=$((idle+1)); fi
    [ $seen -eq 1 ] && [ $idle -ge 3 ] && return 0
    [ $seen -eq 0 ] && [ $i -ge 30 ] && { echo "turn never started" >&2; return 1; }   # 15 s grace for the first paint
    sleep 0.5; i=$((i+1)); [ $i -ge $((t*2)) ] && { echo "turn did not finish in ${t}s" >&2; return 1; }
  done
}
send_and_wait() { type_line "$1"; wait_turn "${2:-300}"; }

# Beat 1 in the plain shell: the stakes, no model involved.
wait_for '❯' 20 || exit 1
mark open
type_line "npm test"
wait_for 'fail 3' 30 || exit 1
settle 2.5

# Launch Claude Code (PATH wrapper from record.sh). Trust dialog defaults to "No, exit".
type_line "claude"
wait_for 'trust this folder|\? for shortcuts|Try "' 60 || exit 1
if grep -Eqi 'trust this folder' <<< "$(pane)"; then tmux send-keys -t "$SESSION" Down; sleep 0.3; tmux send-keys -t "$SESSION" Enter; fi
wait_for '\? for shortcuts|Try "' 60 || exit 1
settle 1.5

mark status
send_and_wait ">>status" 120 || true
settle 3
[ "$MODE" = "--smoke" ] && { mark end; settle 1; type_line "/exit"; sleep 2; tmux kill-session -t "$SESSION"; exit 0; }

mark author
send_and_wait "Create a prompt called implement_feature in category development through resource_manager: arguments target (required) and feature (required); the template asks you to implement the described feature in the target file from the description alone, without running the tests yourself (the chain's gate runs them), then stop. Confirm with the created id and version only." 300 || true
settle 3

mark run
type_line "^ReACT >>implement_feature target:'src/greeter.js' feature:'a sign-in banner greeting that reads well for any name' :: verify:\"npm test\" --> >>review target:'src/greeter.js'"
verdict_marked=0; i=0; seen=0; idle=0
while :; do   # the gate's shell run is the beat worth 1x: mark it when the server logs it (trace.jsonl, via record.sh's tailer)
  if [ $verdict_marked -eq 0 ] && grep -Eq '"kind": ?"shell"' "$DEMO/trace.jsonl" 2>/dev/null; then mark verdict; verdict_marked=1; fi
  if busy; then seen=1; idle=0; else idle=$((idle+1)); fi
  [ $seen -eq 1 ] && [ $idle -ge 3 ] && break
  sleep 1; i=$((i+1)); [ $i -ge 900 ] && break
done
[ $verdict_marked -eq 0 ] && echo "no shell gate run reached trace.jsonl" >&2   # the take is still usable; the verdict scene will be missing
mark complete
settle 5
mark end

type_line "/exit"; sleep 2
tmux kill-session -t "$SESSION" 2>/dev/null || true

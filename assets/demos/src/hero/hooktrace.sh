#!/usr/bin/env bash
# Wraps one plugin hook for the recording: runs it exactly as Claude Code would, and appends what
# went in and what came out to $DEMO/trace.jsonl for the trace pane. The hook's stdout and exit
# code pass through untouched, so the session behaves as the installed plugin does.
#   hooktrace.sh <hook-name> <command...>
set -u
name="$1"; shift
in="$(mktemp)"; out="$(mktemp)"
cat > "$in"
"$@" < "$in" > "$out"; code=$?
cat "$out"
python3 - "$name" "$in" "$out" "$code" >> "${DEMO:-/tmp/cpm-hero}/trace.jsonl" <<'PY'
import json, sys, time
name, inp, outp, code = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
def load(p):
    try: return json.load(open(p))
    except Exception: return None
i = load(inp) or {}; o = load(outp)
print(json.dumps({"t": time.clock_gettime(time.CLOCK_BOOTTIME), "kind": "hook", "name": name, "exit": code,
                  "event": i.get("hook_event_name"), "tool": i.get("tool_name"),
                  "prompt": i.get("prompt"), "tool_input": i.get("tool_input"),
                  "tool_response": i.get("tool_response"), "output": o}))
PY
rm -f "$in" "$out"
exit $code

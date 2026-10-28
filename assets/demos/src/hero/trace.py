#!/usr/bin/env python3
"""The trace pane: what the hooks and the server did, one plain line each, as it happens.

Follows $DEMO/trace.jsonl (hook events written by hooktrace.sh, shell-gate events appended by
record.sh from the server log) and prints a readable line per event. Recorded as its own cast
and composited beside the session by compose.mjs.
"""
import json, os, re, sys, time

PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get("DEMO", "/tmp/cpm-hero"), "trace.jsonl")
DIM, BOLD, RESET = "\033[2m", "\033[1m", "\033[0m"
GREEN, RED, CYAN, YELLOW, MAGENTA = "\033[32m", "\033[31m", "\033[36m", "\033[33m", "\033[35m"
WIDTH = int(os.environ.get("TRACE_COLS", "48"))

def clip(s, n):
    s = re.sub(r"\s+", " ", str(s)).strip()
    return s if len(s) <= n else s[: n - 1] + "…"

def say(tag, color, lines):
    head, *rest = lines
    print(f"{color}{BOLD}{tag:<9}{RESET} {head}")
    for l in rest:
        print(f"{DIM}{'':<9} {l}{RESET}")
    print(flush=True)

def hook_lines(e):
    ev, name, tool = e.get("event"), e.get("name"), e.get("tool") or ""
    out = e.get("output") or {}
    ctx = ""
    if isinstance(out, dict):
        ctx = (out.get("hookSpecificOutput") or {}).get("additionalContext") or out.get("additionalContext") or ""
    if ev == "UserPromptSubmit":
        route = re.search(r"\[>> ([a-z_]+)\]\s*(\S*)", ctx or "")
        lines = [f"{BOLD}you typed{RESET} {clip(e.get('prompt'), WIDTH - 20)}"]
        if route:
            lines.append(f"→ {route.group(1)}")
            lines.append(f"  {route.group(2) or 'prompt'}: {name}")
        m = re.search(r"\[Chain Workflow\] (\d+) steps", ctx or "")
        if m: lines.append(f"chain: {m.group(1)} steps")
        m = re.search(r"Operators: ([^\n]+)", ctx or "")
        if m: lines.append(clip(m.group(1), WIDTH - 10))
        return "hook", CYAN, lines
    if ev == "PreToolUse" and "prompt_engine" in tool:
        ti = e.get("tool_input") or {}
        what = ti.get("command") or (f"chain {ti.get('chain_id')}" if ti.get("chain_id") else "")
        gv = ti.get("gate_verdict")
        lines = [f"{name} checks the call", clip(what, WIDTH - 10)]
        if ti.get("user_response"): lines.append("carries the step answer")
        if isinstance(gv, dict): lines.append(f"verdict offered: {gv.get('overall')}")
        return "hook", CYAN, lines
    if ev == "PostToolUse" and "prompt_engine" in tool:
        tr = e.get("tool_response")
        text = tr if isinstance(tr, str) else json.dumps(tr) if tr is not None else ""
        lines = [f"{name} reads the reply"]
        for pat, label in [(r"Progress (\d+/\d+)", "step {} started"), (r"Chain complete \((\d+/\d+)\)", "chain complete {}"),
                           (r"Gate Review Required", "gate review opened"), (r"Gate verdict refused", "verdict refused")]:
            m = re.search(pat, text)
            if m: lines.append(label.format(*m.groups()) if m.groups() else label)
        return "hook", CYAN, lines
    return None   # the per-tool bookkeeping hooks (delegation, ralph context, Stop) run on every call and would drown the lines that matter

def shell_lines(e):
    oc = e.get("outcome")
    color = GREEN if oc == "passed" else RED
    lines = [f"{BOLD}server ran{RESET} {clip(e.get('command'), WIDTH - 12)}",
             f"{oc} · exit {e.get('exitCode')} · {int(e.get('durationMs') or 0)} ms"]
    if e.get("cwd"): lines.append(f"in {clip(e['cwd'], WIDTH - 14)}")
    return "gate", color, lines

def render(line):
    try: e = json.loads(line)
    except Exception: return
    kind = e.get("kind")
    if kind == "hook":
        lines = hook_lines(e)
        if lines is not None: say(*lines)
    elif kind == "shell": say(*shell_lines(e))

def main():
    print(f"{DIM}{BOLD}hooks · server{RESET}{DIM}  what happens under the chat{RESET}\n", flush=True)
    pos = 0
    while True:
        if os.path.exists(PATH):
            with open(PATH) as f:
                f.seek(pos)
                while True:
                    line = f.readline()
                    if not line.endswith("\n"): break   # a partial line is read again next round
                    render(line); pos = f.tell()
        time.sleep(0.2)

if __name__ == "__main__":
    main()

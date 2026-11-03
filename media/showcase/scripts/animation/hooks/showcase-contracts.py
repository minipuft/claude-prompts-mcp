#!/usr/bin/env python3
"""Stop hook (plan row 9.9): the planner's own writes under media/showcase/v3/ are held to the contracts the gates hold a worker to.

The animation gates only see workers; the planner's malformed proposal (p007) reached the chain unchecked. When a file under `media/showcase/v3/` was written during the turn (a Write, Edit, MultiEdit or
NotebookEdit tool call on such a path, or a Bash command that writes there: a heredoc, a redirect, tee, sed -i, cp, mv), this hook runs, in `media/showcase`:

    probe-vocabulary.py v3/vocabulary.json --overrides v3/vocabulary-overrides.json     (every intent word in the proposals, rulings, pose sheets and materials is vocabulary)
    probe-screenplay.py v3/screenplay.json                                              (the screenplay contract: ids, shots, themes, recipes, current renders)
    probe-bible.py v3/bible.json --page out/bible.html                                  (the bible covers the timeline; every proposal file has an item and sits in its beat)

and blocks the stop with the FIRST refusal line of the first probe that does not pass, so the model fixes it in the continuation while the context is hot. It stays silent when the turn wrote nothing
there, and when every probe passes. Loop guard (house convention, plan-sync-stop.py): exits silently when `stop_hook_active` is set, because it already blocked once this turn.

Turn boundary: the last user message of the transcript that carries text (a user entry made only of tool results is the harness answering a tool call, not a new turn).
`SHOWCASE_CONTRACTS_ROOT` names the showcase root (default: <cwd>/media/showcase); the test points it at a scratch copy.
Exit 0 always: a hook that cannot run (no transcript, no probes, a timeout) must not wedge the session; the block is the JSON `{"decision": "block", "reason": ...}` on stdout.
"""
import json, os, re, subprocess, sys
from pathlib import Path

PROBES = (
    ("probe-vocabulary", ["python3", "scripts/animation/probe-vocabulary.py", "v3/vocabulary.json", "--overrides", "v3/vocabulary-overrides.json"]),
    ("probe-screenplay", ["python3", "scripts/animation/probe-screenplay.py", "v3/screenplay.json"]),
    ("probe-bible", ["python3", "scripts/animation/probe-bible.py", "v3/bible.json", "--page", "out/bible.html"]),
)
V3 = re.compile(r"(^|[\s/'\"=<>(])(media/showcase/)?v3/")
WRITE = re.compile(r"<<-?\s*['\"]?\w+|>>?\s*\S|\btee\b|\bsed\s+(-\w*i|--in-place)|\bcp\b|\bmv\b|\binstall\b|\bwrite(_text|File)?\b|\bjson\.dump\b")
EDIT_TOOLS = ("Write", "Edit", "MultiEdit", "NotebookEdit")
REFUSAL = re.compile(r"^\s*(FAIL\b|refused:|input error)")
PROBE_TIMEOUT = 100


def turn_entries(transcript):
    """The transcript entries after the last user message that carries text."""
    rows = []
    for line in transcript.read_text(encoding="utf8", errors="replace").splitlines():
        try: rows.append(json.loads(line))
        except ValueError: continue
    start = 0
    for i, r in enumerate(rows):
        msg = r.get("message") if isinstance(r.get("message"), dict) else {}
        if r.get("type") != "user" or r.get("isMeta") or msg.get("role") != "user": continue
        c = msg.get("content")
        if isinstance(c, str) and c.strip(): start = i + 1
        elif isinstance(c, list) and any(isinstance(b, dict) and b.get("type") == "text" and str(b.get("text", "")).strip() for b in c): start = i + 1
    return rows[start:]


def writes_to_v3(entries):
    """The first tool call of the turn that writes under media/showcase/v3/, as 'Tool path-or-command', else None."""
    for r in entries:
        msg = r.get("message") if isinstance(r.get("message"), dict) else {}
        c = msg.get("content")
        for b in c if isinstance(c, list) else []:
            if not (isinstance(b, dict) and b.get("type") == "tool_use"): continue
            inp = b.get("input") or {}
            if b.get("name") in EDIT_TOOLS:
                path = str(inp.get("file_path") or inp.get("notebook_path") or inp.get("path") or "").replace("\\", "/")
                if "/media/showcase/v3/" in path or path.startswith(("media/showcase/v3/", "v3/")): return f"{b['name']} {path}"
            elif b.get("name") == "Bash":
                cmd = str(inp.get("command") or "")
                if V3.search(cmd) and WRITE.search(cmd): return "Bash " + cmd.strip().splitlines()[0][:100]
    return None


def first_refusal(out):
    for line in out.splitlines():
        if REFUSAL.match(line): return line.strip()
    lines = [l.strip() for l in out.splitlines() if l.strip()]
    return lines[-1] if lines else "no output"


def main():
    try: payload = json.load(sys.stdin)
    except ValueError: return 0
    if payload.get("stop_hook_active"): return 0
    root = Path(os.environ.get("SHOWCASE_CONTRACTS_ROOT") or Path(payload.get("cwd") or os.getcwd()) / "media" / "showcase")
    tp = payload.get("transcript_path")
    if not root.is_dir() or not tp or not Path(tp).is_file(): return 0
    touched = writes_to_v3(turn_entries(Path(tp)))
    if not touched: return 0
    for name, cmd in PROBES:
        if not (root / cmd[1]).is_file(): continue
        try: r = subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=PROBE_TIMEOUT)
        except (subprocess.TimeoutExpired, OSError): continue
        if r.returncode == 0: continue
        reason = (f"{name} refuses the film's contracts after this turn's write ({touched}): {first_refusal(r.stdout + r.stderr)}\n"
                  f"Fix what it names, or re-run its compiler (compile-bible.mjs, compile-screenplay.mjs) if it says stale; the full run is `{' '.join(cmd)}` in media/showcase.")
        json.dump({"decision": "block", "reason": reason}, sys.stdout)
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())

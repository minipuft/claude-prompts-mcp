#!/usr/bin/env python3
"""Runs every episode-tier frame probe and prints one line each: name, pass/fail, control. This is what the animation-animatic-probes gate runs.

usage: probe-all.py --shots v3/poses --frames-root out --joints-root out [--xsheet-root out] [--json out]      (per-shot mode, below)
       probe-all.py <frames-dir> --timeline v3/timeline.json --xsheet v3/xsheet.json [--second-frames <dir> [--subset]] [--skip-determinism] [--partial] [--figure-frames <dir>] [--figure-line-frames <dir>] [--shot <id>] [--poses v3/poses/<shot>.json [--joints out/<shot>-joints.json]] [--json out]
Probes: twos-ones, hold-band, screen-time, eye-trace, loop-closure, colour-continuity (frames mode; pairs from light.json beside the timeline when it
exists, else shots.json) and determinism. Determinism needs a second render of the same frames (--second-frames; --subset when it is a sampled
re-render): without one it prints NOT RUN and the exit code is 2, because a probe that did not run is not a pass. --skip-determinism says so on
purpose and prints SKIPPED. --figure-frames <dir> (the figure-only render, Animatic65Figure) hands the twos and hold probes the figure layer: crossing windows are no longer exempt for the figure's pose. --figure-line-frames <dir> (Animatic65FigureLine, the line phases' frames) hands the loop probe the figure as the line world draws it, on which it reads closure and clipping (its own line). --shot <id> hands every
probe one shot's slice of the timeline (screen time, eye trace, colour and determinism read it too). --poses adds probe-inbetweens.py (arcs, spacing, overlap, moving holds, pixel ease) on the same frames, with the shot's joints dump
(--joints, default out/<pose sheet name>-joints.json); without --poses nothing changes. Exit 0 when every probe passes, 1 when any fails, 2 when any could not run (input error or a control that did not trip).

--shots POSES_DIR: per-shot mode, the gate of the pose pass. For every POSES_DIR/<shot>.json it runs twos-ones, hold-band (with --no-pops) and inbetweens on <frames-root>/<shot>-figure-seq/
with <joints-root>/<shot>-joints.json and <xsheet-root>/<shot>-xsheet.json (default: the frames root; the shot's own timeline is derived from that exposure sheet) and prints one line per probe per
shot, so a move cannot be made green on one probe by breaking another. A shot with no frames is SKIPPED and says so; a shot missing its joints or exposure sheet is an ERROR (exit 2); nothing run exits 1.
Exit 0 only when every probe on every shot passes. The film-level probes (screen time, eye trace, loop, colour, determinism) are not run in this mode.
"""
import argparse, json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def run(script, args):
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as t: out = t.name
    r = subprocess.run([sys.executable, os.path.join(HERE, script), *args, "--json", out], capture_output=True, text=True)
    try:
        with open(out) as f: res = json.load(f)
    except (OSError, ValueError): res = None
    finally:
        if os.path.exists(out): os.unlink(out)
    return r.returncode, res, r.stdout


def timeline_from_xsheet(rows):
    """The shot's own timeline from its exposure sheet: beats are the runs of one `beat` id, no crossings (a shot study carries none)."""
    beats = []
    for r in sorted(rows, key=lambda r: r["frame"]):
        if beats and beats[-1]["id"] == r["beat"]: beats[-1]["end"] = r["frame"] + 1
        else: beats.append({"id": r["beat"], "start": r["frame"], "end": r["frame"] + 1, "world": str(r.get("world", "home")).split(">")[0]})
    return {"fps": 30, "durationInFrames": beats[-1]["end"] if beats else 0, "beats": beats, "crossings": []}


def shots_mode(a):
    """One line per probe per shot (twos-ones, hold-band, inbetweens); exit 0 only when every probe on every shot passes, 1 when one fails or nothing ran, 2 when one could not run."""
    if not os.path.isdir(a.shots): print(f"input error: poses directory {a.shots} does not exist"); sys.exit(2)
    xroot = a.xsheet_root or a.frames_root
    lines, worst, ran, results = [], 0, 0, []
    for fn in sorted(f for f in os.listdir(a.shots) if f.endswith(".json")):
        shot = fn[:-5]; poses = os.path.join(a.shots, fn)
        fd, jf, xf = (os.path.join(a.frames_root, f"{shot}-figure-seq"), os.path.join(a.joints_root, f"{shot}-joints.json"), os.path.join(xroot, f"{shot}-xsheet.json"))
        if not os.path.isdir(fd): lines.append(f"{shot} · SKIPPED · no frames at {fd}"); results.append({"shot": shot, "probe": "all", "status": "SKIPPED"}); continue
        missing = [p for p in (jf, xf) if not os.path.exists(p)]
        if missing: lines.append(f"{shot} · ERROR · {', '.join(missing)} missing"); worst = 2; results.append({"shot": shot, "probe": "all", "status": "ERROR"}); continue
        with open(xf) as f: rows = json.load(f)["rows"]
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as t: json.dump(timeline_from_xsheet(rows), t); tl = t.name
        try:
            jobs = [("twos-ones", "probe-twos.py", [fd, "--timeline", tl, "--xsheet", xf]), ("hold-band", "probe-holds.py", [fd, "--timeline", tl, "--xsheet", xf, "--no-pops"]),
                    ("inbetweens", "probe-inbetweens.py", [fd, "--joints", jf, "--poses", poses, "--xsheet", xf])]
            for name, script, args in jobs:
                code, res, stdout = run(script, args); ran += 1
                ctl = (res or {}).get("control", {}).get("text") if res else None
                status = {0: "pass", 1: "FAIL"}.get(code, "ERROR")
                lines.append(f"{shot} · {name} · {status} · control: {ctl or '(no control line: ' + (stdout.strip().splitlines() or ['no output'])[-1] + ')'}")
                if code != 0: lines += [f"    {l.strip()}" for l in stdout.splitlines() if l.strip().startswith(("FAIL", "input error", "refused"))]
                worst = 2 if code == 2 or worst == 2 else max(worst, code); results.append({"shot": shot, "probe": name, "status": status, "code": code, "control": ctl})
        finally: os.unlink(tl)
    if not ran: lines.append("FAIL: no shot had frames to measure"); worst = max(worst, 1)
    print("\n".join(lines))
    ok = sum(1 for r in results if r.get("code") == 0)
    print(f"{'pass' if worst == 0 else 'FAIL' if worst == 1 else 'ERROR'}: probe-all --shots - {ok} of {ran} probe runs passed, {sum(1 for r in results if r['status'] == 'SKIPPED')} shot(s) skipped")
    if a.json:
        with open(a.json, "w") as f: json.dump({"exit": worst, "probes": results}, f, indent=2)
    sys.exit(worst)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("frames", nargs="?", default=None); ap.add_argument("--timeline", default="v3/timeline.json"); ap.add_argument("--xsheet", default=None)
    ap.add_argument("--second-frames", default=None); ap.add_argument("--subset", action="store_true"); ap.add_argument("--skip-determinism", action="store_true")
    ap.add_argument("--partial", action="store_true"); ap.add_argument("--json", default=None)
    ap.add_argument("--figure-frames", default=None, help="the figure-only render (Animatic65Figure) for the twos and hold probes"); ap.add_argument("--figure-line-frames", default=None, help="the figure-line render (Animatic65FigureLine) for the loop probe"); ap.add_argument("--shot", default=None, help="one shot's slice of the timeline, for every probe")
    ap.add_argument("--poses", default=None, help="v3/poses/<shot>.json: also run probe-inbetweens on the frames"); ap.add_argument("--joints", default=None, help="out/<shot>-joints.json (default beside out/, named for the pose sheet)")
    ap.add_argument("--shots", default=None, metavar="POSES_DIR", help="per-shot mode: every pose sheet in this directory"); ap.add_argument("--frames-root", default="out"); ap.add_argument("--joints-root", default="out")
    ap.add_argument("--xsheet-root", default=None)
    a = ap.parse_args()
    if a.shots: return shots_mode(a)
    if not a.frames: ap.error("give <frames-dir>, or --shots <poses-dir>")
    shot = ["--shot", a.shot] if a.shot else []
    fig = ["--figure-frames", a.figure_frames] if a.figure_frames else []
    common = [a.frames, "--timeline", a.timeline] + (["--xsheet", a.xsheet] if a.xsheet else []) + shot
    light = os.path.join(os.path.dirname(os.path.abspath(a.timeline)), "light.json")
    jobs = [("twos-ones", "probe-twos.py", common + fig), ("hold-band", "probe-holds.py", common + fig),
            ("screen-time", "probe-screentime.py", common + (["--partial"] if a.partial else [])),
            ("eye-trace", "probe-eyetrace.py", common), ("loop-closure", "probe-loop.py", common + (["--figure-line-frames", a.figure_line_frames] if a.figure_line_frames else [])),
            ("colour-continuity", "probe-colour.py", [a.frames, "--timeline", a.timeline] + (["--contract", light] if os.path.exists(light) else []) + shot)]
    if a.poses:
        joints = a.joints or os.path.join("out", os.path.splitext(os.path.basename(a.poses))[0] + "-joints.json")
        jobs.append(("inbetweens", "probe-inbetweens.py", [a.frames, "--joints", joints, "--poses", a.poses]))      # the joints rows carry the camera
    if a.second_frames: jobs.append(("determinism", "probe-determinism.py", [a.frames, a.second_frames] + (["--subset"] if a.subset else [])))     # no --shot: a re-render of a subset lists its own frames
    else: jobs.append(("determinism", "probe-determinism.py", ["--control-only"]))
    lines, worst, results = [], 0, []
    for name, script, args in jobs:
        code, res, stdout = run(script, args)
        ctl = (res or {}).get("control", {}).get("text") if res else None
        if name == "determinism" and not a.second_frames:
            code, status = (0, "SKIPPED (--skip-determinism)") if a.skip_determinism else (2, "NOT RUN (no --second-frames: a second render of the same frames is required)")
        else: status = {0: "pass", 1: "FAIL"}.get(code, "ERROR")
        lines.append(f"{name} · {status} · control: {ctl or '(no control line: ' + (stdout.strip().splitlines() or ['no output'])[-1] + ')'}")
        if code != 0 and name != "determinism" or (name == "determinism" and a.second_frames and code != 0):
            lines += [f"    {l.strip()}" for l in stdout.splitlines() if l.strip().startswith(("FAIL", "input error", "refused"))]
        worst = 2 if code == 2 or worst == 2 else max(worst, code); results.append({"probe": name, "status": status, "code": code, "control": ctl})
    print("\n".join(lines))
    ok = sum(1 for r in results if r["code"] == 0)
    print(f"{'pass' if worst == 0 else 'FAIL' if worst == 1 else 'ERROR'}: probe-all - {ok} of {len(results)} probes passed")
    if a.json:
        with open(a.json, "w") as f: json.dump({"exit": worst, "probes": results}, f, indent=2)
    sys.exit(worst)


if __name__ == "__main__": main()

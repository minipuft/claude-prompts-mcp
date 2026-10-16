#!/usr/bin/env python3
"""Timeline conformance (rubric C26): each beat holds the screen for the frames the timeline gives it, within one frame at each end.

usage: probe-screentime.py [<frames-dir>] --timeline v3/timeline.json --xsheet v3/xsheet.json [--partial] [--json out]
Method: per beat, the frames whose xsheet row names the beat: first frame and one-past-last frame must sit within +-1 of the timeline's start and
end, the rows must be contiguous, and outside crossing windows every row's world must be the beat's world. Every crossing window must begin inside
the beat it leaves and end inside the beat it enters. With <frames-dir>, the rendered frame count must equal the duration (--partial accepts fewer).
Control first: the same xsheet read against a timeline with one beat shifted 3 frames must fail; against the unshifted timeline it must pass.
"""
import argparse, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import *
from fixtures import make


def analyse(tl, xs, tol=1):
    problems, report = [], []
    dur = tl["duration"]
    if len(xs) != dur: problems.append(f"the xsheet has {len(xs)} rows for a {dur}-frame timeline")
    for b in tl["beats"]:
        rows = sorted(f for f, r in xs.items() if r.get("beat") == b["id"])
        if not rows: problems.append(f"beat {b['id']!r}: no xsheet row names it"); continue
        s, e = rows[0], rows[-1] + 1
        report.append(f"{b['id']} xsheet {s}-{e} vs timeline {b['start']}-{b['end']}")
        if abs(s - b["start"]) > tol: problems.append(f"beat {b['id']!r} starts at frame {s} in the xsheet, {b['start']} in the timeline")
        if abs(e - b["end"]) > tol: problems.append(f"beat {b['id']!r} ends at frame {e} in the xsheet, {b['end']} in the timeline")
        if len(rows) != e - s: problems.append(f"beat {b['id']!r}: {e - s - len(rows)} frame(s) inside its span belong to another beat")
        wrong = [f for f in rows if xs[f].get("world") not in (b["world"], b["worldRaw"]) and not in_window(tl, f)]
        if wrong: problems.append(f"beat {b['id']!r}: {len(wrong)} frame(s) outside crossings show world {xs[wrong[0]].get('world')!r}, not {b['world']!r} (first at {wrong[0]})")
    ids = {b["id"]: b for b in tl["beats"]}
    for w in tl["windows"]:
        fb, tb = ids.get(w["from"]), ids.get(w["to"])
        if not fb or not tb: problems.append(f"crossing {w['a']}-{w['b']} names {w['from']!r} -> {w['to']!r}, which are not both beats"); continue
        if not (fb["start"] <= w["a"] < fb["end"]): problems.append(f"crossing {w['a']}-{w['b']} begins outside {fb['id']!r} ({fb['start']}-{fb['end']})")
        if not (tb["start"] < w["b"] <= tb["end"]): problems.append(f"crossing {w['a']}-{w['b']} ends outside {tb['id']!r} ({tb['start']}-{tb['end']})")
    return problems, report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("frames", nargs="?", default=None); ap.add_argument("--timeline", default="v3/timeline.json"); ap.add_argument("--xsheet", default=None)
    ap.add_argument("--json", default=None); ap.add_argument("--partial", action="store_true")
    a = ap.parse_args()
    pr = Probe("screen-time", a.json)
    ftl = normalise_timeline(make.timeline_fixture()); fxs = {r["frame"]: r for r in make.xsheet_for_timeline(make.timeline_fixture())}
    shifted = analyse(normalise_timeline(make.shifted_timeline(make.timeline_fixture(), "b", 3)), fxs)[0]
    clean = analyse(ftl, fxs)[0]
    pr.control(bool(shifted) and not clean, f"beat 'b' shifted 3 frames against the same xsheet -> FAIL ({shifted[0]}); unshifted -> pass ({len(clean)} problems)")
    tl = load_timeline(a.timeline)
    xs = default_xsheet(a) or die("no xsheet: pass --xsheet (or put xsheet.json beside the timeline)")
    problems, report = analyse(tl, xs)
    pr.note("; ".join(report))
    pr.check("beat extents", not problems, "; ".join(problems) if problems else f"all {len(tl['beats'])} beats within 1 frame of the timeline, contiguous, in their worlds; {len(tl['windows'])} crossing windows inside both beats")
    if a.frames:
        n = len(list_frames(a.frames))
        pr.check("rendered frames", n == tl["duration"] or (a.partial and n < tl["duration"]), f"{n} frames rendered for a {tl['duration']}-frame timeline")
    pr.finish(f"{len(tl['beats'])} beats and {len(tl['windows'])} crossings match the timeline within 1 frame")


if __name__ == "__main__": main()

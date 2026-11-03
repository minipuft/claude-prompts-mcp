#!/usr/bin/env python3
"""Timeline contract (gate animation-timeline-contract): the compiled timeline covers the duration and every beat can hold a drawing.

usage: probe-timeline.py <timeline.json> [--worlds home,crayon,line,shaded] [--min-hold 11] [--json out]
Checks: beats contiguous (the first starts at 0, each starts where the previous ends, none is 0 frames) and summing to the duration; every crossing
window begins inside the beat it leaves and ends inside the beat it enters, with windows apart from each other; every beat's world is in the
registry; every beat has at least --min-hold frames clear of crossing windows (the hold band's floor) unless it carries `intentionalHold: true`.
Control first: a planted 0-frame beat, a 3-frame gap, a crossing outside its beats, an unknown world and an 8-frame beat must each fail; the clean
timeline must pass.
"""
import argparse, copy, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import *
from fixtures import make


def check_timeline(tl, worlds, min_hold):
    out, beats, dur = [], tl["beats"], tl["duration"]
    lo = tl["slice"][0] if "slice" in tl else 0                       # a shot's slice starts where its first beat does
    p = []
    if not beats: p.append("the timeline has no beats")
    prev = lo
    for b in beats:
        if b["end"] - b["start"] <= 0: p.append(f"beat {b['id']!r} spans {b['end'] - b['start']} frames ({b['start']}-{b['end']})")
        if b["start"] != prev: p.append(f"{'gap' if b['start'] > prev else 'overlap'} of {abs(b['start'] - prev)} frame(s) before beat {b['id']!r} (previous end {prev}, start {b['start']})")
        prev = b["end"]
    if beats and prev != dur: p.append(f"beats end at frame {prev}, duration is {dur}")
    total = sum(b["end"] - b["start"] for b in beats)
    if beats and total != dur - lo: p.append(f"beat frames sum to {total}, duration is {dur - lo}")
    out.append(("beats cover the duration", not p, "; ".join(p) if p else f"{len(beats)} beats contiguous from {lo}, summing to {dur - lo} frames"))
    ids = {b["id"]: b for b in beats}; p = []; last = None
    for w in tl["windows"]:
        fb, tb = ids.get(w["from"]), ids.get(w["to"])
        if w["b"] <= w["a"]: p.append(f"crossing {w['a']}-{w['b']} is empty")
        elif w.get("partial"):                                         # the slice ends inside this window: the side it has
            if fb and not fb["start"] <= w["a"] < fb["end"]: p.append(f"crossing {w['a']}-{w['b']} begins at {w['a']}, outside {fb['id']!r} ({fb['start']}-{fb['end']})")
            if tb and not tb["start"] < w["b"] <= tb["end"]: p.append(f"crossing {w['a']}-{w['b']} ends at {w['b']}, outside {tb['id']!r} ({tb['start']}-{tb['end']})")
        elif not fb or not tb: p.append(f"crossing {w['a']}-{w['b']} names {w['from']!r} -> {w['to']!r}, not both beats")
        else:
            if not fb["start"] <= w["a"] < fb["end"]: p.append(f"crossing {w['a']}-{w['b']} begins at {w['a']}, outside {fb['id']!r} ({fb['start']}-{fb['end']})")
            if not tb["start"] < w["b"] <= tb["end"]: p.append(f"crossing {w['a']}-{w['b']} ends at {w['b']}, outside {tb['id']!r} ({tb['start']}-{tb['end']})")
        if last and w["a"] < last["b"]: p.append(f"crossings {last['a']}-{last['b']} and {w['a']}-{w['b']} overlap")
        last = w
    out.append(("crossing windows inside both beats", not p, "; ".join(p) if p else f"{len(tl['windows'])} windows, each inside the two beats it joins"))
    bad = [f"{b['id']!r} world {b['world']!r}" for b in beats if b["world"] not in worlds]
    out.append(("worlds in the registry", not bad, f"{', '.join(bad)} not in {sorted(worlds)}" if bad else f"all worlds in {sorted(worlds)}"))
    p = []
    for b in beats:
        clear, cur = 0, 0
        for f in range(b["start"], b["end"]):
            cur = 0 if in_window(tl, f) else cur + 1; clear = max(clear, cur)
        if clear < min_hold and not b["intentionalHold"]: p.append(f"beat {b['id']!r} has {clear} frames clear of crossings, under {min_hold} (mark intentionalHold to allow)")
    out.append(("every beat can hold", not p, "; ".join(p) if p else f"every beat has >= {min_hold} frames clear of crossing windows"))
    return out


def planted():
    base = make.timeline_fixture(); cases = {}
    t = copy.deepcopy(base); t["beats"].insert(1, {"id": "z", "start": 30, "end": 30, "frames": 0, "world": "home"}); cases["0-frame beat"] = t
    t = copy.deepcopy(base); t["beats"][1]["start"] += 3; cases["3-frame gap"] = t
    t = copy.deepcopy(base); t["crossings"][0]["start"] = 100; cases["crossing outside its beat"] = t
    t = copy.deepcopy(base); t["beats"][1]["world"] = "plasma"; cases["unknown world"] = t
    t = copy.deepcopy(base); t["beats"][3].update(start=96, end=104); t["durationInFrames"] = 104; cases["8-frame beat"] = t
    return base, cases


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("timeline"); ap.add_argument("--worlds", default=",".join(WORLDS)); ap.add_argument("--min-hold", type=int, default=11); ap.add_argument("--json", default=None)
    ap.add_argument("--shot", default=None, help="check one shot's slice of the timeline")
    a = ap.parse_args(); worlds = set(a.worlds.split(","))
    pr = Probe("timeline-contract", a.json)
    base, cases = planted()
    clean = [c for c in check_timeline(normalise_timeline(base), worlds, a.min_hold) if not c[1]]
    tripped = {name: [c for c in check_timeline(normalise_timeline(t), worlds, a.min_hold) if not c[1]] for name, t in cases.items()}
    pr.control(not clean and all(tripped.values()), "; ".join(f"planted {n} -> FAIL ({v[0][0]})" if v else f"planted {n} -> NOT REFUSED" for n, v in tripped.items()) + f"; clean timeline -> pass ({len(clean)} failures)")
    tl, _, _, shot_note = apply_shot(a, load_timeline(a.timeline))
    if shot_note: pr.note(shot_note)
    for name, ok, text in check_timeline(tl, worlds, a.min_hold): pr.check(name, ok, text)
    pr.finish(f"{len(tl['beats'])} beats cover {tl['duration'] - (tl['slice'][0] if 'slice' in tl else 0)} frames, {len(tl['windows'])} crossings sit inside both beats, every beat can hold")


if __name__ == "__main__": main()

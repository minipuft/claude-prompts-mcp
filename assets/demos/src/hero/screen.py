#!/usr/bin/env python3
"""Print the terminal screen of an asciicast v3 at a point in time, one line per row.

    screen.py hero.warped.cast 8.2            # rows as text, numbered from 0
    screen.py hero.warped.cast 8.2 --json     # ["row 0", "row 1", ...]

compose.mjs uses it to find which rows hold a highlight's text while the session is
frozen: the frame on screen during a freeze is the screen at the scene's marker.
"""
import json, sys
import pyte

class Screen(pyte.Screen):
    """pyte has no CSI S/T (scroll up/down), which tmux uses on every repaint; without them the
    rows land several lines off the rendered frame."""
    def scroll_up(self, count=1):
        y = self.cursor.y
        self.cursor.y = self.margins.bottom if self.margins else self.lines - 1
        for _ in range(max(1, count)): self.index()
        self.cursor.y = y
    def scroll_down(self, count=1):
        y = self.cursor.y
        self.cursor.y = self.margins.top if self.margins else 0
        for _ in range(max(1, count)): self.reverse_index()
        self.cursor.y = y

def screen_at(cast, when):
    with open(cast, encoding="utf-8") as fh:
        header = json.loads(fh.readline())
        cols, rows = header["term"]["cols"], header["term"]["rows"]
        scr = Screen(cols, rows); stream = pyte.Stream()
        stream.csi["S"] = "scroll_up"; stream.csi["T"] = "scroll_down"; stream.attach(scr)   # attach builds the dispatch table
        t = 0.0
        for line in fh:
            if not line.strip(): continue
            dt, code, data = json.loads(line)
            t += dt
            if t > when + 1e-9: break
            if code == "o": stream.feed(data)
    return [scr.display[i].rstrip() for i in range(rows)]

if __name__ == "__main__":
    cast, when = sys.argv[1], float(sys.argv[2])
    lines = screen_at(cast, when)
    if "--json" in sys.argv: print(json.dumps(lines))
    else:
        for i, l in enumerate(lines): print(f"{i:2d} {l}")

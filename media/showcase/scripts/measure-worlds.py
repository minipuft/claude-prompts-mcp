#!/usr/bin/env python3
"""World-proof measurements (D78), one subcommand per claim; every number in v3/studies/world-proof-01.md comes from here.

usage:
  python3 scripts/measure-worlds.py control   <home.png> <meshproof36.png> <line.png>   # (a) MAD of the figure crop, with a control that must differ
  python3 scripts/measure-worlds.py chroma    <line.png> <home.png>                      # (b) saturated pixels (chroma > 40) in the figure crop
  python3 scripts/measure-worlds.py crop      <seq dir> <out dir>                        # (c) step 1: crop every frame to the figure region
  python3 scripts/measure-worlds.py filled    <cropped seq dir>                          # (c) step 3: components of the hole-filled silhouette, per frame
  python3 scripts/measure-worlds.py pigments  <png> [<png> ...]                          # (d) exact identity-pigment pixels in each companion's box
  python3 scripts/measure-worlds.py shaded    <shaded.png> <home.png> [<shaded without bloom.png> [<earlier shaded.png>]]   # floor, gates, bloom, light steps
  python3 scripts/measure-worlds.py loop      <cropped seq dir>                          # (c) per frame: is the figure's boundary loop closed? (with controls)
The figure crop is STAGE.figureCrop in src/library/worlds/contract.ts (x 380, w 500, full height).
"""
import glob, os, sys
import numpy as np
from PIL import Image

CROP = (380, 0, 500, 720)  # `crop` on a taller render (WorldCrossingMeasure, 1160 px) keeps the full height
CODEX_BOX = (40, 420, 300, 300)   # x, y, w, h: Codex sprite, 1.8x at (60, 440)
CLAWD_BOX = (930, 460, 270, 230)  # Clawd sprite, 1.5x at (940, 470)

def load(p): return np.array(Image.open(p).convert("RGB")).astype(int)
def crop(a, box=CROP):
    x, y, w, h = box
    return a[y:y + h, x:x + w]
def chroma(a): return a.max(axis=2) - a.min(axis=2)

cmd = sys.argv[1]
if cmd == "control":
    home, mesh, line = (crop(load(p)) for p in sys.argv[2:5])
    print(f"WorldSheetHome vs MeshProof f36, figure crop {CROP}: MAD {np.abs(home - mesh).mean():.4f}, max {np.abs(home - mesh).max()}, differing pixels {int((np.abs(home - mesh).sum(2) > 0).sum())}")
    print(f"control (must differ): WorldSheetLine vs MeshProof f36, same crop: MAD {np.abs(line - mesh).mean():.4f}, differing pixels {int((np.abs(line - mesh).sum(2) > 0).sum())}")
elif cmd == "chroma":
    line, home = (crop(load(p)) for p in sys.argv[2:4])
    print(f"saturated pixels (chroma > 40) in the figure crop: line world {int((chroma(line) > 40).sum())}, home world (control, must be large) {int((chroma(home) > 40).sum())}; crop has {line.shape[0] * line.shape[1]} pixels")
    nz = chroma(line) > 12
    print(f"line world, chroma > 12: {int(nz.sum())} pixels; max chroma {int(chroma(line).max())}")
elif cmd == "crop":
    src, dst = sys.argv[2], sys.argv[3]
    os.makedirs(dst, exist_ok=True)
    files = sorted(glob.glob(f"{src}/element-*.png"))
    for f in files:
        a = load(f)
        Image.fromarray(crop(a, (CROP[0], 0, CROP[2], a.shape[0])).astype("uint8")).save(os.path.join(dst, os.path.basename(f)))
    print(f"cropped {len(files)} frames to {CROP} -> {dst}")
elif cmd == "filled":
    from scipy import ndimage as ndi
    files = sorted(glob.glob(f"{sys.argv[2]}/element-*.png"))
    first = load(files[0]); field = first[0, 0]
    def comps(a, fill):
        fg = np.abs(a - field).sum(axis=2) > 24
        if fill: fg = ndi.binary_fill_holes(fg)
        lab, n = ndi.label(fg, structure=np.ones((3, 3)))
        return int((ndi.sum(fg, lab, range(1, n + 1)) >= 12).sum()) if n else 0
    raw = [comps(load(f), False) for f in files]
    filled = [comps(load(f), True) for f in files]
    # control: an intact frame 0 with a 4 px band erased across the shins must exceed 1 under the same filled measure
    cut = first.copy(); fg = np.abs(first - field).sum(axis=2) > 24; ys = np.nonzero(fg)[0]
    y = int(ys.min() + 0.75 * (ys.max() - ys.min())); cut[y:y + 4, :] = field
    print(f"control: frame 0 intact = {comps(first, True)} filled component(s); with a 4 px band erased across the shins = {comps(cut, True)}")
    print(f"frames {len(files)}; raw (not filled): min {min(raw)} max {max(raw)} frames != 1: {sum(1 for c in raw if c != 1)}")
    print(f"hole-filled silhouette: min {min(filled)} max {max(filled)} frames != 1: {[i for i, c in enumerate(filled) if c != 1] or 'none'}")
elif cmd == "shaded":
    from scipy import ndimage as ndi
    EDGE = (0x45, 0x7c, 0xa4)  # shaded.json shading.edgeColour
    GATES = [(150, 388, 22), (235, 382, 28), (325, 376, 34)]  # STAGE.gates (x, y centre, r)
    shaded, home = load(sys.argv[2]), load(sys.argv[3])
    lum = lambda a: (0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]) / 255
    # floor: edge-colour pixels in the band y 500..700 outside the figure crop and the companions' boxes. The grid lines are the edge colour at 0.3..0.7 opacity over the
    # field, so a pixel counts when its offset from the field points the way the edge colour's does (cosine >= 0.995) and is at least 35 % as long
    def floor_px(a):
        band = a[500:700].astype(float); field = np.array([2, 5, 11.0])
        want = np.array(EDGE) - field; got = band - field
        mag = np.linalg.norm(got, axis=2); cos = (got @ want) / np.maximum(mag * np.linalg.norm(want), 1e-9)
        near = (cos >= 0.995) & (mag >= 0.35 * np.linalg.norm(want))
        near[:, CROP[0]:CROP[0] + CROP[2]] = False
        for bx, by, bw, bh in (CODEX_BOX, CLAWD_BOX):  # the companions' own shading is bluish too
            near[max(by - 500, 0):max(by + bh - 500, 0), bx:bx + bw] = False
        return int(near.sum())
    print(f"floor: edge-colour pixels, band y 500..700 outside the figure crop: shaded {floor_px(shaded)}; control, home sheet {floor_px(home)} (must be 0)")
    # gates: bright components (luminance >= 0.45, >= 300 px: the ring's body, not a stray edge pixel of the arch) inside each gate's box; the box is the ring's bounding square plus 10 px
    peak = []
    for i, (x, y, r) in enumerate(GATES):
        box = shaded[y - r - 10:y + r + 10, x - r - 10:x + r + 10]
        L = lum(box); lab, n = ndi.label(L >= 0.45, structure=np.ones((3, 3)))
        sizes = [int(v) for v in ndi.sum(L >= 0.45, lab, range(1, n + 1)) if v >= 300] if n else []
        top = np.sort(L.ravel())[-max(5, L.size // 20):]
        peak.append(float(top.mean()))
        print(f"gate {i + 1} (r {r}): bright components {len(sizes)} {sizes}; mean of the brightest 5 % of the box: {peak[-1]:.3f}")
    print(f"gate brightness rises toward the third: {peak[0] < peak[1] < peak[2]}")
    ctl = shaded[430:430 + 70, 830:830 + 70]
    cl, cn = ndi.label(lum(ctl) >= 0.45)
    print(f"control, an empty box of the same size: bright components {sum(1 for v in ndi.sum(lum(ctl) >= 0.45, cl, range(1, cn + 1)) if v >= 300) if cn else 0} (must be 0)")
    # bloom: the profile of the third ring's outer edge, read outward at the ring's LEFT-most point (the right-most sits on the arch's pier, whose
    # lit face would own the profile): luminance above the field along the row through the ring's centre, from the edge's peak outward to where
    # it drops under 10 % of that peak; the width is twice that distance (a line's glow is symmetric about it)
    def edge_width(a):
        x, y, r = GATES[2]
        x0 = int(x - r * np.cos(0.22)) - 3
        row = lum(a[y - 1:y + 2, x0 - 40:x0 + 8]).mean(axis=0) - lum(a[0:1, 0:1])[0, 0]
        k = int(np.argmax(row[-14:])) + len(row) - 14; pk = row[k]
        h = 0
        while k - h - 1 >= 0 and row[k - h - 1] >= 0.1 * pk: h += 1
        return 2 * h + 1, float(pk)
    w, pk = edge_width(shaded)
    print(f"bloom: third ring's outer edge, left-most point, outward profile: width at 10 % of peak {w} px (peak {pk:.3f}); line width 4.03 px -> {w / 4.03:.2f} x")
    if len(sys.argv) > 4:
        w0, pk0 = edge_width(load(sys.argv[4]))
        print(f"bloom baseline, same render with the bloom removed from the contract: {w0} px (peak {pk0:.3f}) -> {w0 / 4.03:.2f} x")
    # light steps: luminance histogram of the skin-hue pixels (green) in the figure crop, 20 bins; a step is a peak holding >= 15 % of them
    def steps(a):
        c = crop(a).astype(float) / 255; r_, g_, b_ = c[..., 0], c[..., 1], c[..., 2]
        skin = (g_ > r_ + 0.08) & (g_ > b_ + 0.04) & (g_ > 0.15)
        L = 0.2126 * r_ + 0.7152 * g_ + 0.0722 * b_
        h, edges = np.histogram(L[skin], bins=20, range=(0, 1)); h = ndi.uniform_filter1d(h.astype(float), 2)
        peaks = [i for i in range(20) if h[i] >= 0.15 * skin.sum() / 2 and h[i] >= h[max(i - 1, 0)] and h[i] >= h[min(i + 1, 19)] and h[i] == h[max(0, i - 2):i + 3].max()]
        centres = [round(float((edges[i] + edges[i + 1]) / 2), 3) for i in peaks]
        return int(skin.sum()), centres
    n, ps = steps(shaded)
    print(f"light steps: skin pixels {n}; peaks (>= 15 % of them) at luminance {ps}; two steps >= 0.12 apart: {len(ps) >= 2 and max(ps) - min(ps) >= 0.12}")
    if len(sys.argv) > 5:
        n0, ps0 = steps(load(sys.argv[5]))
        print(f"light steps, earlier render: skin pixels {n0}; peaks at luminance {ps0}; two steps >= 0.12 apart: {len(ps0) >= 2 and max(ps0) - min(ps0) >= 0.12}")
elif cmd == "loop":
    from scipy import ndimage as ndi
    files = sorted(glob.glob(f"{sys.argv[2]}/element-*.png"))
    first = load(files[0]); field = first[0, 0]
    MIN_AREA = 12  # specks under this are antialiasing, not strokes
    def ink(a): return np.abs(a - field).sum(axis=2) > 24
    def verdict(a):
        """Closed = the hole-filled ink is one body: its largest piece spans the whole height of everything drawn and holds >= 95 % of
        the filled area. A closed boundary fills its whole interior, so eyes, hair strands and every other island inside it are absorbed
        (islands are tolerated by construction); a cut across the legs leaves the legs unfilled and the figure in two or more pieces.
        Pieces that touch the crop's left border are not the figure (its leftmost point, the cape tip, stays 40 px inside; the arch
        reaches that border once the leading line has slid the drawing right by up to 56 px) and are left out. The right border is not
        excluded: the raised hand reaches it."""
        filled = ndi.binary_fill_holes(ink(a))
        lab, n = ndi.label(filled, structure=np.ones((3, 3)))
        if n == 0: return False, 0.0, 0.0
        sizes = np.array(ndi.sum(filled, lab, range(1, n + 1)))
        edge = set(np.unique(lab[:, 0]).tolist()) - {0}
        keep = [i for i in range(n) if sizes[i] >= MIN_AREA and (i + 1) not in edge]
        if not keep: return False, 0.0, 0.0
        boxes = ndi.find_objects(lab)
        top = min(boxes[i][0].start for i in keep); bottom = max(boxes[i][0].stop for i in keep)
        big = max(keep, key=lambda i: sizes[i])
        height = (boxes[big][0].stop - boxes[big][0].start) / (bottom - top)
        share = sizes[big] / sizes[keep].sum()
        return bool(height >= 0.98 and share >= 0.95), float(height), float(share)
    def cut(a):
        fg = ink(a); ys = np.nonzero(fg.any(axis=1))[0]
        y = int(ys.min() + 0.75 * (ys.max() - ys.min())); b = a.copy(); b[y:y + 4, :] = field
        return b, y
    # positive controls: the same frame intact vs with a 4 px band erased across the shins; the line phase (frame 62) is the case that matters
    line_i = min(62, len(files) - 1)
    ok_controls = True
    for i in (0, line_i):
        a = load(files[i]); b, y = cut(a)
        (v0, h0, s0), (v1, h1, s1) = verdict(a), verdict(b)
        ok_controls &= v0 and not v1
        print(f"control, frame {i}: intact closed={v0} (height {h0:.3f}, share {s0:.3f}); 4 px band erased across the shins (row {y}) closed={v1} (height {h1:.3f}, share {s1:.3f}) {'flips' if v0 and not v1 else 'DOES NOT FLIP'}")
    if not ok_controls: sys.exit("positive control failed: the probe cannot tell a closed loop from a cut one")
    res = [verdict(load(f)) for f in files]
    bad = [i for i, r in enumerate(res) if not r[0]]
    print(f"frames {len(files)}; loop closed on {len(files) - len(bad)}; open on {bad or 'none'}; min height {min(r[1] for r in res):.3f}, min share {min(r[2] for r in res):.3f}")
    def comps(a, fill):
        fg = ink(a)
        if fill: fg = ndi.binary_fill_holes(fg)
        lab, n = ndi.label(fg, structure=np.ones((3, 3)))
        return int((ndi.sum(fg, lab, range(1, n + 1)) >= MIN_AREA).sum()) if n else 0
    raw = [comps(load(f), False) for f in files]; fil = [comps(load(f), True) for f in files]
    print(f"old counts, for comparison: raw 8-connected min {min(raw)} max {max(raw)} (frames != 1: {sum(1 for c in raw if c != 1)}); hole-filled min {min(fil)} max {max(fil)} (frames != 1: {sum(1 for c in fil if c != 1)})")
elif cmd == "pigments":
    targets = {"codex #4f7df2": (0x4f, 0x7d, 0xf2), "clawd #e8694a": (0xe8, 0x69, 0x4a)}
    boxes = {"codex #4f7df2": CODEX_BOX, "clawd #e8694a": CLAWD_BOX}
    for p in sys.argv[2:]:
        a = load(p)
        out = []
        for name, rgb in targets.items():
            sub = crop(a, boxes[name])
            out.append(f"{name}: {int((sub == np.array(rgb)).all(axis=2).sum())} px")
        print(f"{os.path.basename(p)}: " + " · ".join(out))

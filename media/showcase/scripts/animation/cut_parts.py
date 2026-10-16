"""The parts cut of a plate family (row 6.9): the home plate, cut by the skeleton into the parts the parts rig poses and draws.

`cut-parts.mjs` (npm run parts) is the entry point: it runs `cut(...)` here for the rasters and meshes the parts with maskToMesh. A part is a piece of the plate that moves with one bone:
hair, head, torso (neck and collar), poncho, upper arm (the cape's sleeve), forearm, hand, upper leg, lower leg, foot, left and right where there is a pair.

How the pixels are given to parts, in this order (each rule reads the plate and the family's joints, never a hand-placed outline):
  1. faces: the plate's own pale contour lines are removed (the thin pale structures, the measure of the contour width) and what is left falls into connected faces; a face is cut as a
     whole, so the cape, a trouser leg and an arm are separated along the lines the artist drew. Thin lines and small faces take the part of the nearest face.
  2. groups: a face is head-and-hair (above the collar), arm (skin faces along a forearm, or the hand), leg (most of its area below the cape's tip), or cape (the rest).
  3. geometry inside a group: the head is the disc the face's green fills (hair is what is left above the collar); the torso is the neck and collar column; a hand is what lies past the wrist
     plane of its forearm, a foot what lies past the ankle plane of its shin; a leg splits at the knee plane; a sleeve (upper arm) is the cape that is nearer
     its shoulder-to-elbow bone than the cape's own axis (torso to poncho point), the rest of the cape is the poncho.
  4. overlap: wherever two parts meet, each reaches into the other. The reach is a slab of `OVERLAP_PX` (about one contour width) across the border, and at a joint a cap: the disc of
     the limb's half width about the joint, so a limb bent about the joint never opens a notch at its outer side. Inside the reach the plate pixels are the same for both parts, so the
     rest pose is the plate; at pose time the part drawn in front fades out across the reach (`ramp`, 0 in its own cell up to 1 at the end of the reach) over the part behind, which is opaque
     there: the seam is a soft alpha, never a hard cut.
  5. completion: the top of each upper leg, hidden under the cape in the drawing, is continued upward by the cross-section the cape leaves visible, so a hip that moves does not show a cut edge.
Writes assets/<actor>/families/home/parts/<part>.png (RGBA, cropped, alpha = the part's own cell and its reach), <part>.ramp.png (8-bit: the fade), owners.png (8-bit: the part id of every
pixel of the plate, 0 outside) and parts.json (offset, size, bone, pins, rigid anchors, default z, neighbours, the cap of each joint).
"""
import json, os, sys
import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from plate_tools import ROOT, role_index, ROLES

REGION = (31, 30, 621, 952)          # the figure's box in mask space (the home mesh's region)
OVERLAP_PX = 10.0                    # mask px: about one contour width (7.6 mask px at the model sheet's scale), the reach and the fade of an overlap
CAP_MAX = 30.0                       # the largest joint cap radius
PART_IDS = ["hair", "head", "torso", "poncho",
            "upperArmL", "foreArmL", "handL", "upperArmR", "foreArmR", "handR",
            "upperLegL", "lowerLegL", "footL", "upperLegR", "lowerLegR", "footR"]
ID = {n: i + 1 for i, n in enumerate(PART_IDS)}
# the joint where two parts meet: (part, part) -> joint name (the cap is centred on it); pairs with no joint get the slab only
JOINT_OF = {frozenset(("head", "torso")): "head", frozenset(("torso", "poncho")): "torso",
            **{frozenset((f"upperArm{s}", "poncho")): f"shoulder{s}" for s in "LR"}, **{frozenset((f"upperArm{s}", "torso")): f"shoulder{s}" for s in "LR"},
            **{frozenset((f"upperArm{s}", f"foreArm{s}")): f"elbow{s}" for s in "LR"}, **{frozenset((f"foreArm{s}", f"hand{s}")): f"wrist{s}" for s in "LR"},
            **{frozenset((f"upperLeg{s}", f"lowerLeg{s}")): f"knee{s}" for s in "LR"}, **{frozenset((f"lowerLeg{s}", f"foot{s}")): f"ankle{s}" for s in "LR"}}


def seg_param(P, a, b):
    """(t, dist) of every point of P (H, W, 2) along segment a-b: t = projection in units of the segment (unclamped), dist to the clamped segment."""
    ab = b - a; L2 = float(ab @ ab)
    t = ((P - a) @ ab) / L2
    q = a + np.clip(t, 0, 1)[..., None] * ab
    return t, np.sqrt(((P - q) ** 2).sum(-1))


def faces_of(rgba, fig):
    """Connected faces of the figure once the thin pale contour lines are removed; (labels, count). Lines and faces under 30 px take the label of the nearest face."""
    rgb = rgba[..., :3].astype(int); mx = rgb.max(2); mn = rgb.min(2)
    pale = (mx > 170) & ((mx - mn) < 90) & fig
    thin = pale & (ndi.distance_transform_edt(pale) <= 3.5)
    fill = ndi.binary_opening(fig & ~thin, iterations=1)
    lab, n = ndi.label(fill)
    sizes = ndi.sum(fill, lab, range(1, n + 1))
    for i, s in enumerate(sizes, 1):
        if s < 30: lab[lab == i] = 0
    idx = ndi.distance_transform_edt(lab == 0, return_distances=False, return_indices=True)
    lab = np.where(fig, lab[idx[0], idx[1]], 0)
    return lab, n


def cut(actor="human", family="home"):
    d = os.path.join(ROOT, "assets", actor, "families", family)
    meta = json.load(open(os.path.join(d, "joints.json"))); J = {n: np.array(p, float) for n, p in meta["joints"].items()}
    rgba = np.asarray(Image.open(os.path.join(d, "plate.png")).convert("RGBA"))
    Hh, Ww = rgba.shape[:2]
    fig = rgba[..., 3] > 0
    x0, y0, x1, y1 = REGION
    box = np.zeros_like(fig); box[y0:y1, x0:x1] = True; fig &= box
    yy, xx = np.mgrid[0:Hh, 0:Ww].astype(float); P = np.stack([xx, yy], -1)
    roles = role_index(rgba[..., :3])
    names = list(ROLES)
    skin = np.isin(roles, [names.index("skin")]) & fig

    # --- faces and their groups
    lab, n = faces_of(rgba, fig)
    group = np.full(n + 1, "cape", dtype=object)
    cenx, ceny = {}, {}
    for i in range(1, n + 1):
        m = lab == i
        if not m.any(): continue
        ys, xs = np.nonzero(m); cx, cy = xs.mean(), ys.mean(); cenx[i], ceny[i] = cx, cy
        below = (ys > J["ponchoPoint"][1] + 14).mean()
        skinshare = skin[m].mean()
        c = np.array([cx, cy]); arm = None
        for s in "LR":
            elbow, wrist = J[f"elbow{s}"], J[f"wrist{s}"]
            tw = ((c - wrist) @ (wrist - elbow)) / ((wrist - elbow) @ (wrist - elbow))
            dist = float(seg_param(c, elbow, wrist)[1])
            if (skinshare > 0.35 and (dist < 40 or (tw > 0 and np.hypot(*(c - wrist)) < 170))) or (tw > 0 and np.hypot(*(c - wrist)) < 170 and (roles[m] != names.index("main1")).mean() > 0.6):
                arm = f"arm{s}"
        if cy < J["torso"][1] - 6 and not (abs(cx - J["neck"][0]) < 20 and cy > J["head"][1] - 8): group[i] = "head"
        elif arm: group[i] = arm
        elif below > 0.6: group[i] = "leg"
    grp = np.array(group, dtype=object)[lab]; grp[~fig] = ""

    owner = np.zeros((Hh, Ww), np.uint8)

    def give(mask, part):
        owner[mask & (owner == 0)] = ID[part]

    # --- head, hair, torso
    face = skin & (grp == "head") & (yy < J["head"][1])
    fl, fn = ndi.label(face)
    biggest = 1 + int(np.argmax(ndi.sum(face, fl, range(1, fn + 1))))
    fy, fx = np.nonzero(fl == biggest)
    cx, cy = (fx.min() + fx.max()) / 2, (fy.min() + fy.max()) / 2
    R = max(fx.max() - fx.min(), fy.max() - fy.min()) / 2 + 5
    disc = np.hypot(xx - cx, yy - cy) <= R
    chin_y = cy + R
    collar_y = J["torso"][1] + 24
    torso_col = fig & (np.abs(xx - J["neck"][0]) <= 34) & (yy < collar_y) & (yy > chin_y - 6)
    give(fig & disc & (yy < chin_y), "head")
    give(fig & (grp == "head") & ~(torso_col & (yy > chin_y - 10)), "hair")
    give(torso_col, "torso")

    # --- hands and feet, by the plane through the wrist (ankle) perpendicular to the forearm (shin)
    for s in "LR":
        el, wr = J[f"elbow{s}"], J[f"wrist{s}"]
        u = (wr - el) / np.hypot(*(wr - el))
        past = ((P - wr) @ u >= -6) & (np.hypot(xx - wr[0], yy - wr[1]) < 170) & fig
        give(past & (grp == f"arm{s}"), f"hand{s}")
        kn, an = J[f"knee{s}"], J[f"ankle{s}"]
        v = (an - kn) / np.hypot(*(an - kn))
        foot = ((P - an) @ v >= -4) & (np.hypot(xx - an[0], yy - an[1]) < 190) & fig & (grp == "leg")
        give(foot & (np.hypot(xx - an[0], yy - an[1]) < np.hypot(xx - J[f"ankle{'R' if s == 'L' else 'L'}"][0], yy - J[f"ankle{'R' if s == 'L' else 'L'}"][1])), f"foot{s}")
    for s in "LR":
        el, wr = J[f"elbow{s}"], J[f"wrist{s}"]
        t, dd = seg_param(P, el, wr)
        rim = fig & (dd < 24) & (t > 0.04) & (roles != names.index("main1"))
        past_elbow = ((P - el) @ ((wr - el) / np.hypot(*(wr - el)))) >= 0         # the border between sleeve and forearm passes through the elbow joint
        give(fig & (grp == f"arm{s}") & past_elbow, f"foreArm{s}")
        give(rim & past_elbow, f"foreArm{s}")

    # --- legs: side by the nearer leg chain, split at the knee plane
    legs = fig & (grp == "leg") & (owner == 0)
    dist_leg = {}
    for s in "LR":
        _, d1 = seg_param(P, J[f"hip{s}"], J[f"knee{s}"]); _, d2 = seg_param(P, J[f"knee{s}"], J[f"ankle{s}"])
        dist_leg[s] = np.minimum(d1, d2)
    side = dist_leg["L"] <= dist_leg["R"]
    for s, sel in (("L", side), ("R", ~side)):
        kn, an = J[f"knee{s}"], J[f"ankle{s}"]; v = (an - kn) / np.hypot(*(an - kn))
        above = (P - kn) @ v < 0
        give(legs & sel & above, f"upperLeg{s}"); give(legs & sel & ~above, f"lowerLeg{s}")

    # --- the cape: a sleeve is the cape nearer its shoulder-to-elbow bone than the cape's axis, minus a bias for the poncho; the upper arm bone is extended past the elbow so the hem's
    #     lining (the cape's underside, under the hem) belongs to the sleeve
    cape = fig & (owner == 0)
    _, d_axis = seg_param(P, J["torso"], J["ponchoPoint"])
    costs = {"poncho": d_axis - 26}
    for s in "LR":
        sh, el = J[f"shoulder{s}"], J[f"elbow{s}"]
        ext = el + (el - sh) * 0.35
        t, d = seg_param(P, sh, ext)
        costs[f"upperArm{s}"] = d + 1e3 * (t < 0)          # the cape above the shoulder plane is the poncho's: the border between sleeve and poncho passes through the shoulder joint, as every other border passes through its joint
    order = ["poncho", "upperArmL", "upperArmR"]
    stack = np.stack([costs[k] for k in order], 0)
    pick = stack.argmin(0)
    for i, k in enumerate(order): give(cape & (pick == i), k)
    # anything still unowned (isolated slivers of the figure) joins the nearest owned pixel
    left = fig & (owner == 0)
    if left.any():
        idx = ndi.distance_transform_edt(owner == 0, return_distances=False, return_indices=True)
        owner = np.where(fig, owner[idx[0], idx[1]], 0).astype(np.uint8)

    # --- the borders are the plate's own lines and bone planes; the halftone dots of the cape's lining make them ragged, so each pixel takes the part most of its 5 px neighbourhood belongs to
    owner = smooth(owner, fig)
    owner = one_piece(owner, fig)
    return {"owner": owner, "rgba": rgba, "J": J, "meta": meta, "fig": fig, "disc": (cx, cy, R), "roles": roles}


def smooth(owner, fig, sigma=2.2):
    ids = [i for i in range(1, len(PART_IDS) + 1) if (owner == i).any()]
    score = np.stack([cv2.GaussianBlur((owner == i).astype(np.float32), (0, 0), sigma) for i in ids], 0)
    out = np.array(ids, np.uint8)[score.argmax(0)]
    return np.where(fig, out, 0).astype(np.uint8)


def one_piece(owner, fig):
    """Each part is one 4-connected piece: a stray island goes to the part it shares the longest border with (the nearest owner pixel of another part)."""
    for _ in range(3):
        changed = False
        for i in range(1, len(PART_IDS) + 1):
            m = owner == i
            if not m.any(): continue
            lab, n = ndi.label(m)
            if n <= 1: continue
            sizes = ndi.sum(m, lab, range(1, n + 1)); keep = 1 + int(np.argmax(sizes))
            for j in range(1, n + 1):
                if j == keep: continue
                isl = lab == j
                ring = ndi.binary_dilation(isl, iterations=2) & ~isl & (owner > 0) & (owner != i)
                if ring.any():
                    vals = owner[ring]; owner[isl] = np.bincount(vals).argmax(); changed = True
        if not changed: break
    return owner


def cap_radius(fig, joint):
    edt = ndi.distance_transform_edt(fig)
    x, y = int(round(joint[0])), int(round(joint[1]))
    hw = float(edt[max(0, y - 10):y + 11, max(0, x - 10):x + 11].max())
    return float(min(CAP_MAX, max(OVERLAP_PX, 0.9 * hw)))


# a limb reaches into the part above it with its own material, not with that part's pixels: a forearm (skin) that bends under a sleeve (cloth) must not carry the sleeve's lining about as
# a lump at the elbow. Every other pair of parts reaches with the other's pixels (the same
# material, or a cloth over cloth, where the rest pose must be the plate).
# Where the border of two parts is a line the artist drew (the sleeve's hem over the forearm, the cape's hem over the legs, the chin over the hair and the neck), the part in front ends in that
# contour and reaches under nothing: the part behind reaches under it (NO_REACH is the directed pair that does not reach).
EXTRUDE = {("foreArmL", "upperArmL"), ("foreArmR", "upperArmR")}
BONE_FAR_END = {"foreArmL": "wristL", "foreArmR": "wristR"}          # the extrusion runs from the far end of the bone through the joint
NO_REACH = {("upperArmL", "foreArmL"), ("upperArmR", "foreArmR"), ("poncho", "upperLegL"), ("poncho", "upperLegR"), ("head", "hair"), ("head", "torso")}


def extrude_cap(owner, rgba, J, joint, a, rho, axis):
    """The cap of part `a` about `joint`, painted with a's own cross-section instead of the neighbour's pixels: (mask, rgb (h, w, 3)). The cross-section is a's pixels on the near side of the
    joint plane, carried along `axis` (the direction away from a: the border of a's cell is the plane through the joint perpendicular to it)."""
    H, W = owner.shape; yy, xx = np.mgrid[0:H, 0:W].astype(float)
    A = owner == ID[a]
    d = axis / np.hypot(*axis); n = np.array([-d[1], d[0]])
    u = (xx - joint[0]) * d[0] + (yy - joint[1]) * d[1]; v = (xx - joint[0]) * n[0] + (yy - joint[1]) * n[1]
    # the cross-section: for every lateral position, the colour of a's pixel three px inside its top edge (the edge nearest the joint along `axis`; the cell may stop short of the joint plane
    # where the hem covers it), and where that edge is
    vi = np.round(v[A]).astype(int); ua = u[A]; ys, xs = np.nonzero(A)
    edge = {}
    for q in range(len(vi)):
        k = int(vi[q])
        if k not in edge or ua[q] > edge[k][0]: edge[k] = (ua[q], ys[q], xs[q])
    keys = np.array(sorted(edge)); cols = np.array([rgba[edge[k][1], edge[k][2], :3] for k in keys]); tops = np.array([edge[k][0] for k in keys])
    mask = np.zeros((H, W), bool); rgb = np.zeros((H, W, 3), np.uint8)
    reg = (np.hypot(xx - joint[0], yy - joint[1]) <= rho) & (v >= keys.min() - 0.5) & (v <= keys.max() + 0.5) & (u > -8)
    vv = v[reg]; pick = np.abs(vv[:, None] - keys[None, :]).argmin(1)           # the nearest lateral position of the cross-section: no gaps
    reg_idx = np.nonzero(reg)
    keep = u[reg] > tops[pick] - 1                                                # only beyond the cell's own top edge
    mask[reg_idx[0][keep], reg_idx[1][keep]] = True; rgb[reg_idx[0][keep], reg_idx[1][keep]] = cols[pick][keep]
    return mask, rgb


def reach(owner, J, fig, rgba):
    """For every ordered pair (A, B) of parts that meet: the pixels of B's cell A reaches into and the fade d (0 next to A's own cell or inside the cap, 1 at the end of the reach).
    Returns {A: {"cov": bool mask, "ramp": float mask}} and the adjacency {A: {B: joint or None}}."""
    H, W = owner.shape; yy, xx = np.mgrid[0:H, 0:W].astype(float)
    cov, ramp, adj, caps, paint = {}, {}, {}, {}, {}
    for a in PART_IDS:
        A = owner == ID[a]
        cov[a] = A.copy(); ramp[a] = np.zeros((H, W), np.float32); adj[a] = {}
        if not A.any(): continue
        dist_a, idx = ndi.distance_transform_edt(~A, return_indices=True)
        near = ndi.binary_dilation(A, iterations=2)
        for b in PART_IDS:
            if a == b or not (near & (owner == ID[b])).any(): continue
            B = owner == ID[b]
            joint = JOINT_OF.get(frozenset((a, b)))
            if (a, b) in NO_REACH:
                adj[a][b] = joint
                continue
            slab = B & (dist_a <= OVERLAP_PX)
            d_slab = np.clip(dist_a / OVERLAP_PX, 0, 1)
            d = np.where(slab, d_slab, 1.0)
            region = slab.copy()
            if joint and (a, b) in EXTRUDE:
                rho = cap_radius(fig, J[joint]); caps[(a, b)] = (joint, rho)
                mask, rgb = extrude_cap(owner, rgba, J, J[joint], a, rho, J[joint] - J[BONE_FAR_END[a]])
                dj = np.hypot(xx - J[joint][0], yy - J[joint][1])
                d_cap = np.clip((dj - (rho - OVERLAP_PX)) / OVERLAP_PX, 0, 1)
                paint.setdefault(a, []).append((mask & ~(owner == ID[a]), rgb))
                cov[a] |= mask & ~(owner == ID[a])
                ramp[a] = np.where(mask & ~(owner == ID[a]), d_cap.astype(np.float32), ramp[a])
                region = np.zeros_like(slab); d = np.ones_like(d)
            elif joint:
                rho = cap_radius(fig, J[joint]); caps[(a, b)] = (joint, rho)
                dj = np.hypot(xx - J[joint][0], yy - J[joint][1])
                disc = B & (dj <= rho)
                d_cap = np.clip((dj - (rho - OVERLAP_PX)) / OVERLAP_PX, 0, 1)
                d = np.where(disc, np.minimum(d, d_cap), d)
                region |= disc
            cov[a] |= region
            ramp[a] = np.where(region, np.minimum(np.where(ramp[a] > 0, ramp[a], 1.0), d).astype(np.float32), ramp[a])
            adj[a][b] = joint
    return cov, ramp, adj, caps, paint


def complete_leg_tops(owner, rgba, J, cov, ramp, side, length=48.0):
    """Continue the top of an upper leg upward along the leg by the cross-section the cape leaves visible (the legs go under the cape; a hip that moves must not show a cut edge).
    Returns the colour image of the leg and the extended cov and ramp."""
    H, W = owner.shape; yy, xx = np.mgrid[0:H, 0:W].astype(float)
    a_id = f"upperLeg{side}"; A = owner == ID[a_id]
    hip, knee = J[f"hip{side}"], J[f"knee{side}"]
    u = (knee - hip) / np.hypot(*(knee - hip)); nrm = np.array([-u[1], u[0]])
    pa = (xx - hip[0]) * u[0] + (yy - hip[1]) * u[1]; pb = (xx - hip[0]) * nrm[0] + (yy - hip[1]) * nrm[1]
    bins = np.round(pb[A]).astype(int); avals = pa[A]
    top = {}
    for b, av in zip(bins, avals):
        if b not in top or av < top[b]: top[b] = av
    img = rgba.copy()
    new = np.zeros((H, W), bool)
    bmin, bmax = min(top), max(top)
    for b in range(bmin, bmax + 1):
        if b not in top: continue
        a0 = top[b]
        src = hip + u * (a0 + 3) + nrm * b                      # the visible pixel at the top of this strip
        sx, sy = int(round(src[0])), int(round(src[1]))
        col = rgba[sy, sx].copy()
        for k in np.arange(1, length + 1, 0.5):
            q = hip + u * (a0 - k) + nrm * b
            qx, qy = int(round(q[0])), int(round(q[1]))
            if 0 <= qy < H and 0 <= qx < W and not A[qy, qx]:
                if not new[qy, qx]:
                    img[qy, qx] = col; new[qy, qx] = True
                    ramp_val = min(1.0, k / length)
                    ramp[a_id][qy, qx] = max(ramp[a_id][qy, qx], ramp_val) if cov[a_id][qy, qx] else ramp_val
    cov[a_id] = cov[a_id] | new
    return img


SPEC = {
    "hair":       dict(bone=("neck", "head"), mode="rigid", pivot="head", pins=[], z=0),
    "head":       dict(bone=("neck", "head"), mode="rigid", pivot="head", pins=["head"], z=14),
    "torso":      dict(bone=("torso", "neck"), mode="limb", pivot="torso", pins=["torso", "neck"], z=12),
    "poncho":     dict(bone=("torso", "ponchoPoint"), mode="limb", pivot="torso", pins=["torso", "ponchoPoint", "shoulderL", "shoulderR"], z=10),
    **{f"upperArm{s}": dict(bone=(f"shoulder{s}", f"elbow{s}"), mode="limb", pivot=f"shoulder{s}", pins=[f"shoulder{s}", f"elbow{s}"], z=11) for s in "LR"},
    **{f"foreArm{s}": dict(bone=(f"elbow{s}", f"wrist{s}"), mode="limb", pivot=f"elbow{s}", pins=[f"elbow{s}", f"wrist{s}"], z=9) for s in "LR"},
    **{f"hand{s}": dict(bone=(f"elbow{s}", f"wrist{s}"), mode="rigid", pivot=f"wrist{s}", pins=[f"wrist{s}"], z=9.5) for s in "LR"},
    **{f"upperLeg{s}": dict(bone=(f"hip{s}", f"knee{s}"), mode="limb", pivot=f"hip{s}", pins=[f"hip{s}", f"knee{s}"], z=4) for s in "LR"},
    **{f"lowerLeg{s}": dict(bone=(f"knee{s}", f"ankle{s}"), mode="limb", pivot=f"knee{s}", pins=[f"knee{s}", f"ankle{s}"], z=3) for s in "LR"},
    **{f"foot{s}": dict(bone=(f"knee{s}", f"ankle{s}"), mode="rigid", pivot=f"ankle{s}", pins=[f"ankle{s}"], z=2) for s in "LR"},
}


def anchors_of(core, pivot, k=3):
    """k rest points inside the part, far from each other and from the pivot, for a part that moves rigidly (pins at the pivot joint and these)."""
    edt = ndi.distance_transform_edt(core)
    ys, xs = np.nonzero(edt >= max(3.0, 0.35 * edt.max()))
    pts = np.stack([xs, ys], 1).astype(float)
    chosen = []
    cur = pts[np.argmax(np.hypot(*(pts - pivot).T))]; chosen.append(cur)
    while len(chosen) < k:
        dmin = np.min([np.hypot(*(pts - c).T) for c in chosen + [pivot]], axis=0)
        chosen.append(pts[np.argmax(dmin)])
    return [[round(float(x), 1), round(float(y), 1)] for x, y in chosen]


def write_parts(r, actor="human", family="home", work=None):
    """Cut, reach, complete and write the part files. Returns parts.json's content."""
    owner, rgba, J, fig = r["owner"], r["rgba"], r["J"], r["fig"]
    d = os.path.join(ROOT, "assets", actor, "families", family); out = os.path.join(d, "parts"); os.makedirs(out, exist_ok=True)
    work = work or os.path.join(ROOT, "out", "parts-work"); os.makedirs(work, exist_ok=True)
    cov, ramp, adj, caps, paint = reach(owner, J, fig, rgba)
    colour = {a: rgba.copy() for a in PART_IDS}
    for a, items in paint.items():
        for mask, rgb in items: colour[a][mask, :3] = rgb[mask]
    for s in "LR": colour[f"upperLeg{s}"] = complete_leg_tops(owner, rgba, J, cov, ramp, s)
    Image.fromarray(owner, "L").save(os.path.join(out, "owners.png"), optimize=True)
    parts = []
    for name in PART_IDS:
        c = cov[name]
        ys, xs = np.nonzero(c)
        ox0, oy0, ox1, oy1 = int(xs.min()) - 2, int(ys.min()) - 2, int(xs.max()) + 3, int(ys.max()) + 3
        crop = (slice(oy0, oy1), slice(ox0, ox1))
        img = colour[name][crop].copy(); img[..., 3] = np.where(c[crop], 255, 0); img[img[..., 3] == 0, :3] = 0
        Image.fromarray(img, "RGBA").save(os.path.join(out, f"{name}.png"), optimize=True)
        Image.fromarray(np.round(np.clip(ramp[name][crop], 0, 1) * 255).astype(np.uint8), "L").save(os.path.join(out, f"{name}.ramp.png"), optimize=True)
        Image.fromarray(np.where(c[crop], 255, 0).astype(np.uint8), "L").save(os.path.join(work, f"{name}.mask.png"), optimize=True)
        spec = SPEC[name]
        core = owner == ID[name]
        pivot = J[spec["pivot"]]
        anchors = anchors_of(c, pivot) if spec["mode"] == "rigid" else []
        pins = []
        edt_c = ndi.distance_transform_edt(c)
        for pin in spec["pins"]:
            px, py = int(round(J[pin][0])), int(round(J[pin][1]))
            if c[py, px] and edt_c[py, px] >= 2: pins.append({"joint": pin, "rest": [round(float(J[pin][0]), 2), round(float(J[pin][1]), 2)]}); continue
            # a joint that lies outside the part's pixels (the cape's tip is drawn short of the poncho-point joint) pins the nearest interior pixel, carried by the part's own bone rotation
            ys2, xs2 = np.nonzero(edt_c >= 3); dd = np.hypot(xs2 - J[pin][0], ys2 - J[pin][1]); k = int(np.argmin(dd))
            if dd[k] > 60: raise SystemExit(f"cut-parts: pin {pin} of {name} at ({px}, {py}) is {dd[k]:.0f} px from the part's pixels")
            pins.append({"joint": pin, "rest": [float(xs2[k]), float(ys2[k])]})
        for ax, ay in anchors:
            if not c[int(round(ay)), int(round(ax))]: raise SystemExit(f"cut-parts: anchor ({ax}, {ay}) of {name} lies outside the part's pixels")
        parts.append({"name": name, "id": ID[name], "png": f"{name}.png", "ramp": f"{name}.ramp.png", "mesh": f"{name}.mesh.json", "offset": [ox0, oy0], "size": [ox1 - ox0, oy1 - oy0],
                      "bone": list(spec["bone"]), "mode": spec["mode"], "pivot": spec["pivot"], "pins": pins, "anchors": anchors, "z": spec["z"],
                      "area": int(core.sum()), "reaches": {b: ({"joint": j, "capPx": round(caps[(name, b)][1], 1) if (name, b) in caps else None} if j else {"joint": None}) for b, j in adj[name].items()}})
    return {"family": family, "actor": actor, "plateSha256": r["meta"]["plateSha256"], "overlapPx": OVERLAP_PX, "capMaxPx": CAP_MAX, "owners": "owners.png",
            "note": "Cut by cut_parts.py from the family plate and its skeleton joints (scripts/animation/cut-parts.mjs, npm run parts). `z` is the default draw order, larger in front; `mode` rigid moves the part by its bone's rotation about `pivot` (pins: the pivot joint and `anchors`), limb pins its own joints.",
            "parts": parts}


def main():
    """usage: cut_parts.py <draft.json> [actor] [family]: cuts the family plate, writes the part rasters and the draft parts.json (cut-parts.mjs meshes the parts and finishes it)."""
    out = sys.argv[1]; actor = sys.argv[2] if len(sys.argv) > 2 else "human"; family = sys.argv[3] if len(sys.argv) > 3 else "home"
    r = cut(actor, family)
    draft = write_parts(r, actor, family, work=os.path.dirname(os.path.abspath(out)))
    json.dump(draft, open(out, "w"), indent=1)
    print("cut: " + ", ".join(f"{p['name']} {p['area']} px" for p in draft["parts"]))


if __name__ == "__main__": main()

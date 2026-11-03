import earcut, {deviation} from 'earcut';
import type {Mesh} from './arap';

/**
 * Binary mask -> triangle mesh for the ARAP rig (D73). Pure: the caller decodes the PNG (scripts/mesh.mjs does, at build time, and writes
 * assets/human/mesh.json), so a Remotion render never reads pixels.
 *
 * 1. keep the largest 4-connected foreground component inside `region`;
 * 2. trace every boundary loop (outer and holes) by following the pixel cracks with foreground on the right, which is marching squares
 *    on a binary image; collinear points are dropped;
 * 3. simplify each loop with Douglas-Peucker (`simplify` px);
 * 4. triangulate the polygon with earcut, then insert interior grid points (`gridSpacing` px) by splitting the containing triangle and
 *    legalising with Lawson flips, because earcut itself accepts no Steiner points. Boundary edges have one triangle, so no flip can move them.
 * Mesh space is image pixel space (pixel corners at integers); uvs are position / image size, with v pointing down like y.
 */

export type MaskImage = {width: number; height: number; data: ArrayLike<number>};
export type MeshOptions = {
  /** Pixel box [x0, y0, x1, y1), x1 and y1 exclusive. Default: the whole image. */
  region?: [number, number, number, number];
  /** Foreground when data >= threshold. */
  threshold?: number;
  /** Douglas-Peucker tolerance in px. */
  simplify?: number;
  /** Interior grid spacing in px. */
  gridSpacing?: number;
  /** An interior point must lie at least this far from the contour (default 0.45 * gridSpacing). */
  clearance?: number;
  /** Holes smaller than this many px^2 are filled. */
  minHoleArea?: number;
};
export type MeshData = Mesh & {
  uvs: Float32Array;
  width: number;
  height: number;
  stats: {vertices: number; triangles: number; contourVertices: number; interiorVertices: number; holes: number; earcutDeviation: number; skippedInterior: number};
};

type Pt = [number, number];

const largestComponent = (mask: MaskImage, region: [number, number, number, number], threshold: number): Uint8Array => {
  const {width: w, height: h, data} = mask;
  const [x0, y0, x1, y1] = region;
  const on = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (data[y * w + x]! >= threshold) on[y * w + x] = 1;
  const label = new Int32Array(w * h);
  let best = 0, bestSize = 0, next = 0;
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!on[i] || label[i]) continue;
    next++;
    let size = 0;
    stack.push(i); label[i] = next;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w, y = (p - x) / w;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (on[q] && !label[q]) { label[q] = next; stack.push(q); }
      }
    }
    if (size > bestSize) { best = next; bestSize = size; }
  }
  const fg = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (label[i] === best) fg[i] = 1;
  return fg;
};

type CrackEdge = {x: number; y: number; used: boolean};

/** Every boundary loop of the foreground as a list of corner points (collinear points removed) with its signed area (> 0 = outer). */
const traceLoops = (fg: Uint8Array, w: number, h: number): Array<{pts: Pt[]; area: number}> => {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && fg[y * w + x] === 1;
  const key = (x: number, y: number) => y * (w + 1) + x;
  const out = new Map<number, CrackEdge[]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = key(x0, y0);
    const list = out.get(k) ?? [];
    list.push({x: x1, y: y1, used: false});
    out.set(k, list);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x, y, x + 1, y);
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const loops: Array<{pts: Pt[]; area: number}> = [];
  for (const [startKey, startList] of out) {
    for (const first of startList) {
      if (first.used) continue;
      const sx = startKey % (w + 1), sy = (startKey - sx) / (w + 1);
      const pts: Pt[] = [[sx, sy]];
      let cx = sx, cy = sy, edge = first;
      for (;;) {
        edge.used = true;
        const dx = edge.x - cx, dy = edge.y - cy;
        cx = edge.x; cy = edge.y;
        const candidates = (out.get(key(cx, cy)) ?? []).filter((e) => !e.used || e === first);
        if (candidates.length === 0) break;
        // at a saddle two edges leave; turning right (clockwise, foreground on the right) keeps diagonal pixels 4-disconnected
        const rank = (e: CrackEdge) => {
          const ex = e.x - cx, ey = e.y - cy;
          if (ex === -dy && ey === dx) return 0;
          if (ex === dx && ey === dy) return 1;
          return 2;
        };
        candidates.sort((p, q) => rank(p) - rank(q));
        const chosen = candidates[0]!;
        if (chosen === first) break;
        pts.push([cx, cy]);
        edge = chosen;
      }
      loops.push({pts: dropCollinear(pts), area: signedArea(pts)});
    }
  }
  return loops;
};

const signedArea = (p: Pt[]): number => {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i]!, b = p[(i + 1) % p.length]!; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
};

const dropCollinear = (p: Pt[]): Pt[] =>
  p.filter((c, i) => {
    const a = p[(i - 1 + p.length) % p.length]!, b = p[(i + 1) % p.length]!;
    return (c[0] - a[0]) * (b[1] - c[1]) - (c[1] - a[1]) * (b[0] - c[0]) !== 0;
  });

const segDist = (p: Pt, a: Pt, b: Pt): number => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

const douglasPeucker = (pts: Pt[], eps: number): Pt[] => {
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let far = -1, farD = eps;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(pts[k]!, pts[i]!, pts[j]!);
      if (d > farD) { far = k; farD = d; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([i, far], [far, j]); }
  }
  return pts.filter((_, i) => keep[i] === 1);
};

/** Closed-loop Douglas-Peucker: split at point 0 and the point farthest from it, simplify both halves. */
const simplifyClosed = (loop: Pt[], eps: number): Pt[] => {
  if (loop.length <= 4) return loop;
  let far = 0, farD = -1;
  loop.forEach((p, i) => { const d = Math.hypot(p[0] - loop[0]![0], p[1] - loop[0]![1]); if (d > farD) { far = i; farD = d; } });
  const first = douglasPeucker(loop.slice(0, far + 1), eps);
  const second = douglasPeucker([...loop.slice(far), loop[0]!], eps);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
};

const insidePolygons = (p: Pt, loops: Pt[][]): boolean => {
  let inside = false;
  for (const loop of loops) {
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = loop[i]!, b = loop[j]!;
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
  }
  return inside;
};

const orient = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/** > 0 when d lies inside the circumcircle of the triangle abc, whatever its winding. */
const inCircle = (a: Pt, b: Pt, c: Pt, d: Pt): number => {
  const ax = a[0] - d[0], ay = a[1] - d[1], bx = b[0] - d[0], by = b[1] - d[1], cx = c[0] - d[0], cy = c[1] - d[1];
  const det = (ax * ax + ay * ay) * (bx * cy - cx * by) - (bx * bx + by * by) * (ax * cy - cx * ay) + (cx * cx + cy * cy) * (ax * by - bx * ay);
  return det * Math.sign(orient(a, b, c));
};

type Tri = [number, number, number];

/** Insert `p` (already appended to `pts` at index `pi`) by splitting its triangle, then flip edges until locally Delaunay. Returns false if p sits on an edge. */
const insertPoint = (pts: Pt[], tris: Tri[], pi: number): boolean => {
  const p = pts[pi]!;
  let host = -1;
  for (let t = 0; t < tris.length && host < 0; t++) {
    const [a, b, c] = tris[t]!;
    const o = Math.sign(orient(pts[a]!, pts[b]!, pts[c]!));
    const e1 = o * orient(pts[a]!, pts[b]!, p), e2 = o * orient(pts[b]!, pts[c]!, p), e3 = o * orient(pts[c]!, pts[a]!, p);
    if (e1 > 1e-6 && e2 > 1e-6 && e3 > 1e-6) host = t;
    else if (e1 >= -1e-6 && e2 >= -1e-6 && e3 >= -1e-6) return false;
  }
  if (host < 0) return false;
  const [a, b, c] = tris[host]!;
  tris[host] = [a, b, pi];
  tris.push([b, c, pi], [c, a, pi]);
  const work: Array<[number, number]> = [[a, b], [b, c], [c, a]];
  while (work.length) {
    const [u, v] = work.pop()!;
    // the triangle on the far side of edge u-v from p
    let near = -1, far = -1;
    for (let t = 0; t < tris.length; t++) {
      const tri = tris[t]!;
      if (!tri.includes(u) || !tri.includes(v)) continue;
      if (tri.includes(pi)) near = t; else far = t;
    }
    if (near < 0 || far < 0) continue;
    const d = tris[far]!.find((x) => x !== u && x !== v)!;
    if (inCircle(pts[pi]!, pts[u]!, pts[v]!, pts[d]!) > 0 && quadConvex(pts, pi, u, d, v)) {
      tris[near] = [pi, u, d];
      tris[far] = [pi, d, v];
      work.push([u, d], [d, v]);
    }
  }
  return true;
};

/** Quad p-u-d-v is strictly convex: its diagonal p-d lies inside it, so flipping u-v to p-d is valid. */
const quadConvex = (pts: Pt[], p: number, u: number, d: number, v: number): boolean => {
  const s1 = orient(pts[p]!, pts[u]!, pts[d]!), s2 = orient(pts[u]!, pts[d]!, pts[v]!), s3 = orient(pts[d]!, pts[v]!, pts[p]!), s4 = orient(pts[v]!, pts[p]!, pts[u]!);
  return (s1 > 0 && s2 > 0 && s3 > 0 && s4 > 0) || (s1 < 0 && s2 < 0 && s3 < 0 && s4 < 0);
};

export const maskToMesh = (mask: MaskImage, opts: MeshOptions = {}): MeshData => {
  const {width: w, height: h} = mask;
  const region = opts.region ?? [0, 0, w, h];
  const simplify = opts.simplify ?? 3;
  const spacing = opts.gridSpacing ?? 24;
  const clearance = opts.clearance ?? 0.45 * spacing;
  const minHole = opts.minHoleArea ?? 16;

  const fg = largestComponent(mask, region, opts.threshold ?? 128);
  const loops = traceLoops(fg, w, h);
  const outer = loops.filter((l) => l.area > 0).sort((a, b) => b.area - a.area)[0];
  if (!outer) throw new Error('maskToMesh: no foreground in the region');
  const holes = loops.filter((l) => l.area < 0 && -l.area >= minHole);
  const outerPts = simplifyClosed(outer.pts, simplify);
  const holePts = holes.map((l) => simplifyClosed(l.pts, simplify)).filter((l) => l.length >= 3);
  const polygons = [outerPts, ...holePts];

  // earcut wants the outer ring then the holes, flat, with hole start indices
  const flat: number[] = [];
  const holeIdx: number[] = [];
  const pts: Pt[] = [];
  polygons.forEach((ring, r) => {
    if (r > 0) holeIdx.push(pts.length);
    for (const p of ring) { flat.push(p[0], p[1]); pts.push([p[0], p[1]]); }
  });
  const cut = earcut(flat, holeIdx, 2);
  const triangulationError = deviation(flat, holeIdx, 2, cut);
  const tris: Tri[] = [];
  for (let i = 0; i < cut.length; i += 3) tris.push([cut[i]!, cut[i + 1]!, cut[i + 2]!]);
  const contourCount = pts.length;

  // interior grid points: inside the polygon, away from the contour
  let skipped = 0;
  for (let y = region[1] + spacing / 2; y < region[3]; y += spacing) {
    for (let x = region[0] + spacing / 2; x < region[2]; x += spacing) {
      const p: Pt = [x, y];
      if (!insidePolygons(p, polygons)) continue;
      let near = Infinity;
      for (const ring of polygons) for (let i = 0; i < ring.length; i++) near = Math.min(near, segDist(p, ring[i]!, ring[(i + 1) % ring.length]!));
      if (near < clearance) continue;
      pts.push(p);
      if (!insertPoint(pts, tris, pts.length - 1)) { pts.pop(); skipped++; }
    }
  }

  // earcut can leave contour vertices out of every triangle; keep only the vertices that are used
  const remap = new Map<number, number>();
  const vertices: number[] = [];
  const triangles: number[] = [];
  for (const t of tris) {
    for (const v of t) {
      if (!remap.has(v)) { remap.set(v, remap.size); vertices.push(pts[v]![0], pts[v]![1]); }
      triangles.push(remap.get(v)!);
    }
  }
  const uvs = new Float32Array(vertices.length);
  for (let i = 0; i < vertices.length; i += 2) { uvs[i] = vertices[i]! / w; uvs[i + 1] = vertices[i + 1]! / h; }
  return {
    vertices: Float32Array.from(vertices),
    triangles: Uint32Array.from(triangles),
    uvs,
    width: w,
    height: h,
    stats: {vertices: remap.size, triangles: tris.length, contourVertices: contourCount, interiorVertices: pts.length - contourCount, holes: holePts.length, earcutDeviation: triangulationError, skippedInterior: skipped},
  };
};

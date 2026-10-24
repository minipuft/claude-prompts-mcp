/**
 * As-Rigid-As-Possible 2D shape manipulation (D73). TypeScript port of animated_drawings/model/arap.py
 * (facebookresearch/AnimatedDrawings, MIT), which implements Igarashi & Igarashi 2009 on top of Igarashi, Moscovich & Hughes 2005:
 * pass 1 solves vertex positions with rotation AND scale free, per-edge rotations are read back from that solution, pass 2 rotates the
 * rest edges by those rotations and solves again so only scale is penalised.
 *
 * Differences from the reference, none of them in the maths:
 *  - the system matrices are accumulated sparsely and factored once (dense Cholesky, double precision) instead of `spsolve` per call;
 *    a solve is then two triangular solves per pass. Meant for <= ~800 vertices.
 *  - the reference builds A1/A2 in float32; this keeps float64.
 * Pins are given in mesh space and are converted to barycentric coordinates of the triangle that contains them, as the reference does;
 * a pin outside the mesh is dropped (the reference logs and skips it), and `droppedPins` lists those indices.
 * Pure: no DOM, no Node API, no module state. No TypeScript-only runtime syntax (parameter properties), so Node can run it with type stripping.
 */

export type Mesh = {vertices: Float32Array; triangles: Uint32Array};

type Bary = {verts: [number, number, number]; weights: [number, number, number]};

/** In-place lower Cholesky of the symmetric positive definite n x n row-major matrix; returns false on a non-positive pivot. */
const cholesky = (a: Float64Array, n: number): boolean => {
  for (let i = 0; i < n; i++) {
    const ri = i * n;
    for (let j = 0; j <= i; j++) {
      const rj = j * n;
      let sum = a[ri + j]!;
      for (let k = 0; k < j; k++) sum -= a[ri + k]! * a[rj + k]!;
      if (i === j) {
        if (!(sum > 0)) return false;
        a[ri + i] = Math.sqrt(sum);
      } else {
        a[ri + j] = sum / a[rj + j]!;
      }
    }
  }
  return true;
};

/** A symmetric positive definite matrix factored once; `solve` is forward then backward substitution. */
class DenseCholesky {
  private readonly lower: Float64Array;
  private readonly upper: Float64Array;
  private readonly n: number;
  constructor(n: number, matrix: Float64Array) {
    this.n = n;
    // the reference perturbs a singular matrix by 1e-8 * I and retries; here a non-positive pivot throws, because it means a vertex
    // belongs to no triangle or no pin is inside the mesh, and a perturbed retry would hide that
    if (!cholesky(matrix, n)) throw new Error(`Arap: normal matrix is not positive definite (n=${n}); a mesh vertex belongs to no triangle or no pin lies inside the mesh`);
    this.lower = matrix;
    this.upper = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) this.upper[j * n + i] = matrix[i * n + j]!;
  }
  solve(b: Float64Array): Float64Array {
    const {n, lower, upper} = this;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const ri = i * n;
      let s = b[i]!;
      for (let k = 0; k < i; k++) s -= lower[ri + k]! * y[k]!;
      y[i] = s / lower[ri + i]!;
    }
    for (let i = n - 1; i >= 0; i--) {
      const ri = i * n;
      let s = y[i]!;
      for (let k = i + 1; k < n; k++) s -= upper[ri + k]! * y[k]!;
      y[i] = s / upper[ri + i]!;
    }
    return y;
  }
}

/** Barycentric coordinates of p in triangle abc (Ericson, Real-Time Collision Detection), as _get_barycentric_coords. */
const barycentric = (px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): [number, number, number] => {
  const v0x = bx - ax, v0y = by - ay, v1x = cx - ax, v1y = cy - ay, v2x = px - ax, v2y = py - ay;
  const d00 = v0x * v0x + v0y * v0y, d01 = v0x * v1x + v0y * v1y, d11 = v1x * v1x + v1y * v1y;
  const d20 = v2x * v0x + v2y * v0y, d21 = v2x * v1x + v2y * v1y;
  const denom = d00 * d11 - d01 * d01;
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  return [1 - v - w, v, w];
};

export class Arap {
  readonly vertexCount: number;
  readonly edgeCount: number;
  /** Indices (into the pin array given at construction) of pins that lie outside the mesh and are ignored by `solve`. */
  readonly droppedPins: number[] = [];

  private readonly vertices: Float64Array;
  private readonly edges: Array<[number, number]> = [];
  private readonly edgeVectors: Float64Array;
  /** Per edge: the vertices {vi, vj, shared neighbours...} and the 2 x 2n block g of G (rotation read-back), row-major. */
  private readonly edgeNbr: number[][] = [];
  private readonly edgeG: Float64Array[] = [];
  private readonly pins: Bary[] = [];
  private readonly pinMask: boolean[] = [];
  private readonly factor1: DenseCholesky;
  private readonly factor2: DenseCholesky;
  private readonly w: number;

  constructor(mesh: Mesh, pinsRest: Float32Array, w = 1000) {
    this.w = w;
    const V = mesh.vertices.length / 2;
    const T = mesh.triangles.length / 3;
    this.vertexCount = V;
    this.vertices = Float64Array.from(mesh.vertices);
    const tri = mesh.triangles;
    const vx = (i: number) => this.vertices[2 * i]!;
    const vy = (i: number) => this.vertices[2 * i + 1]!;

    // deduplicated edges and the vertex neighbour sets
    const seen = new Set<number>();
    const nbr: Array<Set<number>> = Array.from({length: V}, () => new Set<number>());
    for (let t = 0; t < T; t++) {
      const a = tri[3 * t]!, b = tri[3 * t + 1]!, c = tri[3 * t + 2]!;
      for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
        const lo = Math.min(p, q), hi = Math.max(p, q);
        const key = lo * V + hi;
        if (!seen.has(key)) {
          seen.add(key);
          this.edges.push([lo, hi]);
        }
        nbr[p]!.add(q);
        nbr[q]!.add(p);
      }
    }
    this.edges.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const E = this.edges.length;
    this.edgeCount = E;
    this.edgeVectors = new Float64Array(2 * E);
    this.edges.forEach(([i, j], k) => {
      this.edgeVectors[2 * k] = vx(j) - vx(i);
      this.edgeVectors[2 * k + 1] = vy(j) - vy(i);
    });

    // pins -> barycentric coordinates; the pin mask records which pins were inside the mesh
    const pinCount = pinsRest.length / 2;
    for (let p = 0; p < pinCount; p++) {
      const bary = this.locatePin(pinsRest[2 * p]!, pinsRest[2 * p + 1]!, tri);
      this.pinMask.push(bary !== null);
      if (bary) this.pins.push(bary);
      else this.droppedPins.push(p);
    }

    // normal matrices A1'A1 (2V x 2V) and A2'A2 (V x V), accumulated from the sparse rows of A1 and A2
    const N = 2 * V;
    const ata1 = new Float64Array(N * N);
    const ata2 = new Float64Array(V * V);
    const addRow = (m: Float64Array, size: number, cols: number[], vals: number[]) => {
      for (let a = 0; a < cols.length; a++) {
        const row = cols[a]! * size;
        const va = vals[a]!;
        for (let b = 0; b < cols.length; b++) m[row + cols[b]!]! += va * vals[b]!;
      }
    };
    this.edges.forEach(([vi, vj], k) => {
      const nb = [vi, vj, ...[...nbr[vi]!].filter((v) => nbr[vj]!.has(v)).sort((p, q) => p - q)];
      this.edgeNbr.push(nb);
      const n = nb.length;
      // G_k: rows (vx, vy), (vy, -vx) for every neighbour relative to vi; G_k* = (G'G)^-1 G'
      const m = n - 1;
      const g = new Float64Array(2 * m * 2);
      for (let r = 1; r < n; r++) {
        const dx = vx(nb[r]!) - vx(vi), dy = vy(nb[r]!) - vy(vi);
        g[2 * (r - 1) * 2] = dx; g[2 * (r - 1) * 2 + 1] = dy;
        g[(2 * (r - 1) + 1) * 2] = dy; g[(2 * (r - 1) + 1) * 2 + 1] = -dx;
      }
      let s00 = 0, s01 = 0, s11 = 0;
      for (let r = 0; r < 2 * m; r++) { s00 += g[2 * r]! * g[2 * r]!; s01 += g[2 * r]! * g[2 * r + 1]!; s11 += g[2 * r + 1]! * g[2 * r + 1]!; }
      const det = s00 * s11 - s01 * s01;
      const i00 = s11 / det, i01 = -s01 / det, i11 = s00 / det;
      const star = new Float64Array(2 * 2 * m); // 2 x 2m
      for (let c = 0; c < 2 * m; c++) {
        star[c] = i00 * g[2 * c]! + i01 * g[2 * c + 1]!;
        star[2 * m + c] = i01 * g[2 * c]! + i11 * g[2 * c + 1]!;
      }
      // g_full = G* @ edge_matrix, edge_matrix = [tile(-I, m) | I_2m]  ->  2 x 2n, block 0 is the vi column, block 1+j is neighbour j
      const gFull = new Float64Array(2 * 2 * n);
      for (let row = 0; row < 2; row++) {
        for (let j = 0; j < m; j++) {
          for (let comp = 0; comp < 2; comp++) {
            const v = star[row * 2 * m + 2 * j + comp]!;
            gFull[row * 2 * n + 2 * (1 + j) + comp] = v;
            gFull[row * 2 * n + comp]! -= v;
          }
        }
      }
      this.edgeG.push(gFull);
      // h = e @ g_full with e = [[ex, ey], [ey, -ex]]; A1 rows = (-I at vi, +I at vj) - h
      const ex = this.edgeVectors[2 * k]!, ey = this.edgeVectors[2 * k + 1]!;
      const rows: number[][] = [new Array<number>(2 * n).fill(0), new Array<number>(2 * n).fill(0)];
      for (let c = 0; c < 2 * n; c++) {
        rows[0]![c] = -(ex * gFull[c]! + ey * gFull[2 * n + c]!);
        rows[1]![c] = -(ey * gFull[c]! - ex * gFull[2 * n + c]!);
      }
      rows[0]![0]! -= 1; rows[1]![1]! -= 1; // -I at vi
      rows[0]![2]! += 1; rows[1]![3]! += 1; // +I at vj
      const cols: number[] = [];
      for (const v of nb) cols.push(2 * v, 2 * v + 1);
      addRow(ata1, N, cols, rows[0]!);
      addRow(ata1, N, cols, rows[1]!);
      addRow(ata2, V, [vi, vj], [-1, 1]);
    });
    for (const pin of this.pins) {
      const wv = pin.weights.map((x) => this.w * x);
      addRow(ata1, N, pin.verts.map((v) => 2 * v), wv);
      addRow(ata1, N, pin.verts.map((v) => 2 * v + 1), wv);
      addRow(ata2, V, pin.verts, wv);
    }
    this.factor1 = new DenseCholesky(N, ata1);
    this.factor2 = new DenseCholesky(V, ata2);
  }

  /**
   * New vertex positions for new pin positions, interleaved [x0, y0, x1, y1, ...]. Pins are in the order given at construction.
   */
  solve(pinsNow: Float32Array): Float32Array {
    const {w, vertexCount: V, edgeCount: E} = this;
    if (pinsNow.length !== this.pinMask.length * 2) throw new Error(`Arap.solve: expected ${this.pinMask.length} pins, got ${pinsNow.length / 2}`);
    const live: Array<[number, number]> = [];
    this.pinMask.forEach((inside, p) => { if (inside) live.push([pinsNow[2 * p]!, pinsNow[2 * p + 1]!]); });

    // pass 1: rotation and scale free. b1 is zero on the edge rows, so A1'b1 only sees the pin rows
    const atb1 = new Float64Array(2 * V);
    this.pins.forEach((pin, q) => {
      const [px, py] = live[q]!;
      for (let a = 0; a < 3; a++) {
        const wv = w * pin.weights[a]!;
        atb1[2 * pin.verts[a]!]! += wv * w * px;
        atb1[2 * pin.verts[a]! + 1]! += wv * w * py;
      }
    });
    const v1 = this.factor1.solve(atb1);

    // read each edge's rotation back from v1 (T1 = G v1), normalise it to a pure rotation, rotate the rest edge
    const atb2x = new Float64Array(V);
    const atb2y = new Float64Array(V);
    for (let k = 0; k < E; k++) {
      const nb = this.edgeNbr[k]!, g = this.edgeG[k]!, n = nb.length;
      let c = 0, s = 0;
      for (let a = 0; a < n; a++) {
        const px = v1[2 * nb[a]!]!, py = v1[2 * nb[a]! + 1]!;
        c += g[2 * a]! * px + g[2 * a + 1]! * py;
        s += g[2 * n + 2 * a]! * px + g[2 * n + 2 * a + 1]! * py;
      }
      const scale = 1 / Math.sqrt(c * c + s * s);
      c *= scale; s *= scale;
      const e0x = this.edgeVectors[2 * k]!, e0y = this.edgeVectors[2 * k + 1]!;
      const e1x = c * e0x + s * e0y, e1y = -s * e0x + c * e0y; // T2 = [[c, s], [-s, c]]
      const [i, j] = this.edges[k]!;
      atb2x[i]! -= e1x; atb2x[j]! += e1x;
      atb2y[i]! -= e1y; atb2y[j]! += e1y;
    }
    // pass 2: scale only. The pin rows of b2 are w * pin
    this.pins.forEach((pin, q) => {
      const [px, py] = live[q]!;
      for (let a = 0; a < 3; a++) {
        const wv = w * pin.weights[a]!;
        atb2x[pin.verts[a]!]! += wv * w * px;
        atb2y[pin.verts[a]!]! += wv * w * py;
      }
    });
    const v2x = this.factor2.solve(atb2x);
    const v2y = this.factor2.solve(atb2y);
    const out = new Float32Array(2 * V);
    for (let i = 0; i < V; i++) { out[2 * i] = v2x[i]!; out[2 * i + 1] = v2y[i]!; }
    return out;
  }

  /** Where each pin sits in `vertices` (its barycentric combination), in pin order; NaN for a dropped pin. Used to measure pin error. */
  pinPositions(vertices: Float32Array): Float32Array {
    const out = new Float32Array(this.pinMask.length * 2).fill(NaN);
    let q = 0;
    this.pinMask.forEach((inside, p) => {
      if (!inside) return;
      const pin = this.pins[q++]!;
      let x = 0, y = 0;
      for (let a = 0; a < 3; a++) { x += pin.weights[a]! * vertices[2 * pin.verts[a]!]!; y += pin.weights[a]! * vertices[2 * pin.verts[a]! + 1]!; }
      out[2 * p] = x; out[2 * p + 1] = y;
    });
    return out;
  }

  /** The containing triangle of a point (strictly inside first, then on an edge, as the reference), as barycentric weights, or null. */
  private locatePin(px: number, py: number, tri: Uint32Array): Bary | null {
    const det = (ux: number, uy: number, vx: number, vy: number) => ux * vy - uy * vx;
    let onEdge = -1;
    for (let t = 0; t < tri.length / 3; t++) {
      const ia = tri[3 * t]!, ib = tri[3 * t + 1]!, ic = tri[3 * t + 2]!;
      const ax = this.vertices[2 * ia]!, ay = this.vertices[2 * ia + 1]!;
      const v1x = this.vertices[2 * ib]! - ax, v1y = this.vertices[2 * ib + 1]! - ay;
      const v2x = this.vertices[2 * ic]! - ax, v2y = this.vertices[2 * ic + 1]! - ay;
      const d = det(v1x, v1y, v2x, v2y);
      const a = (det(px, py, v2x, v2y) - det(ax, ay, v2x, v2y)) / d;
      const b = -(det(px, py, v1x, v1y) - det(ax, ay, v1x, v1y)) / d;
      if (a > 0 && b > 0 && a + b < 1) return this.baryOf(px, py, ia, ib, ic);
      if (onEdge < 0 && a >= 0 && b >= 0 && a + b <= 1) onEdge = t;
    }
    return onEdge < 0 ? null : this.baryOf(px, py, tri[3 * onEdge]!, tri[3 * onEdge + 1]!, tri[3 * onEdge + 2]!);
  }

  private baryOf(px: number, py: number, ia: number, ib: number, ic: number): Bary {
    const v = this.vertices;
    const weights = barycentric(px, py, v[2 * ia]!, v[2 * ia + 1]!, v[2 * ib]!, v[2 * ib + 1]!, v[2 * ic]!, v[2 * ic + 1]!);
    return {verts: [ia, ib, ic], weights};
  }
}

import type {Blocking} from '../animation/blocking';

/**
 * The crayon world's architecture as scribbled strokes (D78): the arch as hatch bands that follow it, each gate as a curled waxy stalk that
 * ends in a spiral, the floor as a ground line with a band of short ticks under it. Everything is a polyline, so the SVG filter that
 * wobbles the world draws it like the rest. `layout` fixes where strokes fall (one scribble, drawn once); `variant` only jitters them, which is
 * the boil: the same strokes re-laid by hand, not a new picture.
 */
export type Palette = {blue: string; sky: string; red: string; yellow: string};
export type Stroke = {d: string; colour: keyof Palette | 'ink'; width: number; opacity: number};
type Pt = [number, number];

const rng = (seed: number): (() => number) => {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const between = (r: () => number, lo: number, hi: number): number => lo + (hi - lo) * r();

const path = (pts: Pt[]): string => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');

/** The arch's centreline at arc length `s` (left pier up, over the top, right pier down) with its outward unit normal. */
const archCentre = (a: Blocking['arch']) => {
  const cx = a.x + a.width / 2;
  const innerHalf = (a.width * a.opening) / 2;
  const mid = (a.width / 2 + innerHalf) / 2;
  const cy = (a.y + a.width / 2 + (a.y + a.top + innerHalf)) / 2;
  const bottom = a.y + a.height;
  const pier = bottom - cy;
  const length = 2 * pier + Math.PI * mid;
  const at = (s: number): {p: Pt; n: Pt} => {
    if (s < pier) return {p: [cx - mid, bottom - s], n: [-1, 0]};
    if (s > pier + Math.PI * mid) return {p: [cx + mid, cy + (s - pier - Math.PI * mid)], n: [1, 0]};
    const th = Math.PI - (s - pier) / mid;
    return {p: [cx + mid * Math.cos(th), cy - mid * Math.sin(th)], n: [Math.cos(th), -Math.sin(th)]};
  };
  return {at, length, thickness: a.width / 2 - innerHalf};
};

const ARCH_ROWS: (keyof Palette)[] = ['blue', 'blue', 'blue', 'sky', 'blue', 'red', 'red', 'red', 'yellow', 'yellow', 'blue', 'sky', 'blue'];

export const archStrokes = (layout: number, variant: number, lw: number, arch: Blocking['arch']): Stroke[] => {
  const c = archCentre(arch);
  const out: Stroke[] = [];
  const pitch = c.thickness / ARCH_ROWS.length;
  ARCH_ROWS.forEach((colour, row) => {
    const base = rng(layout * 131 + row * 17);
    const jitter = rng(variant * 977 + row * 31 + 5);
    const offset = c.thickness / 2 - (row + 0.5) * pitch;
    let s = between(base, 0, 40);
    while (s < c.length) {
      const len = between(base, 50, 120);
      const end = Math.min(c.length, s + len);
      const pts: Pt[] = [];
      for (let u = s; u <= end; u += 14) {
        const {p, n} = c.at(u);
        const o = offset + (jitter() - 0.5) * 3;
        pts.push([p[0] + n[0] * o + (jitter() - 0.5) * 1.6, p[1] + n[1] * o + (jitter() - 0.5) * 1.6]);
      }
      if (pts.length > 1) out.push({d: path(pts), colour, width: pitch * between(base, 0.9, 1.35), opacity: between(base, 0.78, 0.96)});
      s = end + between(base, 3, 16);
    }
  });
  // the dark wax edges, drawn once on each side
  [-1, 1].forEach((side, k) => {
    const jitter = rng(variant * 313 + k * 7 + 2);
    const pts: Pt[] = [];
    for (let u = 0; u <= c.length; u += 12) {
      const {p, n} = c.at(u);
      const o = side * (c.thickness / 2 + 1) + (jitter() - 0.5) * 2.4;
      pts.push([p[0] + n[0] * o, p[1] + n[1] * o]);
    }
    out.push({d: path(pts), colour: 'ink', width: lw * 0.9, opacity: 0.9});
  });
  return out;
};

/**
 * The centreline of a gate's stalk from its foot `base`: an S-curve up (21 points) and then the spiral (56 points), `side` +1 or -1 the way it leans. The stalk prop (`props/Scaffold.tsx`) draws the same line in three
 * strokes, so the strokes the human draws and the stalk they become are one shape.
 */
export const stalkCentre = (base: Pt, r: number, side: 1 | -1): Pt[] => {
  const height = r * 5.2;
  const centre: Pt[] = [];
  for (let u = 0; u <= 1.0001; u += 0.05) centre.push([base[0] + side * Math.sin(u * Math.PI * 1.25 + 0.4) * r * 0.8 * u, base[1] - u * height]);
  const top = centre[centre.length - 1]!;
  const turns = 3.2 * Math.PI, r0 = r * 0.95;
  const sx = top[0] + side * r0, sy = top[1];
  for (let t = 0.15; t <= turns; t += 0.18) {
    const rho = r0 * (1 - t / (turns * 1.08));
    centre.push([sx - side * rho * Math.cos(t), sy - rho * Math.sin(t)]);
  }
  return centre;
};

/** A waxy stalk from each gate's foot: an S-curve up, then a spiral. Three passes (blue, sky, yellow) at offsets so the wax shows its layers. */
export const gateStrokes = (variant: number, lw: number, gates: Blocking['gates']): Stroke[] => {
  const out: Stroke[] = [];
  gates.forEach((g, i) => {
    const jitter = rng(variant * 61 + i * 11 + 3);
    const base: Pt = [g.x, g.y + g.r];
    const side = i % 2 === 0 ? 1 : -1;
    const centre = stalkCentre(base, g.r, side);
    const width = g.r * 0.3;
    [
      {colour: 'blue' as const, dx: 0, w: width, opacity: 0.95},
      {colour: 'sky' as const, dx: width * 0.28, w: width * 0.5, opacity: 0.85},
      {colour: 'yellow' as const, dx: -width * 0.34, w: width * 0.38, opacity: 0.9},
    ].forEach((pass) => {
      const pts = centre.map(([x, y]) => [x + pass.dx + (jitter() - 0.5) * 1.4, y + (jitter() - 0.5) * 1.4] as Pt);
      out.push({d: path(pts), colour: pass.colour, width: pass.w, opacity: pass.opacity});
    });
    out.push({d: path(centre.map(([x, y]) => [x + width * 0.62 * side + (jitter() - 0.5), y] as Pt)), colour: 'ink', width: lw * 0.55, opacity: 0.6});
  });
  return out;
};

const FLOOR_TICKS: (keyof Palette)[] = ['yellow', 'yellow', 'red', 'blue', 'sky', 'yellow'];

/** The ground: a wobbling dark line at the horizon and a band of short ticks under it, sparser with depth below the line. */
export const floorStrokes = (layout: number, variant: number, angle: number, lw: number, floorY: number): Stroke[] => {
  const base = rng(layout * 7 + 1);
  const jitter = rng(variant * 53 + 9);
  const out: Stroke[] = [];
  const y0 = floorY;
  for (let x = -10; x < 1290; ) {
    const len = between(base, 70, 160);
    const pts: Pt[] = [];
    for (let u = x; u <= x + len; u += 16) pts.push([u, y0 + (jitter() - 0.5) * 2.6]);
    out.push({d: path(pts), colour: 'ink', width: lw * 1.15, opacity: 0.92});
    x += len + between(base, 1, 6);
  }
  const t = (angle * Math.PI) / 180;
  for (let k = 0; k < 340; k++) {
    const x = between(base, 0, 1280);
    const depth = Math.pow(base(), 1.7);
    const y = y0 + 8 + depth * (720 - y0 - 8);
    const len = between(base, 14, 34) * (1 + depth * 0.6);
    const colour = FLOOR_TICKS[Math.floor(base() * FLOOR_TICKS.length)]!;
    const bend = (jitter() - 0.5) * 5;
    out.push({
      d: `M${x.toFixed(1)} ${y.toFixed(1)}Q${(x + (Math.cos(t) * len) / 2 + bend).toFixed(1)} ${(y + (Math.sin(t) * len) / 2).toFixed(1)} ${(x + Math.cos(t) * len).toFixed(1)} ${(y + Math.sin(t) * len).toFixed(1)}`,
      colour,
      width: between(base, 3.5, 6.5),
      opacity: 0.88 * (1 - depth * 0.55),
    });
  }
  return out;
};

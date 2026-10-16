import {useEffect, useRef} from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {onTwos} from './motion';

export type Emitter = {x: number; y: number; radius: number; color: string; intensity: number};
export type Mask = {x: number; y: number; width: number; height: number};

/** Deterministic PRNG (mulberry32); the only randomness source allowed in the film. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Hue bands from core outward, like the cloaked figures' iridescent fill; the last band fades to transparent. */
export type Bands = string[];
type Props = {emitter: Emitter; bands?: Bands; depthRings?: number; motes?: number; grain?: number; mask?: Mask; seed?: number};

/**
 * Additive light layer drawn over the flat assets (creative-spec v4 §Medium).
 * One emitter per shot; `mask` confines the light to a rectangle (the frame's interior in beat 4).
 * Everything is seeded by frame number so a frame renders identically on every run.
 */
export const Radiance: React.FC<Props> = ({emitter, bands, depthRings = 0, motes = 40, grain = 0.06, mask, seed = 1}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const {x, y, radius, color, intensity} = emitter;
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    const stops = bands && bands.length > 0 ? bands : [color];
    stops.forEach((c, i) => g.addColorStop((i / stops.length) * 0.9, c));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = intensity;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
    // depth rings: concentric soft ellipses receding into the emitter, seeded slow rotation; reads as space behind the frame
    if (depthRings > 0) {
      for (let r = 1; r <= depthRings; r++) {
        const k = r / depthRings;
        const rr = radius * (0.15 + 0.85 * k);
        ctx.globalAlpha = intensity * 0.12 * (1 - k);
        ctx.strokeStyle = stops[Math.min(stops.length - 1, Math.floor(k * stops.length))] ?? color;
        ctx.lineWidth = 2 + 6 * (1 - k);
        ctx.beginPath();
        ctx.ellipse(x, y, rr, rr * 0.72, Math.sin(frame / 90 + r) * 0.15, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // motes: slow drift keyed to frame, position seeded per mote
    const rnd = seeded(seed * 7919);
    for (let i = 0; i < motes; i++) {
      const mx = rnd() * width;
      const my = rnd() * height;
      const phase = rnd() * Math.PI * 2;
      const drift = Math.sin(frame / 40 + phase);
      ctx.globalAlpha = intensity * (0.25 + 0.5 * (0.5 + 0.5 * Math.sin(frame / 12 + phase)));
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(mx + drift * 6, my - (frame % 400) * 0.08 * rnd(), 1.2 + rnd() * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // grain: speckle seeded on twos (C13: grain held for two frames reads as drawn texture, per-frame reseeding reads as shimmer), additive, very low alpha
    const grainRnd = seeded(seed * 104729 + onTwos(frame));
    ctx.globalAlpha = grain;
    ctx.fillStyle = '#ffffff';
    const cells = 900;
    for (let i = 0; i < cells; i++) {
      ctx.fillRect(grainRnd() * width, grainRnd() * height, 1, 1);
    }
    ctx.restore();
    if (mask) {
      // feathered mask (law 4/5: light never toggles in time or in space): keep alpha inside, fade over `feather` px, erase outside
      const feather = Math.max(24, Math.min(mask.width, mask.height) * 0.35);
      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';
      const cx = mask.x + mask.width / 2;
      const cy = mask.y + mask.height / 2;
      const rx = mask.width / 2 + feather;
      const ry = mask.height / 2 + feather;
      ctx.translate(cx, cy);
      ctx.scale(1, ry / rx);
      const mg = ctx.createRadialGradient(0, 0, Math.max(1, rx - feather * 2), 0, 0, rx);
      mg.addColorStop(0, 'rgba(0,0,0,1)');
      mg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = mg;
      ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
      ctx.restore();
    }
  }, [frame, width, height, emitter, bands, depthRings, motes, grain, mask, seed]);
  return <canvas ref={ref} width={width} height={height} style={{position: 'absolute', inset: 0, pointerEvents: 'none'}} />;
};

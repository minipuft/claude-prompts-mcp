import {useEffect, useRef, useState} from 'react';
import {AbsoluteFill, cancelRender, continueRender, delayRender} from 'remotion';
import type {Blocking} from '../animation/blocking';
import {boil, onTwos} from '../motion';
import {fromHsl, hueOfHex} from '../animation/light';
import type {Emitter} from '../Radiance';
import {STAGE, clamp01, contourPx, joinEmitter, lineColour, partsOf} from './contract';
import {contracts} from './contracts';
import {archStrokes, floorStrokes, gateStrokes, type Palette, type Stroke} from './crayonStrokes';
import {FlatFigure, JoinGlow, PropsStack, Stage, reducedLine, type PropsLook} from './parts';
import type {PropsPart, SceneProps, WorldContract} from './types';

/**
 * The crayon world (art world, D78): the flat render of every layer passed through ONE crayon-stroke filter. The filter draws (1) a dark
 * contour by growing the silhouette's alpha by the contract's contour width, and (2) a waxy wobble by displacing the result with low-frequency
 * noise. The noise seed follows the boil, so the wobble redraws at the contract's rate. Fills are the flat roles, the figure its own drawing:
 * nothing is shaded.
 *
 * The wax is DIRECTIONAL (contract `stroke.angle`): two noise images made in a frame rotated by that angle (low frequency along the stroke, high across it) work on the fills: a
 * hatch knocks ink out in sparse streaks, and a tone lightens and darkens the wax along them. The
 * human sits in the blocking's `figureCrop` and takes `stroke.figureStrength` of it (the plate keeps the human cleaner than the world); everywhere
 * else the world's full strength applies. The arch, the gates and the floor are scribbled strokes (crayonStrokes.ts) drawn under the props.
 *
 * The light (contract `light`, row 4.2b) is a lit patch around the emitter and not a glow: the glow the other worlds draw is additive and reads here as a darker halo on bright paper, so no luminance
 * peak sat on the emitter (C29). Inside the emitter's radius the paper lightens (white over the paper, so its tooth recedes), the hatch knocks more ink out (fewer strokes), and the scribbled stage strokes
 * lighten and warm toward the radiance hue; props and figures only thin, they keep their pigments. Outside the radius not one pixel changes. With `lift` 0 the patch is not drawn and the glow is.
 */
const FILTER_ID = 'world-crayon';
const WOBBLE_ID = 'world-crayon-wobble';
const LIT_STAGE_ID = 'world-crayon-wobble-lit';
const W = 1280;
const H = 720;

/** Noise level below which ink is knocked out: tooth 0 knocks out little, a higher tooth more; the ramp is soft (pressure, not a cut-out). */
const knockAt = (tooth: number, strength: number): number => 0.15 + 0.75 * tooth * strength;

/** The lit patch around an emitter, in stage pixels: `lift` and `warmth` already scaled by the emitter's intensity and the scene's strength. */
export type Patch = {cx: number; cy: number; r: number; lift: number; warmth: number; falloff: number; paper: string; warmColour: string};

/** The patch the contract asks of this emitter, or null: no `light` in the contract, a lift of 0, or an emitter that is not drawn (intensity 0, a crossing at full reduction). */
export const patchOf = (c: WorldContract, emitter: Emitter, strength: number): Patch | null => {
  const light = c.light;
  if (!light) return null;
  const k = clamp01(emitter.intensity) * clamp01(strength);
  const lift = clamp01(light.lift) * k;
  if (lift <= 0) return null;
  return {cx: emitter.x, cy: emitter.y, r: emitter.radius, lift, warmth: clamp01(light.warmth) * k, falloff: light.falloff, paper: fromHsl(hueOfHex(emitter.color), light.paper.saturation, light.paper.lightness), warmColour: c.radiance.colour ?? emitter.color};
};

/** The profile every term of the patch follows: 1 at the emitter, 0 at the radius, as `n + 1` samples of `(1 - t) ** falloff`. */
const profile = (falloff: number, n = 16): [number, number][] => Array.from({length: n + 1}, (_, i) => [i / n, (1 - i / n) ** falloff]);

/** The noise level (ink below it is knocked out) at the emitter at full lift; the hatch is 0.15 to 0.3 elsewhere. The level rises from the world's own to this as `lift` does, so strokes thin toward the light. */
const KNOCK_AT_LIGHT = 0.45;
/** The share of the paper's lift the scribbled strokes take toward the lit paper's colour. */
const STROKE_PALE = 0.5;

/** Filter primitives: SourceGraphic toned by the tone image when there is one (soft-light, kept inside its own alpha), then knocked out by the hatch; result `fills`. */
const WaxFills: React.FC<{images: CrayonImages}> = ({images}) => (
  <>
    {images.tone && <feImage href={bitmapOf(images.tone)} x="0" y="0" width={W} height={H} preserveAspectRatio="none" result="tone" />}
    {images.tone && <feBlend in="tone" in2="SourceGraphic" mode="soft-light" result="toned" />}
    {images.tone && <feComposite in="toned" in2="SourceGraphic" operator="in" result="tonedIn" />}
    <feImage href={bitmapOf(images.hatch)} x="0" y="0" width={W} height={H} preserveAspectRatio="none" result="hatch" />
    <feComposite in={images.tone ? 'tonedIn' : 'SourceGraphic'} in2="hatch" operator="in" result="fills" />
  </>
);

/** A feColorMatrix values string: `share` of the way from each stroke's colour to its own luma in `hex`'s hue and saturation (a luma-keeping colour blend: each channel is the luma times the hex's channel over the hex's luma). */
const warmMatrix = (hex: string, share: number): string => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const weights = [0.2126, 0.7152, 0.0722];
  const row = (c: number, k: number): string => weights.map((w, i) => ((1 - share) * (i === k ? 1 : 0) + (share * w * c) / luma).toFixed(4)).join(' ') + ' 0 0';
  return `${row(r, 0)}  ${row(g, 1)}  ${row(b, 2)}  0 0 0 1 0`;
};

/** The scribbled strokes as they look inside the patch, at the emitter: lifted toward the lit paper, then their hue pulled toward the radiance colour at the strokes' own luminance. Reads `fills`, result `strokes`. */
const StrokeLight: React.FC<{patch: Patch}> = ({patch}) => {
  const pale = STROKE_PALE * patch.lift;
  return (
    <>
      <feFlood floodColor={patch.paper} result="pale" />
      <feComposite in="pale" in2="fills" operator="in" result="paleIn" />
      <feComposite in="fills" in2="paleIn" operator="arithmetic" k1={0} k2={1 - pale} k3={pale} k4={0} result="paled" />
      <feColorMatrix in="paled" type="matrix" values={warmMatrix(patch.warmColour, patch.warmth)} result="strokes" />
    </>
  );
};

const CrayonFilter: React.FC<{id: string; contract: WorldContract; seed: number; strength: number; images: CrayonImages | undefined; stageImages: CrayonImages | undefined; patch: Patch | null; blocking: Blocking}> = ({id, contract, seed, strength, images, stageImages, patch, blocking}) => {
  const lw = contourPx(contract, blocking);
  return (
    <svg width="0" height="0" style={{position: 'absolute'}}>
      <defs>
        <filter id={id} x="-2%" y="-2%" width="104%" height="104%" colorInterpolationFilters="sRGB">
          {/* contour: the silhouette grown by the contour width, in the line ink, drawn behind the flat fills */}
          <feMorphology in="SourceAlpha" operator="dilate" radius={Math.max(0.5, lw * strength)} result="grown" />
          <feFlood floodColor={lineColour(contract)} result="ink" />
          <feComposite in="ink" in2="grown" operator="in" result="halo" />
          {/* only the ring outside the silhouette: where the hatch knocks a fill out, paper shows, not ink */}
          <feComposite in="halo" in2="SourceAlpha" operator="out" result="contour" />
          {/* the wax: tone streaks lighten and darken the fills, then the hatch knocks ink out of them; the contour stays solid (D76 weight) */}
          {images && <WaxFills images={images} />}
          <feMerge result="drawn">
            <feMergeNode in="contour" />
            <feMergeNode in={images ? 'fills' : 'SourceGraphic'} />
          </feMerge>
          {/* waxy wobble: low-frequency displacement, reseeded per boil variant */}
          <feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="1" seed={seed} result="wobble" />
          <feDisplacementMap in="drawn" in2="wobble" scale={lw * 1.6 * strength} xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id={WOBBLE_ID} x="-2%" y="-2%" width="104%" height="104%" colorInterpolationFilters="sRGB">
          {stageImages && <WaxFills images={stageImages} />}
          <feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="1" seed={seed + 5} result="wobble" />
          <feDisplacementMap in={stageImages ? 'fills' : 'SourceGraphic'} in2="wobble" scale={lw * 1.2 * strength} xChannelSelector="R" yChannelSelector="G" />
        </filter>
        {/* the same strokes lit: drawn again over the first copy inside the patch, faded in by the patch's profile (a longer chain on the one copy rasterised thin strokes differently from one tab to the next) */}
        {stageImages && patch && (
          <filter id={LIT_STAGE_ID} x="-2%" y="-2%" width="104%" height="104%" colorInterpolationFilters="sRGB">
            <WaxFills images={stageImages} />
            <StrokeLight patch={patch} />
            <feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="1" seed={seed + 5} result="wobble" />
            <feDisplacementMap in="strokes" in2="wobble" scale={lw * 1.2 * strength} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        )}
      </defs>
    </svg>
  );
};

type Box = {x: number; y: number; width: number; height: number};

/** The box, in the frame rotated by `angle` about the stage centre, that covers `region` once rotated back (what a noise rect must span). */
const rotatedCover = (angle: number, region: Box): Box => {
  const t = (-angle * Math.PI) / 180, cx = W / 2, cy = H / 2;
  const corners: [number, number][] = [[region.x, region.y], [region.x + region.width, region.y], [region.x, region.y + region.height], [region.x + region.width, region.y + region.height]];
  const rot = corners.map(([x, y]) => [cx + (x - cx) * Math.cos(t) - (y - cy) * Math.sin(t), cy + (x - cx) * Math.sin(t) + (y - cy) * Math.cos(t)] as [number, number]);
  const xs = rot.map((p) => p[0]), ys = rot.map((p) => p[1]);
  return {x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys)};
};

type NoiseLook = {along: number; across: number; octaves: number; seedShift: number; matrix: (level: number) => string; /** Raster scale of the image: the low-frequency tone costs a quarter at half size. */ scale: number};
type NoiseRegion = {box: Box; level: number};

/**
 * A noise image as an SVG data URI: anisotropic fractal noise in the frame rotated by `angle` (low frequency along the stroke, high across it),
 * mapped by `look.matrix` at each region's `level` and left transparent elsewhere. Regions share one noise field (one seed, one rotated frame),
 * so the strokes run on across a region's edge.
 */
const noiseImage = (seed: number, angle: number, look: NoiseLook, regions: NoiseRegion[]): string => {
  const body = regions
    .map(({box}, i) => {
      const r = rotatedCover(angle, box);
      return `<clipPath id="c${i}"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"/></clipPath><g clip-path="url(#c${i})"><g transform="rotate(${angle} ${W / 2} ${H / 2})"><rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.width.toFixed(1)}" height="${r.height.toFixed(1)}" filter="url(#n${i})"/></g></g>`;
    })
    .join('');
  const filters = regions
    .map(({level}, i) => `<filter id="n${i}" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${look.along} ${look.across}" numOctaves="${look.octaves}" seed="${seed + look.seedShift}"/><feColorMatrix type="matrix" values="${look.matrix(level)}"/></filter>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * look.scale}" height="${H * look.scale}" viewBox="0 0 ${W} ${H}"><defs>${filters}</defs>${body}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

/** The hatch: alpha = where the fills' ink stays (soft ramp: pressure, not a cut-out). Level = the noise value below which ink is knocked out. */
const HATCH_LOOK: NoiseLook = {along: 0.045, across: 0.2, octaves: 1, seedShift: 0, scale: 1, matrix: (thr) => `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  4 0 0 0 ${(-4 * thr).toFixed(3)}`};
/** The tone: a grey image around 0.5 (soft-light: no change) whose streaks lighten or darken the wax, as pressure varies along a stroke. Level = its contrast. */
const TONE_LOOK: NoiseLook = {along: 0.03, across: 0.12, octaves: 1, seedShift: 41, scale: 0.5, matrix: (k) => `${k} 0 0 0 ${(0.5 - 0.5 * k).toFixed(3)}  ${k} 0 0 0 ${(0.5 - 0.5 * k).toFixed(3)}  ${k} 0 0 0 ${(0.5 - 0.5 * k).toFixed(3)}  0 0 0 0 1`};
/** The hatch's noise itself, opaque grey: what a `Thinning` reads the level against. */
const RAW_LOOK: NoiseLook = {...HATCH_LOOK, matrix: () => '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0 1'};
const TONE_CONTRAST = 1.9;
const FULL: Box = {x: 0, y: 0, width: W, height: H};

/**
 * The noise images are SVG filters (feTurbulence), and Chromium repaints an SVG image from its filter every time the page asks for it: ~0.3 s a
 * frame here. Every image a frame asks for is rasterised once to a bitmap (a blob URL) before the frame is captured, and the filters read the
 * bitmap, so the same image looks the same whichever tab, order or concurrency renders the frame.
 *
 * Row 4.1: the cache used to hold only the rest strength's images and was filled in an effect, after the first draw, and `baked` is a plain Map,
 * not state. The first crayon frame in each browser tab was therefore drawn from the live SVG and every later frame from the bitmap: 45 000
 * pixels (max 43 levels) differed on whichever frames a tab met first, so two renders of one frame list depended on how the frames were dealt
 * to tabs. Now a draw that lacks a bitmap draws nothing, holds the render open, bakes, and redraws; the handle is released after that draw is
 * committed. Crossings and the blocking's eased figure crop ask for images at other strengths and crops: those are baked on demand too. The map
 * keeps the newest BAKED_LIMIT bitmaps (a tab's memory is bounded; an evicted image is baked again, identically, when asked for).
 */
const baked = new Map<string, string>();
const BAKED_LIMIT = 48;
/** The decoded images behind the bitmaps (see `rasterise`), released with them. */
const kept = new Map<string, HTMLImageElement>();

/** A canvas's bitmap as a blob URL, decoded and held (see `kept`). */
const bitmapOfCanvas = (canvas: HTMLCanvasElement): Promise<string> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('crayon noise: toBlob gave no bitmap'));
      const url = URL.createObjectURL(blob);
      // The filter's feImage fetches the blob URL itself, after this draw is committed, and fires no load event. Loading and decoding it here first puts it in the
      // browser's image cache, so the frame is not captured before the filter has its picture (a late picture was a partly drawn hatch on the first frame of a tab).
      const warm = new Image();
      warm.src = url;
      warm.decode().then(() => (kept.set(url, warm), resolve(url)), reject);
    }, 'image/png');
  });

/** An SVG data URI drawn on a canvas. */
const canvasOf = (uri: string): Promise<HTMLCanvasElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('crayon noise: the SVG image did not load'));
    img.src = uri;
  });

/**
 * A hatch with the knock-out level rising toward a light (`THINNED` + a `Thinning`): the hatch's own bitmap (its alpha, as the filter would read it) outside the light's radius, and inside it the
 * alpha the same noise gives at the level the profile asks for, `4 * (noise - level)` as the hatch's colour matrix writes it. The patch is part of the picture the filter reads, so the filter chain
 * is the world's own with or without a light: a longer chain (a mask image and a mix of two hatches) rasterised the arch's thin strokes differently from one tab to the next.
 */
const THINNED = 'thinned:';
type Thinning = {base: string; raw: string; level: number; light: number; cx: number; cy: number; r: number; falloff: number};
const pixelsOf = new Map<string, ImageData>();
const pixels = async (uri: string): Promise<ImageData> => {
  const hit = pixelsOf.get(uri);
  if (hit) return hit;
  const canvas = await canvasOf(uri);
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
  pixelsOf.set(uri, data);
  for (const [old] of pixelsOf) if (pixelsOf.size > 8 && old !== uri) pixelsOf.delete(old);
  return data;
};

const thin = async (t: Thinning): Promise<string> => {
  const [base, raw] = await Promise.all([pixels(t.base), pixels(t.raw)]);
  const out = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
  const x0 = Math.max(0, Math.floor(t.cx - t.r)), x1 = Math.min(base.width, Math.ceil(t.cx + t.r) + 1);
  const y0 = Math.max(0, Math.floor(t.cy - t.r)), y1 = Math.min(base.height, Math.ceil(t.cy + t.r) + 1);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const d = Math.hypot(x + 0.5 - t.cx, y + 0.5 - t.cy);
      if (d >= t.r) continue;
      const i = (y * base.width + x) * 4;
      const level = t.level + (t.light - t.level) * (1 - d / t.r) ** t.falloff;
      out.data[i + 3] = Math.round(255 * (4 * (raw.data[i]! / 255 - level)));
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = base.width;
  canvas.height = base.height;
  canvas.getContext('2d')!.putImageData(out, 0, 0);
  return bitmapOfCanvas(canvas);
};

const rasterise = (uri: string): Promise<string> => (uri.startsWith(THINNED) ? thin(JSON.parse(uri.slice(THINNED.length)) as Thinning) : canvasOf(uri).then(bitmapOfCanvas));

/** What a filter reads for `uri`: its bitmap. Only reached once every image of the draw is baked (`useBakedNoise` draws nothing before that). */
const bitmapOf = (uri: string): string => {
  const bitmap = baked.get(uri);
  if (bitmap === undefined) throw new Error('crayon noise: an image was read before it was baked');
  return bitmap;
};

/** Remember a bitmap as the newest; past BAKED_LIMIT the oldest is released. The images a draw is about to read are never the oldest: they were touched last. */
const remember = (uri: string, bitmap: string, keep: Set<string>): void => {
  baked.delete(uri);
  baked.set(uri, bitmap);
  for (const [old, url] of baked) {
    if (baked.size <= BAKED_LIMIT) break;
    if (keep.has(old)) continue;
    baked.delete(old);
    kept.delete(url);
    URL.revokeObjectURL(url);
  }
};

/** True when every image in `uris` has its bitmap. A false draw must render nothing: the render stays held until the bake finishes and the scene draws again. */
const useBakedNoise = (uris: string[]): boolean => {
  const missing = uris.filter((u) => !baked.has(u));
  const [, redraw] = useState(0);
  const held = useRef<number | null>(null);
  if (missing.length && held.current === null) held.current = delayRender('crayon noise bitmaps');
  useEffect(() => {
    if (missing.length || held.current === null) return;
    continueRender(held.current);
    held.current = null;
  });
  useEffect(() => {
    if (!missing.length) return;
    const keep = new Set(uris);
    Promise.all(missing.map(async (u) => [u, await rasterise(u)] as const)).then(
      (done) => {
        done.forEach(([u, bitmap]) => remember(u, bitmap, keep));
        redraw((n) => n + 1);
      },
      (e) => cancelRender(e),
    );
  }, [missing.join('\n')]);
  return missing.length === 0;
};

/** `tone` is absent where a filter should leave fills their pigment. */
export type CrayonImages = {hatch: string; tone?: string};

/**
 * The two filters' images. The props (frame, blocks, companions, the human) take the figure's strength of hatch everywhere, and the tone only
 * inside the blocking's `figureCrop`: Codex's and Clawd's fills keep their pigment (C1), the human sits cleaner than the world (plate). The scribbled
 * arch, gates and floor take the world's full hatch and no tone.
 */
export const crayonImages = (seed: number, angle: number, tooth: number, world: number, figure: number, figureCrop: Box, patch: Patch | null = null): {props: CrayonImages; stage: CrayonImages} => {
  const hatchAt = (strength: number): string => {
    const level = knockAt(tooth, strength);
    const hatch = noiseImage(seed, angle, HATCH_LOOK, [{box: FULL, level}]);
    if (!patch) return hatch;
    /** The same noise field with the knock-out level rising toward the light: the strokes the world draws are kept, thinned, so they run on across the patch's edge. */
    return THINNED + JSON.stringify({base: hatch, raw: noiseImage(seed, angle, RAW_LOOK, [{box: FULL, level: 0}]), level, light: level + (KNOCK_AT_LIGHT - level) * patch.lift, cx: patch.cx, cy: patch.cy, r: patch.r, falloff: patch.falloff} satisfies Thinning);
  };
  return {
    props: {hatch: hatchAt(figure), tone: noiseImage(seed, angle, TONE_LOOK, [{box: figureCrop, level: TONE_CONTRAST * figure}])},
    stage: {hatch: hatchAt(world)},
  };
};

/** The CSS gradients end this many pixels inside the patch's radius: a gradient's last, anti-aliased pixel must not land outside it. */
const EDGE_INSET = 1;

/** A CSS mask that is opaque at the emitter and falls off by the profile to nothing at the radius (and stays nothing beyond it). */
const patchMask = (patch: Patch): string =>
  `radial-gradient(circle ${patch.r - EDGE_INSET}px at ${patch.cx}px ${patch.cy}px, ${profile(patch.falloff).map(([t, p]) => `rgba(0,0,0,${p.toFixed(4)}) ${(t * 100).toFixed(2)}%`).join(', ')})`;

/** The paper inside the patch: the lit paper's colour at the emitter's lift, falling off by the profile, laid over the glow's place and under every stroke. Only the patch's own square is painted. */
const LitPaper: React.FC<{patch: Patch}> = ({patch}) => {
  const {cx, cy, lift, falloff, paper} = patch;
  const r = patch.r - EDGE_INSET;
  const [red, green, blue] = [1, 3, 5].map((i) => parseInt(paper.slice(i, i + 2), 16));
  const stops = profile(falloff).map(([t, p]) => `rgba(${red},${green},${blue},${(lift * p).toFixed(4)}) ${(t * 100).toFixed(2)}%`).join(', ');
  return <div style={{position: 'absolute', left: cx - r, top: cy - r, width: 2 * r, height: 2 * r, background: `radial-gradient(circle ${r}px at ${r}px ${r}px, ${stops})`}} />;
};

/** Paper: the field with its own grain at the contract's tooth, under everything. */
const Paper: React.FC<{field: string; tooth: number}> = ({field, tooth}) => (
  <AbsoluteFill style={{background: field}}>
    <svg width="100%" height="100%" style={{position: 'absolute', inset: 0}}>
      <filter id="world-paper" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="3" />
        <feColorMatrix type="matrix" values={`0 0 0 0 0.35  0 0 0 0 0.28  0 0 0 0 0.2  0 0 0 ${tooth * 0.9} 0`} />
      </filter>
      <rect width="100%" height="100%" filter="url(#world-paper)" />
    </svg>
  </AbsoluteFill>
);

const colourOf = (s: Stroke, palette: Palette, ink: string): string => (s.colour === 'ink' ? ink : palette[s.colour]);

/** The arch, the gates and the floor as scribbled wax, behind the props (the floor first, so it passes under the feet). */
const CrayonStage: React.FC<{contract: WorldContract; parts: PropsPart[]; variant: number; patch: Patch | null; blocking: Blocking}> = ({contract, parts, variant, patch, blocking}) => {
  const palette = contract.stroke?.palette;
  if (!palette) return null;
  const lw = contourPx(contract, blocking);
  const ink = lineColour(contract);
  const angle = contract.stroke?.angle ?? 0;
  const strokes: Stroke[] = [
    ...(parts.includes('floor') ? floorStrokes(1, variant, angle, lw, blocking.floor.y) : []),
    ...(parts.includes('arch') ? archStrokes(1, variant, lw, blocking.arch) : []),
    ...(parts.includes('gates') ? gateStrokes(variant, lw, blocking.gates) : []),
  ];
  const copy = (filterId: string, mask?: string) => (
    <svg width={W} height={H} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible', filter: `url(#${filterId})`, ...(mask ? {maskImage: mask, WebkitMaskImage: mask} : {})}} fill="none" strokeLinecap="round" strokeLinejoin="round">
      {strokes.map((s, i) => (
        <path key={i} d={s.d} stroke={colourOf(s, palette, ink)} strokeWidth={s.width} opacity={s.opacity} />
      ))}
    </svg>
  );
  return (
    <>
      {copy(WOBBLE_ID)}
      {patch && copy(LIT_STAGE_ID, patchMask(patch))}
    </>
  );
};

export const CrayonScene: React.FC<SceneProps> = ({frame, pose, emitter, reduce = 0, shift, field, parts: override, blocking = STAGE, actorRoles}) => {
  const c = contracts.crayon;
  const r = clamp01(reduce);
  const lw = contourPx(c, blocking);
  const parts = partsOf('crayon', override);
  const propParts = parts.filter((p) => p === 'companions' || p === 'architecture' || p === 'blocks' || p === 'actors');
  const native: PropsLook = {fill: true, ink: lineColour(c), lw, shading: false};
  const variant = boil(onTwos(frame), c.boil.variants, 11, 30, c.boil.rate);
  const seed = 3 + variant;
  const strength = 1 - r;
  const tooth = c.paper?.tooth ?? 0;
  const stroke = c.stroke;
  const patch = stroke && strength > 0 && c.radiance.on ? patchOf(c, joinEmitter(c, emitter, blocking), strength) : null;
  const images = stroke && strength > 0 ? crayonImages(seed, stroke.angle, tooth, strength, strength * stroke.figureStrength, blocking.figureCrop, patch) : undefined;
  const ready = useBakedNoise(images ? [images.props.hatch, images.props.tone, images.stage.hatch].filter((u): u is string => !!u) : []);
  if (!ready) return null;
  return (
    <>
      <Paper field={field ?? c.field} tooth={tooth * strength} />
      <Stage field="transparent" shift={shift}>
        {patch ? <LitPaper patch={patch} /> : <JoinGlow contract={c} emitter={emitter} opacity={1 - r} blocking={blocking} />}
        {strength > 0 && <CrayonFilter id={FILTER_ID} contract={c} seed={seed} strength={strength} images={images?.props} stageImages={images?.stage} patch={patch} blocking={blocking} />}
        {strength > 0 && <CrayonStage contract={c} parts={parts} variant={variant} patch={patch} blocking={blocking} />}
        <div style={{position: 'absolute', inset: 0, filter: strength > 0 ? `url(#${FILTER_ID})` : undefined}}>
          <PropsStack contract={c} lineWorld={contracts.line} reduce={r} native={native} frame={frame} parts={propParts} blocking={blocking} actorRoles={actorRoles} />
          <FlatFigure pose={pose} fill={1 - r} line={r > 0 ? reducedLine(c, contracts.line, r, blocking) : null} blocking={blocking} />
        </div>
      </Stage>
    </>
  );
};

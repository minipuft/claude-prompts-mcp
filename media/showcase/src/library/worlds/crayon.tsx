import {useEffect, useRef, useState} from 'react';
import {AbsoluteFill, cancelRender, continueRender, delayRender} from 'remotion';
import type {Blocking} from '../animation/blocking';
import {boil, onTwos} from '../motion';
import {STAGE, clamp01, contourPx, lineColour, partsOf} from './contract';
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
 */
const FILTER_ID = 'world-crayon';
const WOBBLE_ID = 'world-crayon-wobble';
const W = 1280;
const H = 720;

/** Noise level below which ink is knocked out: tooth 0 knocks out little, a higher tooth more; the ramp is soft (pressure, not a cut-out). */
const knockAt = (tooth: number, strength: number): number => 0.15 + 0.75 * tooth * strength;

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

const CrayonFilter: React.FC<{id: string; contract: WorldContract; seed: number; strength: number; images: CrayonImages | undefined; stageImages: CrayonImages | undefined; blocking: Blocking}> = ({id, contract, seed, strength, images, stageImages, blocking}) => {
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

const rasterise = (uri: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('crayon noise: toBlob gave no bitmap'));
        const url = URL.createObjectURL(blob);
        // The filter's feImage fetches the blob URL itself, after this draw is committed, and fires no load event. Loading and decoding it here first puts it in the
        // browser's image cache, so the frame is not captured before the filter has its picture (a late picture was a partly drawn hatch on the first frame of a tab).
        const warm = new Image();
        warm.src = url;
        warm.decode().then(() => (kept.set(url, warm), resolve(url)), reject);
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('crayon noise: the SVG image did not load'));
    img.src = uri;
  });

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
export const crayonImages = (seed: number, angle: number, tooth: number, world: number, figure: number, figureCrop: Box): {props: CrayonImages; stage: CrayonImages} => ({
  props: {
    hatch: noiseImage(seed, angle, HATCH_LOOK, [{box: FULL, level: knockAt(tooth, figure)}]),
    tone: noiseImage(seed, angle, TONE_LOOK, [{box: figureCrop, level: TONE_CONTRAST * figure}]),
  },
  stage: {hatch: noiseImage(seed, angle, HATCH_LOOK, [{box: FULL, level: knockAt(tooth, world)}])},
});

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
const CrayonStage: React.FC<{contract: WorldContract; parts: PropsPart[]; variant: number; blocking: Blocking}> = ({contract, parts, variant, blocking}) => {
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
  return (
    <svg width={W} height={H} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible', filter: `url(#${WOBBLE_ID})`}} fill="none" strokeLinecap="round" strokeLinejoin="round">
      {strokes.map((s, i) => (
        <path key={i} d={s.d} stroke={colourOf(s, palette, ink)} strokeWidth={s.width} opacity={s.opacity} />
      ))}
    </svg>
  );
};

export const CrayonScene: React.FC<SceneProps> = ({frame, pose, emitter, reduce = 0, shift, field, parts: override, blocking = STAGE}) => {
  const c = contracts.crayon;
  const r = clamp01(reduce);
  const lw = contourPx(c, blocking);
  const parts = partsOf('crayon', override);
  const propParts = parts.filter((p) => p === 'companions' || p === 'architecture' || p === 'blocks');
  const native: PropsLook = {fill: true, ink: lineColour(c), lw, shading: false};
  const variant = boil(onTwos(frame), c.boil.variants, 11, 30, c.boil.rate);
  const seed = 3 + variant;
  const strength = 1 - r;
  const tooth = c.paper?.tooth ?? 0;
  const stroke = c.stroke;
  const images = stroke && strength > 0 ? crayonImages(seed, stroke.angle, tooth, strength, strength * stroke.figureStrength, blocking.figureCrop) : undefined;
  const ready = useBakedNoise(images ? [images.props.hatch, images.props.tone, images.stage.hatch].filter((u): u is string => !!u) : []);
  if (!ready) return null;
  return (
    <>
      <Paper field={field ?? c.field} tooth={tooth * strength} />
      <Stage field="transparent" shift={shift}>
        <JoinGlow contract={c} emitter={emitter} opacity={1 - r} blocking={blocking} />
        {strength > 0 && <CrayonFilter id={FILTER_ID} contract={c} seed={seed} strength={strength} images={images?.props} stageImages={images?.stage} blocking={blocking} />}
        {strength > 0 && <CrayonStage contract={c} parts={parts} variant={variant} blocking={blocking} />}
        <div style={{position: 'absolute', inset: 0, filter: strength > 0 ? `url(#${FILTER_ID})` : undefined}}>
          <PropsStack contract={c} lineWorld={contracts.line} reduce={r} native={native} frame={frame} parts={propParts} blocking={blocking} />
          <FlatFigure pose={pose} fill={1 - r} line={r > 0 ? reducedLine(c, contracts.line, r, blocking) : null} blocking={blocking} />
        </div>
      </Stage>
    </>
  );
};

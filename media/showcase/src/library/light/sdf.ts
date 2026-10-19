/**
 * The light layer's contract (D98, row 8.6): what the signed-distance light pass reads and how a drawn thing becomes an occluder. Pure, no DOM and no three: `scripts/animation/render-manifest.mjs`
 * loads the pass module that imports this in node, and the shader and its driver (`sdfShaders.ts`, `sdfDraw.ts`) stay out of that bundle.
 *
 * The pipeline, per frame: (1) the `occluders` pass draws every solid thing flat in a code colour (below), the figure and the props through the camera; (2) a jump flood turns that mask into a signed-distance
 * field; (3) the `light-sdf` pass lights each pixel from the emitter through the field (falloff clamped at a floor, a soft shadow marched toward the emitter, one bounce off the lit edges) and quantises the result by a
 * fixed blue-noise threshold into dots. Output is dots or nothing, so the layer is two-peaked by construction and never a ramp (D48), and it is screen-blended over the picture the way the lamp's core is.
 */
import {materialOf, type MaterialId, type ShadowClass} from '../animation/materials';

export const SDF_SIZE = {width: 1280, height: 720} as const;

/** The shadow class as the code the mask carries in its green channel (code / 3). 0 casts no shadow. */
export const CLASS_CODE: Record<ShadowClass, 0 | 1 | 2 | 3> = {none: 0, 'stipple-1': 1, 'stipple-2': 2, 'stipple-3': 3};

/**
 * First values (the material contract names the classes, not these numbers; they are filed as a proposal to be graded on the beat-4 frames).
 * `shadowK` is `k` of the penumbra `min(k * h / t)`: small is soft, large is hard. `stipplePx` is the dot size of the shadow's own edge band, the weighted edge of D47: the finer class draws finer dots.
 */
export const SDF = {
  shadowK: {1: 4, 2: 12, 3: 48} as Record<number, number>,
  stipplePx: {1: 1, 2: 2, 3: 3} as Record<number, number>,
  /** A pixel within this many px of an occluder is left alone: the anti-aliased rim of a fixed fill never takes a dot. */
  guardPx: 1.5,
  /** A solid this close to the emitter is the emitter's own seat and does not shadow it. In stage px, times the camera's zoom. */
  emitterSeatPx: 24,
  /** The solid the emitter sits in (the box whose lid the seam is in, the gadget whose dial is the lamp) lets its light out: that solid casts no shadow on the ray within this many px of the emitter, and does beyond it. */
  ownerSeatPx: 140,
  /** The gadget IS the lamp (the dial is on its body): its whole body lets the dial's light out, so no distance limits it. */
  lampSeatPx: 4000,
  /** The volume: density 1/(1+(d/r0)^2) with r0 = r0Px * (r0Base + r0Gain * intensity), clamped at `floor` inside the reach and cut to 0 at reach = reachBase + reachGain * intensity (stage px, times zoom). */
  r0: {base: 110, gain: 140},
  reach: {base: 380, gain: 320},
  /** The least density a lit pixel inside the reach draws: the clamp of the falloff. The light script declares the emitter's luma floor (compile-light --floor, 200), which is what the dots are drawn at; it declares no density floor, so this is the first value. */
  floor: 0.08,
  /** The field returns this share of the emitter's own level (colour x intensity, luma 200 at the light script's floor). At 1 the dense dots next to the lamp blur brighter (200) than its thin core (about 190 over the probe's 8 px box), and a shadow cutting the disc moves the brightest region off the emitter (measured on s01: frames 132-162, 0.2 % without the layer, 4.7-5.0 % with); at 0.6 the lamp owns most of the brightest pixels (0.45 measured worse: 40 of 69 frames within 3 % against 46), as C29 asks. */
  dotGain: 0.6,
  /** One bounce: the lit edge's density times albedo times `gain`, over `reachPx` of falloff, drawn at `luma` of the pair colour. */
  bounce: {gain: 1.0, reachPx: 48, luma: 0.5},
  stepsFine: 64,
  stepsCoarse: 24,
} as const;

/**
 * What the `occluders` pass draws: one group per drawn thing, each with the material it is made of and the hue of its main role (the bounce takes the pair colour nearest that hue: a coral Clawd and the
 * green human warm the bounce toward the accent, blue props toward the radiance). The materials file has no entry for a character, so the cast reads as `body` and every prop, the box, the gadget and the
 * kit's pieces, as `box` (a deviation named in the study). The bubble is `glass`: transmissive, so it is not drawn into the mask at all.
 */
export type OccluderGroup = 'figure' | 'codex' | 'clawd' | 'gadget' | 'box' | 'pieces' | 'bubble';
export const OCCLUDER_GROUPS: Record<OccluderGroup, {material: MaterialId; role: string}> = {
  figure: {material: 'body', role: '#67b479'},
  codex: {material: 'body', role: '#4f7df2'},
  clawd: {material: 'body', role: '#e8694a'},
  gadget: {material: 'box', role: '#2a5cf0'},
  box: {material: 'box', role: '#182a78'},
  pieces: {material: 'box', role: '#1f4fe8'},
  bubble: {material: 'glass', role: '#5b86ff'},
};

const hueOfHex = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

/** The groups in the order the mask numbers them: a group's index (at most 7) is what the mask's blue channel carries. */
export const GROUP_ORDER = Object.keys(OCCLUDER_GROUPS) as OccluderGroup[];
/** A group's byte in the mask's blue channel: index * 32 + 16, so a decoded byte is read back by `floor(b / 32)` whatever the rim's rounding. */
export const groupByte = (group: OccluderGroup): number => GROUP_ORDER.indexOf(group) * 32 + 16;

/**
 * The code colour of a group in the mask: red the albedo, green the shadow class (code / 3), blue the group's index (`groupByte`), each a byte. Null for a material that is not `solid`: transmissive and emissive
 * things take no part in the mask (the glass pass bends what is behind them; an emitter is the light).
 */
export const maskCodeOf = (group: OccluderGroup): [number, number, number] | null => {
  const m = materialOf(OCCLUDER_GROUPS[group].material);
  if (m.occluder.value !== 'solid') return null;
  return [Math.round(m.albedo.value * 255), CLASS_CODE[m.shadowClass.value as ShadowClass] * 85, groupByte(group)];
};

/** What one `light-sdf` drawing is a function of: the emitter on screen, the colours the light script gives the beat, and the occluder mask drawing (`occ`, filled in by the manifest). */
export type SdfP = {
  emitter: {x: number; y: number};
  intensity: number;
  /** The camera's zoom: the volume's radii and the emitter's seat are in stage px. */
  zoom: number;
  /** The emitter's colour from the light script (`v3/light.json`, lifted to its luma floor), drawn at `intensity`. */
  colour: string;
  pair: {radiance: string; accent: string};
  occ: string;
};

/** How far from the emitter the solid it sits in lets its light out, in px of the frame: the gadget (a lamp) entirely, any other solid (the box whose lid holds the seam) within `ownerSeatPx` stage px. */
export const ownerSeatOf = (group: OccluderGroup | undefined, zoom: number): number => (group === 'gadget' ? SDF.lampSeatPx : SDF.ownerSeatPx) * zoom;

const hueDist = (a: number, b: number): number => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** The shader's uniforms for a drawing, in pixels of the buffer (origin bottom-left: the emitter's y is flipped from the frame's). Pure. */
export const sdfUniforms = (p: SdfP) => {
  const i = Math.min(1, Math.max(0, p.intensity));
  const dot = rgb(p.colour).map((c) => c * i * SDF.dotGain) as [number, number, number];
  return {
    emitter: [p.emitter.x, SDF_SIZE.height - p.emitter.y] as [number, number],
    emitterSeat: SDF.emitterSeatPx * p.zoom,
    r0: (SDF.r0.base + SDF.r0.gain * i) * p.zoom,
    reach: (SDF.reach.base + SDF.reach.gain * i) * p.zoom,
    floor: SDF.floor,
    bounceLuma: SDF.bounce.luma * i,
    dot,
    radiance: rgb(p.pair.radiance),
    accent: rgb(p.pair.accent),
    /** Per group, 1 where the pair colour nearest the role's hue is the accent (a coral Clawd, the green human), 0 for the radiance: what a lit edge of that group gives back. */
    groupAccent: GROUP_ORDER.map((g) => (hueDist(hueOfHex(OCCLUDER_GROUPS[g].role), hueOfHex(p.pair.accent)) < hueDist(hueOfHex(OCCLUDER_GROUPS[g].role), hueOfHex(p.pair.radiance)) ? 1 : 0)),
  };
};

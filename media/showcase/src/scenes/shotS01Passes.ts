/**
 * Shot s01 as drawing passes (row 6.12, D87): the picture of a frame is a stack of passes, each a pure function of ITS OWN projection of the shot state. `ShotS01` draws the stack in one
 * browser frame; `ShotS01Layer` draws one pass at a time from a projection, which is what `scripts/animation/render-cached.mjs` caches by the projection's hash. A pass component reads
 * its projection and nothing else, so two frames whose projection is the same JSON draw the same pixels, and a hash of the projection IS the drawing's identity.
 *
 * Camera: a moving camera re-rasterises vector content, so a pass drawn at one camera and resampled to another differs from the browser's own frame (measured, scripts/animation/README.md
 * "Render cache"). The camera pose is therefore PART of the projection of every pass that sits under it: the cache holds the pass as the browser draws it under that pose, and the camera
 * layer is the list of poses (61 distinct on s01: the rest pose, the 60-frame widen, and the held end pose).
 *
 * Pure, no React: scripts/animation/render-manifest.mjs loads this module in node.
 */
import type {CameraPose} from '../library/animation/camera';
import {quantise} from '../library/animation/track';
import type {Joints} from '../library/motion';
import type {PartName} from '../library/motion/partsRig';
import {interpolateColors} from 'remotion';
import lightFile from '../../v3/light.json';
import type {SdfP} from '../library/light/sdf';
import {settled} from '../library/tokens';
import {PIECE_SIZE, chart, stateAt, toScreen, type Emitter, type GadgetPose, type PieceDraw, type ShotState} from './shotS01Plan';

/**
 * Bottom to top: `back` is the field, the flood and the motes over it, and the Codex and the pieces behind the figure, all inside the one camera transform; `figure` the human; `front` the gadget, bubble, box, Clawd, the front
 * pieces, the first stalk and the pop; `light-over` the lamp's core and `grain` the noise, both screen-blended; `title` the lockup.
 * The back is ONE drawing, not two (the light under and the props behind): the browser decides how to rasterise the layers inside one transform from everything those layers hold (measured, scripts/animation/README.md
 * "Render cache": at zoom 0.6 the pieces are drawn soft in the whole frame and sharp when drawn without the motes beside them), so a pass drawn apart from its neighbours is not the pass the whole frame draws.
 * What a pass has to carry of its neighbours is their compositing, not their pixels: a sibling under the front with an opacity below 1 (the motes while the flood is rising) makes the browser draw the
 * front soft, so the front pass carries `motes`, the same element drawn invisible (`FrontP.motes`).
 *
 * The light layer (D98) is two passes between the front and the lamp: `occluders` draws every solid thing flat in its material's code colour (an input, never composed), and `light-sdf` lights the frame from the
 * emitter through the signed-distance field of that mask and quantises it to dots (screen-blended, like the lamp's core). `light-sdf` names the drawing it reads (`PASS_INPUT`): the manifest fills that id into
 * its projection, so its drawing id changes when, and only when, an occluder or the light does.
 */
export const PASSES = ['back', 'figure', 'front', 'occluders', 'light-sdf', 'light-over', 'grain', 'title'] as const;
export type Pass = (typeof PASSES)[number];
/** The manifest layer a pass belongs to. `props` carries the back (the field and the light under the props) and the front, `light` the light over the picture, `light-sdf` the occluder mask and the signed-distance light, `world` the title lockup. */
export const PASS_LAYER: Record<Pass, 'figure' | 'props' | 'light' | 'light-sdf' | 'world'> = {back: 'props', figure: 'figure', front: 'props', occluders: 'light-sdf', 'light-sdf': 'light-sdf', 'light-over': 'light', grain: 'light', title: 'world'};
/** A pass that reads another pass's drawing: the id of that drawing goes into its projection under `as`. */
export const PASS_INPUT: Partial<Record<Pass, {pass: Pass; as: string}>> = {'light-sdf': {pass: 'occluders', as: 'occ'}};
/** A pass whose drawings are an input of another and are never composed into a frame. */
export const PASS_INTERMEDIATE: readonly Pass[] = ['occluders'];

export type UnderP = {flood: number; dial: number; dialXY: [number, number]; motesFrame: number};
export type BehindP = {boil: number; codex: {lean: number; catch: number}; pieces: PieceDraw[]};
export type FrontP = {camera: CameraPose; motes: boolean; boil: number; gadget: GadgetPose; bubble: {size: number; centre: [number, number]}; lid: number; clawd: {lean: number; push: number}; pieces: PieceDraw[]; stalk0: number; pop: number};
export type BackP = {camera: CameraPose; field: string; under: UnderP | null; behind: BehindP};
export type FigureP = {camera: CameraPose; pose: Joints; order: PartName[]};
export type CoreP = {camera: CameraPose; emitter: Emitter};
/** What the occluders pass draws: the solids only. The bubble (glass: transmissive), the flood, the motes, the pop and the lamp are not in it, so their changes do not redraw the mask. */
export type OccP = {camera: CameraPose; boil: number; codex: BehindP['codex']; behind: PieceDraw[]; figure: {pose: Joints; order: PartName[]}; front: {gadget: GadgetPose; lid: number; clawd: {lean: number; push: number}; pieces: PieceDraw[]; stalk0: number}};
export type GrainP = {variant: number};
export type TitleP = Record<string, never>;
export type PassProjection = {back: BackP; figure: FigureP; front: FrontP; occluders: OccP; 'light-sdf': SdfP; 'light-over': CoreP; grain: GrainP; title: TitleP};

/** What a frame needs besides drawings: the grain's opacity and the title's. */
export type FrameParams = {field: string; grainAmount: number; grainOpacity: number; titleOpacity: number};

/** The projection of every pass on a frame; null where the pass draws nothing (no lamp, no grain, no title). */
export type FrameProjection = {[P in Pass]: PassProjection[P] | null};

export const fieldAt = (flood: number): string => interpolateColors(Math.min(1, flood), [0, 1], [settled.field, '#040a2a']);
export const titleOpacityAt = (frame: number): number => 1 - Math.max(0, Math.min(1, (frame - 150) / 60));

type LightBeats = Record<string, {pair: {radiance: string; accent: string}; emitter?: {colour: string}}>;

/** The light layer's projection on a frame: the emitter on screen with the colours the light script gives this beat, or null where no emitter is drawn (the same rule as the lamp's core). */
const lightSdfOf = (s: ShotState): Omit<SdfP, 'occ'> | null => {
  const e = s.light.emitter;
  if (!e || e.intensity <= 0.01) return null;
  const beat = (lightFile as {beats: LightBeats}).beats[s.beat];
  if (!beat?.emitter) throw new Error(`light-sdf: v3/light.json has no emitter for the beat "${s.beat}" the chart draws one in`);
  const [x, y] = toScreen(s.camera, e.x, e.y);
  return {emitter: {x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100}, intensity: Math.round(e.intensity * 1000) / 1000, zoom: Math.round(s.camera.zoom * 1000) / 1000, colour: beat.emitter.colour, pair: beat.pair};
};

export const projectState = (s: ShotState): {passes: FrameProjection; params: FrameParams} => {
  const camera = s.camera;
  const flood = s.light.flood, e = s.light.emitter, sdf = lightSdfOf(s);
  const grainOpacity = s.light.grain * 0.1;
  const field = fieldAt(flood);
  return {
    passes: {
      back: {
        camera, field,
        under: flood <= 0.001 ? null : {flood, dial: s.light.dial, dialXY: s.gadget.dial, motesFrame: flood < 0.2 ? 0 : quantise(s.frame, 2)},
        behind: {boil: s.boil, codex: s.codex, pieces: s.pieces.filter((p) => p.layer === 'back')},
      },
      figure: {camera, pose: s.pose, order: s.partsOrder},
      front: {camera, motes: flood >= 0.2 && flood < 1, boil: s.boil, gadget: s.gadget, bubble: s.bubble, lid: s.lid, clawd: s.clawd, pieces: s.pieces.filter((p) => p.layer === 'front'), stalk0: s.stalk0, pop: s.light.pop},
      occluders: sdf === null ? null : {camera, boil: s.boil, codex: s.codex, behind: s.pieces.filter((p) => p.layer === 'back'), figure: {pose: s.pose, order: s.partsOrder}, front: {gadget: s.gadget, lid: s.lid, clawd: s.clawd, pieces: s.pieces.filter((p) => p.layer === 'front'), stalk0: s.stalk0}},
      // the mask drawing's id is filled in by whoever names the drawings (the manifest): see PASS_INPUT
      'light-sdf': sdf === null ? null : {...sdf, occ: ''},
      'light-over': !e || e.intensity <= 0.01 ? null : {camera, emitter: e},
      grain: grainOpacity <= 0 ? null : {variant: s.boil},
      title: titleOpacityAt(s.frame) <= 0 ? null : {},
    },
    params: {field, grainAmount: s.light.grain, grainOpacity, titleOpacity: titleOpacityAt(s.frame)},
  };
};

export const projectFrame = (frame: number) => projectState(stateAt(frame));

/** The scale the first stalk is drawn at (`FrontBody`). */
export const STALK0_SCALE = 2.7;

/**
 * The largest scale, on screen, of a prop whose own drawing changes from `previous` to `passes` (0 when none does): the camera's zoom times the scale of the gadget, the bubble, the first stalk or a piece
 * that moved, grew or turned. The browser rasterises vector content at the scale it is drawn on screen, so a drawing made apart from the whole frame is most likely to differ where a magnified prop is
 * changing (the gadget's rise at 2.6-2.9 times, 0.6 zoom: frames 240-261); `render-cached.mjs` takes a frame where this is above 1.5 into its confirm sample.
 */
export const magnifiedChangeOf = (previous: FrameProjection | null, passes: FrameProjection): number => {
  if (!previous) return 0;
  const front = passes.front!, before = previous.front!;
  const props: {changed: boolean; scale: number}[] = [
    {changed: JSON.stringify(front.gadget) !== JSON.stringify(before.gadget), scale: front.gadget.scale},
    {changed: JSON.stringify(front.bubble) !== JSON.stringify(before.bubble), scale: front.bubble.size * 1.2},
    {changed: front.stalk0 !== before.stalk0, scale: front.stalk0 > 0.01 ? STALK0_SCALE : 0},
  ];
  const priorPieces = new Map([...before.pieces, ...previous.back!.behind.pieces].map((p) => [p.id, JSON.stringify(p.pose)]));
  for (const p of [...front.pieces, ...passes.back!.behind.pieces]) props.push({changed: priorPieces.get(p.id) !== JSON.stringify(p.pose), scale: p.pose.scale * (p.kind === 'stalk' ? PIECE_SIZE.stalk : 1)});
  return front.camera.zoom * Math.max(0, ...props.filter((q) => q.changed).map((q) => q.scale));
};

/** The shot's length in frames, from the chart (the exposure sheet and the composition read the same two numbers). */
export const SHOT_FRAMES: [number, number] = [chart.frames[0], chart.frames[1]];

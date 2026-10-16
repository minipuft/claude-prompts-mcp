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
import {settled} from '../library/tokens';
import {chart, stateAt, type Emitter, type GadgetPose, type PieceDraw, type ShotState} from './shotS01Plan';

/**
 * Bottom to top: `back` is the field, the flood and the motes over it, and the Codex and the pieces behind the figure, all inside the one camera transform; `figure` the human; `front` the gadget, bubble, box, Clawd, the front
 * pieces, the first stalk and the pop; `light-over` the lamp's core and `grain` the noise, both screen-blended; `title` the lockup.
 * The back is ONE drawing, not two (the light under and the props behind): the browser decides how to rasterise the layers inside one transform from everything those layers hold (measured, scripts/animation/README.md
 * "Render cache": at zoom 0.6 the pieces are drawn soft in the whole frame and sharp when drawn without the motes beside them), so a pass drawn apart from its neighbours is not the pass the whole frame draws.
 */
export const PASSES = ['back', 'figure', 'front', 'light-over', 'grain', 'title'] as const;
export type Pass = (typeof PASSES)[number];
/** The manifest layer a pass belongs to. `props` carries the back (the field and the light under the props) and the front, `light` the light over the picture, `world` the title lockup. */
export const PASS_LAYER: Record<Pass, 'figure' | 'props' | 'light' | 'world'> = {back: 'props', figure: 'figure', front: 'props', 'light-over': 'light', grain: 'light', title: 'world'};

export type UnderP = {flood: number; dial: number; dialXY: [number, number]; motesFrame: number};
export type BehindP = {boil: number; codex: {lean: number; catch: number}; pieces: PieceDraw[]};
export type FrontP = {camera: CameraPose; boil: number; gadget: GadgetPose; bubble: {size: number; centre: [number, number]}; lid: number; clawd: {lean: number; push: number}; pieces: PieceDraw[]; stalk0: number; pop: number};
export type BackP = {camera: CameraPose; field: string; under: UnderP | null; behind: BehindP};
export type FigureP = {camera: CameraPose; pose: Joints; order: PartName[]};
export type CoreP = {camera: CameraPose; emitter: Emitter};
export type GrainP = {variant: number};
export type TitleP = Record<string, never>;
export type PassProjection = {back: BackP; figure: FigureP; front: FrontP; 'light-over': CoreP; grain: GrainP; title: TitleP};

/** What a frame needs besides drawings: the grain's opacity and the title's. */
export type FrameParams = {field: string; grainAmount: number; grainOpacity: number; titleOpacity: number};

/** The projection of every pass on a frame; null where the pass draws nothing (no lamp, no grain, no title). */
export type FrameProjection = {[P in Pass]: PassProjection[P] | null};

export const fieldAt = (flood: number): string => interpolateColors(Math.min(1, flood), [0, 1], [settled.field, '#040a2a']);
export const titleOpacityAt = (frame: number): number => 1 - Math.max(0, Math.min(1, (frame - 150) / 60));

export const projectState = (s: ShotState): {passes: FrameProjection; params: FrameParams} => {
  const camera = s.camera;
  const flood = s.light.flood, e = s.light.emitter;
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
      front: {camera, boil: s.boil, gadget: s.gadget, bubble: s.bubble, lid: s.lid, clawd: s.clawd, pieces: s.pieces.filter((p) => p.layer === 'front'), stalk0: s.stalk0, pop: s.light.pop},
      'light-over': !e || e.intensity <= 0.01 ? null : {camera, emitter: e},
      grain: grainOpacity <= 0 ? null : {variant: s.boil},
      title: titleOpacityAt(s.frame) <= 0 ? null : {},
    },
    params: {field, grainAmount: s.light.grain, grainOpacity, titleOpacity: titleOpacityAt(s.frame)},
  };
};

export const projectFrame = (frame: number) => projectState(stateAt(frame));

/** The shot's length in frames, from the chart (the exposure sheet and the composition read the same two numbers). */
export const SHOT_FRAMES: [number, number] = [chart.frames[0], chart.frames[1]];

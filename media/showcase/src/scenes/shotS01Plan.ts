/**
 * Shot s01 (arrival and everything at once, frames 0-420): the state of every frame, pure. `ShotS01` draws it, `scripts/s01-xsheet.mjs` writes the
 * exposure sheet from it, so the sheet cannot describe a shot the composition does not draw. Everything is read from the shot's contracts:
 * the chart (v3/charts), the key sheet (v3/keys), the pose sheet (v3/poses: how the figure travels between the keys), the layout (v3/layouts: camera numbers and staging), the beats' blocking (v3/blocking, read only:
 * where the layout's staging differs the difference is a proposal in the study, never a write) and the timeline. No React, no rendering.
 */
import arrivalFile from '../../v3/blocking/arrival.json';
import everythingFile from '../../v3/blocking/everything-at-once.json';
import chartFile from '../../v3/charts/s01-arrival-overwhelm.json';
import keysFile from '../../v3/keys/s01-arrival-overwhelm.json';
import layoutFile from '../../v3/layouts/s01-arrival-overwhelm.json';
import posesFile from '../../v3/poses/s01-arrival-overwhelm.json';
import timelineFile from '../../v3/timeline.json';
import partsFile from '../../assets/human/families/home/parts/parts.json';
import {parseBlocking, type Blocking} from '../library/animation/blocking';
import {cameraAt, cameraFromLayout, type CameraPose, type LayoutCameraFields} from '../library/animation/camera';
import {pathAt, parseChart, pieceAt, scalarAt, type PiecePose, type ScalarActor} from '../library/animation/chart';
import {describeFrame, parseKeySheet, type FrameInfo} from '../library/animation/keys';
import {parsePoseSheet, poseChartFrom, poseKeySheet} from '../library/animation/pose';
import {beatAt, type Timeline} from '../library/animation/timeline';
import {quantise} from '../library/animation/track';
import {boil, poseAt, type Joints} from '../library/motion';
import {jointParents, restPose} from '../library/cast/humanPose';
import {applyOrder, defaultOrder, parseParts, type PartName} from '../library/motion/partsRig';
import type {XState} from '../library/animation/xsheet';

export const SIZE = {width: 1280, height: 720};
export const SHOT = 's01-arrival-overwhelm';
export const chart = parseChart(chartFile);
/** The key sheet as authored (keys, holds, joints) and the pose sheet over it (v3/poses: breakdown arcs, secondaries, moving holds). */
export const keySheet = parseKeySheet(keysFile);
export const poseSheet = parsePoseSheet(posesFile);
/** The key sheet with the pose sheet's breakdown list: what `describeFrame` and the exposure sheet describe is what `playedChart` plays. */
export const sheet = poseKeySheet(poseSheet, keySheet);
export const layout = layoutFile;
const parts = parseParts(partsFile, restPose);
/** The order the parts rig draws the human in on `frame` (front first): the rule over the frame's joints with the lead of the key the move is toward (a hold: the key it holds), under that key's own `order`. */
export const partsOrderAt = (pose: Joints, info: FrameInfo): PartName[] => {
  const key = poseSheet.keys.find((k) => k.name === (info.phase === 'breakdown' && info.to ? info.to : info.from))!;
  return applyOrder(defaultOrder(parts, pose, key.lead, key.weight.foot), key.order);
};
export const timeline = timelineFile as unknown as Timeline;
/** The chart `poseAt` plays: the keys and holds of the key sheet, the pose sheet's drawn breakdowns, lagged secondaries and drifting moving holds. */
export const playedChart = poseChartFrom(poseSheet, keySheet, jointParents);
const camera = cameraFromLayout(layoutFile as unknown as LayoutCameraFields, SIZE, {span: chart.camera.span});

const staging = layoutFile.staging;
/** The blocking the beats carry today (another worker's files, read only) and the layout's staging laid over it: what the shot is drawn at. */
export const blockingFiles = {arrival: parseBlocking(arrivalFile), 'everything-at-once': parseBlocking(everythingFile)};
export const stagedBlocking = (beat: keyof typeof blockingFiles): Blocking => ({
  ...blockingFiles[beat],
  figure: {scale: staging.human.scale, x: staging.human.x, y: staging.human.y},
  codex: {x: staging.codex.x, y: staging.codex.y, scale: staging.codex.scale},
  clawd: {x: staging.clawd.x, y: staging.clawd.y, scale: staging.clawd.scale},
});

const scalar = (name: string): ScalarActor => {
  const a = chart.actors[name];
  if (!a || a.kind !== 'scalar') throw new Error(`s01: chart has no scalar actor "${name}"`);
  return a;
};
const A = {
  lid: scalar('box.lid'), bubble: scalar('bubble.size'), rise: scalar('gadget.rise'), glow: scalar('gadget.glow'), codexLean: scalar('codex.lean'), codexCatch: scalar('codex.catch'),
  clawdLean: scalar('clawd.lean'), clawdPush: scalar('clawd.push'), stalk0: scalar('stalk0.grow'), seam: scalar('light.seam'), dial: scalar('light.dial'), flood: scalar('light.flood'), grain: scalar('light.grain'),
};

/** The gadget on `frame`: its dial in stage pixels, its scale, the centre its bubble shares and the funnel mouth the pieces leave from (Gadget.tsx: dial (88,170), funnel (192,44), viewBox origin -20, 200 x 260). */
export type GadgetPose = {dial: [number, number]; scale: number; centre: [number, number]; funnel: [number, number]; origin: [number, number]; glow: number};
export const gadgetAt = (frame: number): GadgetPose => {
  const p = pathAt(A.rise, scalarAt(A.rise, frame)), s = p.scale;
  return {dial: [p.x, p.y], scale: s, centre: [p.x + 2 * s, p.y - 40 * s], funnel: [p.x + 104 * s, p.y - 126 * s], origin: [p.x - 108 * s, p.y - 190 * s], glow: scalarAt(A.glow, frame)};
};

/** The seam of the box lid, the one emitter before the pop, and the dial after it (the chart's windows). */
export const SEAM_XY: [number, number] = [staging.seamXY[0]!, staging.seamXY[1]!];
export const SEAM_WINDOW: [number, number] = [0, 178];
export const DIAL_WINDOW: [number, number] = [182, 420];

export type Emitter = {kind: 'seam' | 'dial'; x: number; y: number; intensity: number};
export const emitterAt = (frame: number): Emitter | null => {
  if (frame >= SEAM_WINDOW[0] && frame < SEAM_WINDOW[1]) return {kind: 'seam', x: SEAM_XY[0], y: SEAM_XY[1], intensity: scalarAt(A.seam, frame)};
  if (frame >= DIAL_WINDOW[0] && frame < DIAL_WINDOW[1]) {
    const g = gadgetAt(frame);
    return {kind: 'dial', x: g.dial[0], y: g.dial[1], intensity: scalarAt(A.dial, frame)};
  }
  return null;
};

export type PieceDraw = {id: string; kind: string; layer: 'back' | 'front'; pose: PiecePose; seed: number};
const launched = chart.pieces.map((p, i) => ({p, i}));

export type ShotState = {
  frame: number;
  beat: string;
  camera: CameraPose;
  pose: Joints;
  poseInfo: FrameInfo;
  /** The draw order of the parts rig on this frame, front first. */
  partsOrder: PartName[];
  lid: number;
  bubble: {size: number; centre: [number, number]};
  gadget: GadgetPose;
  codex: {lean: number; catch: number};
  clawd: {lean: number; push: number};
  stalk0: number;
  light: {seam: number; dial: number; flood: number; grain: number; emitter: Emitter | null; pop: number};
  pieces: PieceDraw[];
  boil: number;
};

/** The pop's burst ring, 0 before frame 180, 1 on it, decaying over the chart's recovery frames (a light-layer response, on ones). */
const popAt = (frame: number): number => {
  const pulse = chart.pulses.find((q) => q.what.startsWith('the pop'));
  if (!pulse || frame < pulse.frame) return 0;
  const t = (frame - pulse.frame) / (pulse.length ?? 12);
  return t >= 1 ? 0 : (1 - t) * (1 - t);
};

export const stateAt = (frame: number): ShotState => {
  const beat = beatAt(timeline, frame);
  const g = gadgetAt(frame);
  const bubbleSize = scalarAt(A.bubble, frame);
  const pose = poseAt(playedChart, frame, jointParents), poseInfo = describeFrame(sheet, Math.max(0, quantise(frame, 2)));
  return {
    frame,
    beat: beat.id,
    camera: cameraAt(camera, frame),
    pose,
    poseInfo,
    partsOrder: partsOrderAt(pose, poseInfo),
    lid: scalarAt(A.lid, frame),
    bubble: {size: bubbleSize, centre: g.centre},
    gadget: g,
    codex: {lean: scalarAt(A.codexLean, frame), catch: scalarAt(A.codexCatch, frame)},
    clawd: {lean: scalarAt(A.clawdLean, frame), push: scalarAt(A.clawdPush, frame)},
    stalk0: scalarAt(A.stalk0, frame),
    light: {seam: scalarAt(A.seam, frame), dial: scalarAt(A.dial, frame), flood: scalarAt(A.flood, frame), grain: scalarAt(A.grain, frame), emitter: emitterAt(frame), pop: popAt(frame)},
    pieces: launched.flatMap(({p, i}) => {
      const pose = pieceAt(p, frame, gadgetAt(p.start).funnel);
      return pose ? [{id: p.id, kind: p.kind, layer: p.layer ?? 'front', pose, seed: i}] : [];
    }),
    boil: boil(quantise(frame, 2), chart.boil.variants, chart.boil.seed, 30, chart.boil.rate),
  };
};

/** Screen position of a stage point under the camera of `frame` (the exposure sheet keeps the emitter in screen pixels: probe-eyetrace reads it as such). */
export const toScreen = (c: CameraPose, x: number, y: number): [number, number] => {
  const t = (c.rotation * Math.PI) / 180, cos = Math.cos(t), sin = Math.sin(t);
  const sx = x - c.x, sy = y - c.y;
  return [(cos * sx - sin * sy) * c.zoom + SIZE.width / 2, (sin * sx + cos * sy) * c.zoom + SIZE.height / 2];
};

/** The state of a frame as the exposure sheet reads it (src/library/animation/xsheet.ts). The emitter is in stage pixels, as scripts/animation/README.md documents (probe-eyetrace projects it through the row's camera). */
export const xstateOf = (frame: number): XState => {
  const s = stateAt(frame);
  const e = s.light.emitter;
  const key = frame === quantise(frame, 2) && s.poseInfo.phase === 'key' && sheet.keys.some((k) => k.name === s.poseInfo.from && k.frame === Math.max(0, quantise(frame, 2))) ? s.poseInfo.from : null;
  const colour = '#0a51fb';
  return {
    frame,
    beat: s.beat,
    world: 'home',
    crossing: null,
    drawing: s.poseInfo.phase === 'breakdown' ? `${s.poseInfo.from}>${s.poseInfo.to}` : s.poseInfo.from,
    chart: {phase: s.poseInfo.phase, favour: s.poseInfo.favour, to: s.poseInfo.to},
    camera: s.camera,
    emitter: e && e.intensity > 0 ? {x: e.x, y: e.y, hex: colour} : null,
    key,
    hold: key ? (sheet.keys.find((k) => k.name === key)?.hold ?? null) : null,
  };
};

/** Overwhelm pieces' sizes in stage pixels at size 1 (stalk and arch are tall, rings and blocks small). */
export const PIECE_SIZE = {stalk: 1.8, arch: {width: 360, height: 560}, ring: 95, block: {width: 120, height: 84}, frame: {width: 230, height: 190}, string: {end: [260, 40] as [number, number], sag: 70}};

/**
 * The animatic's wiring, pure: which blocking, keys, layout camera and hue belong to which beat, and the state of every frame. Both the
 * `Animatic` composition (draws it) and scripts/animation/xsheet.mjs (writes the exposure sheet) read this one module, so the sheet
 * cannot describe a film the composition does not draw. No React, no rendering.
 */
import arrival from '../../v3/blocking/arrival.json';
import artWorld from '../../v3/blocking/art-world.json';
import cantBuild from '../../v3/blocking/cant-build.json';
import crossing from '../../v3/blocking/crossing.json';
import everythingAtOnce from '../../v3/blocking/everything-at-once.json';
import homeSettle from '../../v3/blocking/home-settle.json';
import programmingWorld from '../../v3/blocking/programming-world.json';
import theFrame from '../../v3/blocking/the-frame.json';
import s02Keys from '../../v3/keys/s02-cant-build-frame.json';
import s02Layout from '../../v3/layouts/s02-cant-build-frame.json';
import lightFile from '../../v3/light.json';
import timelineFile from '../../v3/timeline.json';
import {blockingAt, blockingTrack, emitterPointAt, parseBlocking, type Blocking} from '../library/animation/blocking';
import {cameraAt, cameraFromLayout, lockedCamera, type Camera, type CameraPose} from '../library/animation/camera';
import {heldDrawing, parseKeySheet, type FrameInfo, type KeySheet} from '../library/animation/keys';
import {coversTimeline, emitterIntensityAt, lightAt, lightTrack, lightTrackFromContract, parseLightContract} from '../library/animation/light';
import {beatAt, crossingAt, type CrossingWindow, type Timeline, type TimelineBeat} from '../library/animation/timeline';
import type {Key} from '../library/animation/track';
import {crossingPhase, emitterStrength, type XState} from '../library/animation/xsheet';
import {liftChart, liftPose} from '../library/cast/humanPose';
import type {Joints, PoseChart} from '../library/motion';
import {hueOf} from './lightPlan';

export const SIZE = {width: 1280, height: 720};
/** The emitter's glow radius in stage pixels. The eye trace (C29) ranks the brightest 0.5 % of the frame's pixels; a glow smaller than that share, with the props drawn over half of it, leaves the rest of the ranking to whatever else is lit and the centroid wanders (row 4.2: 65 % off at the start of the shaded beat at 170). */
const EMITTER_RADIUS = 260;
export const timeline = timelineFile as unknown as Timeline;

const blockingByBeat: Record<string, Blocking> = Object.fromEntries(
  Object.entries({
    arrival,
    'everything-at-once': everythingAtOnce,
    'cant-build': cantBuild,
    'the-frame': theFrame,
    'art-world': artWorld,
    crossing,
    'programming-world': programmingWorld,
    'home-settle': homeSettle,
  }).map(([id, json]) => [id, parseBlocking(json)]),
);
const blockingOnTimeline = blockingTrack(timeline.beats, blockingByBeat);

/** The layout contracts and key sheets that exist, by shot. A shot with none gets the placeholders below. */
const layouts: Record<string, Parameters<typeof cameraFromLayout>[0]> = {'s02-cant-build-frame': s02Layout};
const keySheets: Record<string, KeySheet> = {'s02-cant-build-frame': parseKeySheet(s02Keys)};

/** liftChart as a key sheet (rest / raise / settle), the placeholder for every shot whose key sheet is not drawn yet. */
const placeholderSheet: KeySheet = {
  shot: 'placeholder',
  actor: 'human',
  provisional: true,
  note: 'liftChart, per beat, beat-local frames',
  keys: liftChart.keys.map((k, i) => ({name: ['rest', 'raise', 'settle'][i]!, frame: k.frame, hold: k.hold, joints: k.joints})),
  breakdowns: liftChart.breakdowns,
};

/**
 * Light. v3/light.json (scripts/animation/compile-light.mjs) is the contract when it covers every beat and crossing of the timeline: the
 * emitter's colour, intensity and on/off frames come from it, and a crossing walks its hue path. Otherwise (an empty or stale file) the
 * derivation before the contract applies: the shot's `radiance` hue (lightPlan.hueOf) at the join, intensity 0.9, always on.
 */
const contract = (() => {
  const parsed = parseLightContract(lightFile);
  return coversTimeline(parsed, timeline.beats, timeline.crossings) ? parsed : null;
})();
const light = contract ? lightTrackFromContract(timeline.beats, contract) : lightTrack(timeline.beats, (beat) => hueOf(beat.id).radiance);

/** The first frame of the shot a beat belongs to (key frames are shot-local). */
const shotStart = (beat: TimelineBeat): number => {
  const shot = blockingByBeat[beat.id]?.shot;
  const mates = shot ? timeline.beats.filter((b) => blockingByBeat[b.id]?.shot === shot) : [beat];
  return Math.min(...mates.map((b) => b.start));
};

/** The camera over the whole film: a layout contract's move across its shot's beats, a locked frame elsewhere, settling during the crossing out of a moved shot. */
const buildCamera = (): Camera => {
  const keys: Key<CameraPose>[] = [];
  const push = (k: Key<CameraPose>) => {
    if (!keys.length || k.frame > keys[keys.length - 1]!.frame) keys.push(k);
  };
  const locked = lockedCamera(SIZE);
  let i = 0;
  while (i < timeline.beats.length) {
    const beat = timeline.beats[i]!;
    const shot = blockingByBeat[beat.id]?.shot;
    const layout = shot ? layouts[shot] : undefined;
    if (!shot || !layout) {
      push({frame: beat.start, value: locked, ease: 'smooth'});
      i++;
      continue;
    }
    let j = i;
    while (timeline.beats[j + 1] && blockingByBeat[timeline.beats[j + 1]!.id]?.shot === shot) j++;
    // The move ends where the next crossing begins and the camera is locked again by the line phase of that crossing (its middle third): the line world is read as a closed outline
    // (C23), and a camera still panning there put the figure's boots below the frame (row 4.4: on 23 of 142 line-phase frames, all in the crossing out of s02).
    const next = timeline.beats[j + 1];
    const crossing = next?.crossingIn;
    // The camera leads the light, so it starts to move where the light does: the first beat of the shot whose blocking emitter travels. A light that sits still (s02's dial lost on the floor) keeps
    // the camera still, and a move that began with the shot panned the dial out of the bottom of the frame before the beat ended (row 4.2: it left the frame at about 540 of cant-build's 420-630).
    const travelling = timeline.beats.slice(i, j + 1).find((b) => {
      const e = blockingByBeat[b.id]?.emitter;
      return e && (e.start[0] !== e.end[0] || e.start[1] !== e.end[1]);
    });
    const moveStart = travelling?.start ?? beat.start;
    if (moveStart > beat.start) push({frame: beat.start, value: locked, ease: 'smooth'});
    cameraFromLayout(layout, SIZE, {span: [moveStart, Math.min(timeline.beats[j]!.end, crossing?.[0] ?? Infinity)]}).keys.forEach(push);
    if (next) push({frame: crossing ? Math.round(crossing[0] + (crossing[1] - crossing[0]) / 3) : next.start, value: locked, ease: 'smooth'});
    i = j + 1;
  }
  return {keys};
};
const camera = buildCamera();

export type FrameState = {
  frame: number;
  beat: TimelineBeat;
  /** The crossing window the frame is inside, if any, and how far. */
  crossing: CrossingWindow | undefined;
  blocking: Blocking;
  camera: CameraPose;
  /** `intensity` is 0 on a frame with no light (a beat with no emitter, or the frames between two emitters). */
  emitter: {x: number; y: number; radius: number; color: string; intensity: number};
  /** The beat-local frame the key sheet is read at. */
  local: number;
  /** The pose held on this frame (animatic: holds only, each key for exactly the hold it declares) and the single-key chart that holds it. */
  pose: Joints;
  heldChart: PoseChart;
  drawing: string;
  /** The beat-local frame the drawing on this frame came on (a key's pop frame). */
  drawnFrom: number;
  chart: FrameInfo;
  sheet: KeySheet;
};

export const frameState = (frame: number): FrameState => {
  const beat = beatAt(timeline, frame);
  const shot = blockingByBeat[beat.id]?.shot ?? null;
  const own = shot ? keySheets[shot] : undefined;
  const sheet = own ?? placeholderSheet;
  const local = frame - (own ? shotStart(beat) : beat.start);
  const held = heldDrawing(sheet, local);
  // The figure's placement (scale, x, y) is part of its drawing: it steps at a cut with the pose and never eases like a prop does, so the drawn layer changes only where the exposure sheet has a key.
  const blocking = {...blockingAt(blockingOnTimeline, frame), figure: blockingByBeat[beat.id]!.figure};
  const colour = lightAt(light, frame);
  const spot = contract ? emitterPointAt(blockingByBeat[beat.id]!, beat, frame) : null;
  return {
    frame,
    beat,
    crossing: crossingAt(timeline, frame),
    blocking,
    camera: cameraAt(camera, frame),
    emitter: {
      x: spot?.x ?? blocking.join.x,
      y: spot?.y ?? blocking.join.y,
      radius: EMITTER_RADIUS,
      color: colour,
      intensity: contract ? emitterIntensityAt(contract, beat.id, frame) : 0.9,
    },
    local,
    pose: held.key.joints,
    heldChart: {keys: [{frame: 0, joints: held.key.joints}]},
    drawing: held.key.name,
    drawnFrom: held.start,
    chart: held.info,
    sheet,
  };
};

/** The state of a frame as the exposure sheet reads it. */
export const xstateOf = (frame: number): XState => {
  const s = frameState(frame);
  const key = s.local === s.drawnFrom ? s.chart.from : null;
  return {
    frame,
    beat: s.beat.id,
    world: s.crossing ? `${s.crossing.fromWorld}>${s.crossing.toWorld}` : s.beat.world,
    crossing: s.crossing ? crossingPhase(frame, s.crossing.start, s.crossing.length) : null,
    drawing: s.drawing,
    chart: {phase: s.chart.phase, favour: s.chart.favour, to: s.chart.to},
    camera: s.camera,
    emitter: s.emitter.intensity > 0 ? {x: s.emitter.x, y: s.emitter.y, hex: s.emitter.color, strength: emitterStrength(frame, s.crossing ?? null)} : null,
    key,
    hold: key ? (s.sheet.keys.find((k) => k.name === key)?.hold ?? null) : null,
  };
};

/**
 * The camera-on-ones reel (row 1.4): 30 frames of the home world under a pan, the figure on a chart that moves on every pair of frames.
 * `reelChart` alternates the lift between rest and raised every 6 frames, so the drawn layer has something to step on twos; `reelCamera` pans
 * 240 px right and zooms 1.15x across the 30 frames.
 */
export const REEL_FRAMES = 30;
export const reelChart: PoseChart = {
  keys: [0, 1, 2, 3, 4, 5].map((n) => ({frame: n * 6, joints: liftPose(n % 2 ? 1 : 0, n % 2 ? 1 : 0)})),
};
export const reelCamera: Camera = (() => {
  const start = lockedCamera(SIZE);
  return {keys: [{frame: 0, value: start, ease: 'smooth'}, {frame: REEL_FRAMES - 1, value: {...start, x: start.x + 240, zoom: 1.15}}]};
})();

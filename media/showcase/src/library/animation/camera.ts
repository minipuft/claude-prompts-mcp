/**
 * The camera: a 2D framing (centre, zoom, rotation) over the finished picture, sampled on ones. The drawn layer steps on twos; the camera
 * does not, so a move reads as the frame travelling over drawings that hold. Applied as a CSS transform on a wrapper, so it works over any
 * scene, including a canvas.
 */
import {createElement, type CSSProperties, type ReactNode} from 'react';
import {sample, type Track} from './track';

/** `x`, `y`: the point of the picture (frame pixels) at the centre of the view. `zoom` 1 = the whole frame. `rotation` in degrees, clockwise. */
export type CameraPose = {x: number; y: number; zoom: number; rotation: number};
export type Camera = Track<CameraPose>;
export type FrameSize = {width: number; height: number};

export const lerpCamera = (a: CameraPose, b: CameraPose, t: number): CameraPose => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  zoom: a.zoom * Math.pow(b.zoom / a.zoom, t), // zoom is multiplicative: a push of 2x reads as even at its midpoint
  rotation: a.rotation + (b.rotation - a.rotation) * t,
});

export const lockedCamera = (frame: FrameSize): CameraPose => ({x: frame.width / 2, y: frame.height / 2, zoom: 1, rotation: 0});

/** The camera's pose at `frame`, on ones. */
export const cameraAt = (camera: Camera, frame: number): CameraPose => sample(camera, frame, {quantise: 'ones', lerp: lerpCamera});

/** The CSS transform (origin 0 0) that shows `pose` of a picture the size of `size`. */
export const cameraTransform = (pose: CameraPose, size: FrameSize): string =>
  `translate(${size.width / 2}px, ${size.height / 2}px) rotate(${pose.rotation}deg) scale(${pose.zoom}) translate(${-pose.x}px, ${-pose.y}px)`;

/** A pose that shows the whole picture unmoved. */
export const cameraIsLocked = (pose: CameraPose, size: FrameSize): boolean => pose.x === size.width / 2 && pose.y === size.height / 2 && pose.zoom === 1 && pose.rotation === 0;

/**
 * Wraps a scene in the camera's view. The composition's own frame clips what the camera moves out of view, so the wrapper sets no `overflow: hidden`: measured (row 4.1)
 * on frame 1250 of the animatic rendered alone, 8 runs with the clip differed from each other in 631 anti-aliased pixels on 5 of 8 and 0 of 8 without it. A locked camera
 * sets no transform either (an identity matrix still makes the wrapper a transformed layer). The wrapper is the frame; the scene inside is drawn at full size and moved. */
export const CameraView = ({pose, size, children}: {pose: CameraPose; size: FrameSize; children: ReactNode}) => {
  const outer: CSSProperties = {position: 'absolute', left: 0, top: 0, width: size.width, height: size.height};
  const inner: CSSProperties = {position: 'absolute', left: 0, top: 0, width: size.width, height: size.height, transformOrigin: '0 0', transform: cameraIsLocked(pose, size) ? undefined : cameraTransform(pose, size)};
  return createElement('div', {style: outer}, createElement('div', {style: inner}, children));
};

/** The numeric fields of a layout contract (v3/layouts/<shot>.json) the camera can use. Fractions are of the frame; heights are percent of frame height. */
export type LayoutCameraFields = {
  emitter?: {startXY?: number[]; endXY?: number[]};
  figure?: {startHeightPct?: number | null; endHeightPct?: number | null};
  /**
   * The move as numbers, when the layout carries them: the pose at the start and at the end (stage pixels at the film's frame size) and the
   * frames the move runs over (shot-local or film frames, whichever the caller's keys use). Explicit numbers win over everything derived below.
   */
  cameraPose?: {span?: number[]; start: Partial<CameraPose>; end: Partial<CameraPose>};
};

export type LayoutCameraOptions = {
  /** First and last frame of the move. A layout's own `cameraPose.span` replaces it. */
  span: [number, number];
  /** Share of the emitter's travel the camera follows. Default 0.5: the camera leads the light without keeping it fixed in the frame. */
  follow?: number;
};

/**
 * A start -> end move built from a layout contract.
 * - zoom: end figure height over start figure height, when BOTH are numbers (a figure that grows is a push); otherwise 1.
 * - centre: the frame centre, moved by `follow` of the emitter's travel from `startXY` to `endXY`, when both are numbers; otherwise unmoved.
 * - rotation: 0.
 * A layout that carries `cameraPose` (start and end as numbers) skips all three: those numbers are the move.
 * With neither, the default is a locked camera (identity), held across the span. A layout that cannot move the camera does not invent a move.
 */
export const cameraFromLayout = (layout: LayoutCameraFields, size: FrameSize, options: LayoutCameraOptions): Camera => {
  const {follow = 0.5} = options;
  const explicit = layout.cameraPose;
  // a layout is JSON, so its span arrives as a list of any length (as `startXY` does): read as two frames or refused, never a silent default
  if (explicit?.span && explicit.span.length !== 2) throw new Error(`camera: layout cameraPose.span must be [first, last] frame, got ${JSON.stringify(explicit.span)}`);
  const span: [number, number] = explicit?.span ? [explicit.span[0]!, explicit.span[1]!] : options.span;
  if (explicit) {
    const base = lockedCamera(size);
    return {keys: [{frame: span[0], value: {...base, ...explicit.start}, ease: 'smooth'}, {frame: span[1], value: {...base, ...explicit.end}}]};
  }
  const start = lockedCamera(size);
  const end = {...start};
  const a = layout.figure?.startHeightPct, b = layout.figure?.endHeightPct;
  if (typeof a === 'number' && typeof b === 'number' && a > 0 && b > 0) end.zoom = b / a;
  const s = layout.emitter?.startXY, e = layout.emitter?.endXY;
  if (s?.length === 2 && e?.length === 2) {
    end.x += (e[0]! - s[0]!) * size.width * follow;
    end.y += (e[1]! - s[1]!) * size.height * follow;
  }
  return {keys: [{frame: span[0], value: start, ease: 'smooth'}, {frame: span[1], value: end}]};
};

import testScene from '../../../v3/blocking/test-scene.json';
import {parseBlocking, type Blocking} from '../animation/blocking';
import {figureCanvasHeight} from '../cast/MeshFigure';
import type {Emitter} from '../Radiance';
import {settled} from '../tokens';
import type {PropsPart, WorldContract, WorldId} from './types';

/**
 * The one test scene every world renders when no blocking is passed (D78: the same rig, the same keys, only the renderer changes). Screen
 * pixels at 1280x720; the values, and what each one means, live in v3/blocking/test-scene.json. A scene's `blocking` prop replaces it.
 * Arch: outer box and the opening as a share of its width; round top. Gates: ring centres `x, y` and outer radius `r`, the third largest and
 * nearest the figure. Floor: the horizon, from which the ground runs to the bottom edge. figureCrop: holds the human and nothing else.
 */
export const STAGE: Blocking = parseBlocking(testScene);

/** Contour thickness in screen pixels: the figure's height over the contract's ratio. */
export const contourPx = (c: WorldContract, blocking: Blocking = STAGE): number => (figureCanvasHeight * blocking.figure.scale) / c.line.ratio;

/** The contour colour: the contract's own hex, else the named colour (pale = the kit's cream, emissive = the shading's edge colour, dark = the outline ink). */
export const lineColour = (c: WorldContract): string =>
  c.line.hex ?? (c.line.colour === 'pale' ? settled.kit.light : c.line.colour === 'emissive' ? (c.shading?.edgeColour ?? settled.kit.main2) : settled.outline);

/** The join's light: the caller's emitter, else the contract's radiance colour at the touch point. */
export const joinEmitter = (c: WorldContract, given?: Emitter, blocking: Blocking = STAGE): Emitter =>
  given ?? {x: blocking.join.x, y: blocking.join.y, radius: 170, color: c.radiance.colour ?? settled.emitter, intensity: 0.9};

export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** The arch as two closed outlines in stage pixels: the outer (piers and a round top) and the opening, each a polyline with the arc sampled. */
export const archRings = (a = STAGE.arch, arcSteps = 28): {outer: [number, number][]; inner: [number, number][]} => {
  const half = a.width / 2, cx = a.x + half, bottom = a.y + a.height;
  const arc = (r: number, cy: number): [number, number][] =>
    Array.from({length: arcSteps + 1}, (_, i) => {
      const t = Math.PI - (Math.PI * i) / arcSteps;
      return [cx + r * Math.cos(t), cy - r * Math.sin(t)] as [number, number];
    });
  const outerCy = a.y + half;
  const innerHalf = (a.width * a.opening) / 2;
  const innerCy = a.y + a.top + innerHalf;
  return {
    outer: [[a.x, bottom], ...arc(half, outerCy), [a.x + a.width, bottom]],
    inner: [[cx - innerHalf, bottom], ...arc(innerHalf, innerCy), [cx + innerHalf, bottom]],
  };
};

/** The arch as ONE closed polygon (outer round-top outline, then the opening walked back), so it extrudes and strokes without a hole touching the base. */
export const archOutline = (a = STAGE.arch): [number, number][] => {
  const {outer, inner} = archRings(a);
  return [...outer, ...[...inner].reverse()];
};

const ORIGINAL_PARTS: PropsPart[] = ['companions', 'architecture', 'blocks'];
/** What each world draws. Home never includes the arch, the gates or the floor, and draws `actors` only where the blocking names some: with none, its output is today's look, byte for byte. */
export const WORLD_PARTS: Record<WorldId, PropsPart[]> = {
  home: [...ORIGINAL_PARTS, 'actors'],
  crayon: [...ORIGINAL_PARTS, 'arch', 'gates', 'floor'],
  line: [...ORIGINAL_PARTS, 'arch', 'gates', 'floor'],
  shaded: [...ORIGINAL_PARTS, 'arch', 'gates', 'floor'],
};

/** The world's own parts, narrowed to `override` when one is given (an override never adds a part the world does not draw). */
export const partsOf = (id: WorldId, override?: PropsPart[]): PropsPart[] =>
  override ? WORLD_PARTS[id].filter((p) => override.includes(p)) : WORLD_PARTS[id];

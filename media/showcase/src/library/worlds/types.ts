import type {FC} from 'react';
import type {Joints} from '../motion';
import type {Blocking} from '../animation/blocking';
import type {Emitter} from '../Radiance';
import type {RoleMap} from '../tokens';

export type WorldId = 'home' | 'crayon' | 'line' | 'shaded';

/**
 * A world's contract (D78): what its renderer reads. Every look in src/library/worlds is read from this object, never hard-coded, so
 * v3/worlds/<id>.json can be re-measured and overwritten without touching a renderer. The optional keys carry values the required
 * keys name but cannot hold (a colour word is `pale | emissive | dark`; its hex is `line.hex` or the fallback in contract.ts).
 * `line.interior` (default false) adds the figure's inner contours (edges between its colour regions) to the silhouette stroke. The
 * silhouette alone is one connected stroke by construction; the inner contours leave islands (eyes, hair strands), so a measured
 * silhouette count of 1 holds only without them (v3/studies/world-proof-01.md).
 */
export type WorldContract = {
  id: WorldId;
  /** CSS colour of the field. */
  field: string;
  /** Contour thickness = figure height / ratio, in screen pixels (D76: 166 is the approved model sheet's own line). */
  line: {ratio: number; colour: 'pale' | 'emissive' | 'dark'; hex?: string; interior?: boolean};
  /** How a surface is filled: `none` leaves contour only. */
  fills: 'flat' | 'crayon' | 'none' | 'stepped';
  /**
   * `bloom` draws every emissive fat line twice more behind itself (widths as multiples of the line width, opacities, additive) so the edge
   * glows; `lightDir`, `shadowFloor` and `stepAt` shape the figure's N-step light (`stepAt` is the light level the lit step starts at).
   */
  shading?: {
    steps: number;
    emissiveEdges: boolean;
    edgeColour?: string;
    bloom?: {widths: number[]; opacities: number[]};
    lightDir?: [number, number, number];
    shadowFloor?: number;
    stepAt?: number;
  };
  /** Hand-drawn contour variants per second of boil; `figuresOnly` boils the companions and not the architecture. */
  boil: {variants: number; rate: number; figuresOnly?: boolean};
  paper?: {tooth: number};
  /** Directional wax: strokes hatch along `angle` degrees (screen, y down); the human takes `figureStrength` of the world's stroke so it stays cleaner than the world. */
  stroke?: {angle: number; figureStrength: number; palette?: {blue: string; sky: string; red: string; yellow: string}};
  /**
   * The crayon world's light is a lit patch, not a glow (a glow drawn as additive wax reads as a darker halo on bright paper, so no luminance peak sat on the emitter, rubric C29).
   * Inside the emitter's radius `r` the paper lightens, fewer strokes are drawn and the remaining scribbled strokes warm toward `radiance.colour`; outside it nothing changes.
   * Every term follows one profile, `(1 - d / r) ** falloff` at distance `d` from the emitter (1 at the emitter, 0 at `r`; 1 is linear, 2 reaches the edge with no step).
   * `paper` is the lit paper's saturation and lightness, taken at the hue of the emitter's own colour (so the light reads in the beat's hue, C24/C30): saturated and brighter than the field, and far enough
   * from it (and from the cream the human is drawn in) that the light is not mistaken for the paper (C29 masks the fixed fills, the field included). `lift` (0..1): the share of the way from the field to the lit paper the paper takes at the emitter, the share of the extra hatch knock-out there (strokes thin toward
   * the centre) and, at half strength, the strokes' own lift toward the lit paper; 0 leaves the world as it was, with its glow. `warmth` (0..1): the share of the way the scribbled strokes (arch, gates,
   * floor) take toward the radiance hue at the emitter. Props and figures keep their pigments (C1, C2): they only thin. All scaled by the emitter's intensity and the scene's strength (1 - reduce).
   */
  light?: {lift: number; warmth: number; falloff: number; paper: {saturation: number; lightness: number}};
  radiance: {on: boolean; colour?: string};
  provisional: boolean;
  /** Composition cards (board-06 §8) the world borrows from. */
  cards: string[];
};

/**
 * What every world's Scene takes. `reduce` (0..1) is the line-world crossing's own control: 0 is the world, 1 is its contour lines alone
 * (fills out, lines kept, radiance out); `shift` translates the whole drawing in screen pixels (the leading line); `field` overrides the
 * contract's field so a crossing can lerp it. All three default to the world at rest. `blocking` is where everything stands (default: the test
 * scene, v3/blocking/test-scene.json).
 */
export type SceneProps = {frame: number; pose: Joints; emitter?: Emitter; reduce?: number; shift?: [number, number]; field?: string; parts?: PropsPart[]; blocking?: Blocking; /** The roles the beat's `actors` are filled with (the beat's colour pair, `lightPlan.pairRoles`); omitted = the settled palette's. */ actorRoles?: RoleMap};

/**
 * The scene's drawn parts. Home draws `companions`, `architecture`, `blocks` and the beat's `actors` (the props its blocking names: box, bubble, gadget, stalk, structure); the others add `arch`, `gates` and `floor` (the blocking's). A scene's `parts`
 * prop intersects with the world's own list, so a measurement can drop `floor` and leave every world otherwise untouched.
 */
export type PropsPart = 'companions' | 'architecture' | 'blocks' | 'actors' | 'arch' | 'gates' | 'floor';

export type World = {contract: WorldContract; Scene: FC<SceneProps>};

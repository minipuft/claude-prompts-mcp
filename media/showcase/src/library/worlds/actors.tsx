import type {CSSProperties} from 'react';
import type {ActorPlacement, Blocking} from '../animation/blocking';
import {Box, Lid, lidAngleAtFrontY} from '../props/Box';
import {Bubble} from '../props/Bubble';
import {Gadget} from '../props/Gadget';
import {Heap} from '../props/Heap';
import {CrayonPiece, GridPiece, OpeningStalk, PointerPiece, StrokePiece, TitlePiece} from '../props/Scaffold';
import {ArchPiece, PatchPiece, RingPiece, StalkPiece, StringPiece} from '../props/Pieces';
import {Sprite} from '../Sprite';
import {settled, type RoleMap} from '../tokens';

/**
 * The actors a beat's blocking names (`blocking.actors`: box, lid, bubble, gadget, stalk, arch, ring, patch, bead, structure, heap), drawn as the placeholders the animatic stages with: the project's hand-coded
 * props in flat role fills (settled roles, no stipple: the animatic has no shading pass), at the blocking's position and scale. None of the muse proposals is accepted, so these
 * are not the film's art; they say where each thing stands and how big it is so the staging can be judged. An actor the blocking does not name is not drawn, and an actor
 * name with no drawing here is an error, not a silent skip.
 *
 * Anchors (the blocking says "an anchor point in screen pixels and a scale"; this module fixes what the point is, per prop): the box and the stalk stand on it (the foot centre of the
 * box's front face, the stalk's root), the structure stands on it (the centre of its base), the heap lies on it (the bottom centre of the mound), the bubble is centred on it, and the gadget hangs from its dial (the chart's gadget path is the
 * dial's position, and the blocking's emitter anchor 'gadget dial' sits on the same point). The pieces the gadget projects (beat 2): the arch stands on its base centre, the ring is centred on it, the patch (a two-by-two tile)
 * stands on its bottom centre and the bead (a beaded string) hangs from its start; each is drawn at its size at scale 1, so `scale` is a multiple of it.
 *
 * Two props whose drawing follows their position keys, because a placement carries no scale or angle of its own (`ActorPlacement` is `x`, `y`, `scale` and `at` keys of `x` and `y`):
 * the LID is the box's lid and its anchor is the mid-point of its front edge (the part the hands lift): its opening angle is the one whose front edge stands at the anchor's `y` above the box's closed lid
 * (`lidAngleAtFrontY`; closed at 80 px of the box's own scale above its foot, open about 85 px higher), so the lid opens on the frames its `at` keys say; the BUBBLE swells as it rises out of the box: its size is
 * `BUBBLE_SWELL.from` of its `scale` where its centre is at `BUBBLE_SWELL.fromY` and the whole `scale` from `BUBBLE_SWELL.toY` up. A box with no lid actor draws its own lid closed.
 *
 * The scaffold beats (5-8, `props/Scaffold.tsx`): the crayon stands on its tip, the three strokes (`stroke-1` to `stroke-3`) on the stalk's foot (they are the stalk's own centreline in three cuts), the grid on its bottom centre, the pointer
 * (Codex's arm) hangs from its shoulder to the finger at (-290, -272), the title mark is centred. The STALK draws a leaf that opens when its placement carries `open` (`openAt` keys of the blocking, resolved by `resolveBlocking`); with none it is the
 * stalk of beats 2 and 3. The three gates of beat 7 are the blocking's own `gates`, which the shaded world lights by where the emitter stands, so they have no prop of their own.
 */
export type ActorName = 'grid' | 'stroke-1' | 'stroke-2' | 'stroke-3' | 'pointer' | 'crayon' | 'title' | 'box' | 'lid' | 'bubble' | 'gadget' | 'stalk' | 'arch' | 'arch-2' | 'ring' | 'ring-2' | 'patch' | 'patch-2' | 'patch-3' | 'bead' | 'bead-2' | 'structure' | 'heap';

/** Which role map each placeholder is filled with when the scene is given none: a settled map, so every fill is a fixed colour of v3/roles.json (C1, C24). The animatic gives every beat its own (`SceneProps.actorRoles`). */
const ROLES: Record<ActorName, RoleMap> = {grid: settled.kit, 'stroke-1': settled.kit, 'stroke-2': settled.kit, 'stroke-3': settled.kit, pointer: settled.kit, crayon: settled.kit, title: settled.kit, box: settled.gadget, lid: settled.gadget, bubble: settled.kit, gadget: settled.gadget, stalk: settled.kit, arch: settled.kit, 'arch-2': settled.kit, ring: settled.kit, 'ring-2': settled.kit, patch: settled.kit, 'patch-2': settled.kit, 'patch-3': settled.kit, bead: settled.kit, 'bead-2': settled.kit, structure: settled.kit, heap: settled.kit};

/** Offset of the anchor inside each prop's own SVG box, in the prop's native pixels (Box 220 x 170 from (-10, -30); Bubble 280 x 280; Gadget 200 x 260 from (-20, -20), dial at (88, 170)). */
const BOX_FOOT: [number, number] = [95, 160];
const BUBBLE_CENTRE: [number, number] = [140, 140];
const GADGET_DIAL: [number, number] = [108, 190];
/** The structure's two nested pointed arches, in native pixels at scale 1. */
const STRUCTURE = {outer: {width: 220, height: 300}, inner: {width: 130, height: 190}};
/** The closed lid's front edge stands this many px of the box's own scale above its foot (the box's coordinates: foot y 130, closed front edge y 50). */
const LID_CLOSED_ABOVE_FOOT = 80;
/** The bubble's swell: a fraction `from` of its `scale` with its centre at `fromY` (the box's mouth), growing to the whole `scale` by `toY`. */
const BUBBLE_SWELL = {from: 0.2, fromY: 372, toY: 285};
/** The pieces' own sizes at scale 1. */
const ARCH = {width: 120, height: 170};
const RING_R = 50;
const BEAD_END: [number, number] = [140, 30];
const BEAD_SAG = 24;

/** Back to front: the pieces and the structure behind, then the box with its lid, the gadget inside the bubble, the bubble over it. */
export const ACTOR_NAMES: readonly ActorName[] = ['grid', 'structure', 'stroke-1', 'stroke-2', 'stroke-3', 'stalk', 'arch', 'arch-2', 'ring', 'ring-2', 'patch', 'patch-2', 'patch-3', 'bead', 'bead-2', 'heap', 'box', 'lid', 'gadget', 'bubble', 'pointer', 'crayon', 'title'];
const isActor = (name: string): name is ActorName => (ACTOR_NAMES as readonly string[]).includes(name);

const at = (a: ActorPlacement, offset: [number, number]): {x: number; y: number; scale: number} => ({x: a.x - offset[0] * a.scale, y: a.y - offset[1] * a.scale, scale: a.scale});

/** The lid's opening in degrees from where its anchor stands above the box (loud when there is no box: a lid has nothing to open from). */
const lidAngle = (lid: ActorPlacement, box: ActorPlacement | undefined): number => {
  if (!box) throw new Error('actors: the "lid" needs a "box" to open from');
  const frontY = 50 + (lid.y - (box.y - LID_CLOSED_ABOVE_FOOT * lid.scale)) / lid.scale;
  return lidAngleAtFrontY(frontY);
};

/** The bubble's size multiplier from where its centre stands: 0.2 at the box's mouth up to 1 once it has risen. */
const bubbleSwell = (y: number): number => BUBBLE_SWELL.from + (1 - BUBBLE_SWELL.from) * Math.max(0, Math.min(1, (BUBBLE_SWELL.fromY - y) / (BUBBLE_SWELL.fromY - BUBBLE_SWELL.toY)));

const drawing = (name: ActorName, a: ActorPlacement, blocking: Blocking): React.ReactNode => {
  switch (name) {
    case 'box':
      return <Box lid={0} hinge="back" withLid={!blocking.actors?.lid} />;
    case 'lid':
      return <Lid angle={lidAngle(a, blocking.actors?.box)} />;
    case 'bubble':
      return <Bubble />;
    case 'gadget':
      return <Gadget glow={0.5} />;
    case 'stalk':
      return a.open !== undefined ? <OpeningStalk open={a.open} flip={a.facing === 'left'} /> : <StalkPiece flip={a.facing === 'left'} />;
    case 'arch':
    case 'arch-2':
      return <ArchPiece width={ARCH.width} height={ARCH.height} />;
    case 'ring':
    case 'ring-2':
      return <RingPiece r={RING_R} />;
    case 'patch':
    case 'patch-2':
    case 'patch-3':
      return <PatchPiece />;
    case 'bead':
    case 'bead-2':
      return <StringPiece end={BEAD_END} sag={BEAD_SAG} />;
    case 'heap':
      return <Heap />;
    case 'grid':
      return <GridPiece />;
    case 'stroke-1':
      return <StrokePiece index={1} />;
    case 'stroke-2':
      return <StrokePiece index={2} />;
    case 'stroke-3':
      return <StrokePiece index={3} />;
    case 'pointer':
      return <PointerPiece />;
    case 'crayon':
      return <CrayonPiece />;
    case 'title':
      return <TitlePiece />;
    case 'structure':
      return (
        <>
          <ArchPiece width={STRUCTURE.outer.width} height={STRUCTURE.outer.height} />
          <ArchPiece width={STRUCTURE.inner.width} height={STRUCTURE.inner.height} />
        </>
      );
  }
};

const placement = (name: ActorName, a: ActorPlacement): {x: number; y: number; scale: number} =>
  name === 'box' ? at(a, BOX_FOOT) : name === 'bubble' ? at({...a, scale: a.scale * bubbleSwell(a.y)}, BUBBLE_CENTRE) : name === 'gadget' ? at(a, GADGET_DIAL) : {x: a.x, y: a.y, scale: a.scale};

/** The named actors of `blocking`, back to front in `ACTOR_NAMES` order. `fill` false is the outline-only look of a reduced crossing: the fills clear, the strokes kept. */
export const ActorsLayer: React.FC<{blocking: Blocking; outline: string; fill: boolean; roles?: RoleMap; style?: (scale: number) => CSSProperties}> = ({blocking, outline, fill, roles, style}) => {
  const placed = Object.entries(blocking.actors ?? {});
  for (const [name] of placed) if (!isActor(name)) throw new Error(`actors: "${name}" has no placeholder drawing (known: ${ACTOR_NAMES.join(', ')})`);
  const clear: RoleMap = {main1: 'transparent', main2: 'transparent', shadow: 'transparent', light: 'transparent', accent: 'transparent'};
  return (
    <>
      {ACTOR_NAMES.map((name) => {
        const a = blocking.actors?.[name];
        if (!a) return null;
        const p = placement(name, a);
        return (
          <Sprite key={name} roles={fill ? (roles ?? ROLES[name]) : clear} outline={outline} x={p.x} y={p.y} scale={p.scale} style={style?.(p.scale)}>
            {drawing(name, a, blocking)}
          </Sprite>
        );
      })}
    </>
  );
};

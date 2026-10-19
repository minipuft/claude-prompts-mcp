import type {CSSProperties} from 'react';
import type {ActorPlacement, Blocking} from '../animation/blocking';
import {Box} from '../props/Box';
import {Bubble} from '../props/Bubble';
import {Gadget} from '../props/Gadget';
import {Heap} from '../props/Heap';
import {ArchPiece, StalkPiece} from '../props/Pieces';
import {Sprite} from '../Sprite';
import {settled, type RoleMap} from '../tokens';

/**
 * The actors a beat's blocking names (`blocking.actors`: box, bubble, gadget, stalk, structure, heap), drawn as the placeholders the animatic stages with: the project's hand-coded
 * props in flat role fills (settled roles, no stipple: the animatic has no shading pass), at the blocking's position and scale. None of the muse proposals is accepted, so these
 * are not the film's art; they say where each thing stands and how big it is so the staging can be judged. An actor the blocking does not name is not drawn, and an actor
 * name with no drawing here is an error, not a silent skip.
 *
 * Anchors (the blocking says "an anchor point in screen pixels and a scale"; this module fixes what the point is, per prop): the box and the stalk stand on it (the foot centre of the
 * box's front face, the stalk's root), the structure stands on it (the centre of its base), the heap lies on it (the bottom centre of the mound), the bubble is centred on it, and the gadget hangs from its dial (the chart's gadget path is the
 * dial's position, and the blocking's emitter anchor 'gadget dial' sits on the same point).
 */
export type ActorName = 'box' | 'bubble' | 'gadget' | 'stalk' | 'structure' | 'heap';

/** Which role map each placeholder is filled with when the scene is given none: a settled map, so every fill is a fixed colour of v3/roles.json (C1, C24). The animatic gives every beat its own (`SceneProps.actorRoles`). */
const ROLES: Record<ActorName, RoleMap> = {box: settled.gadget, bubble: settled.kit, gadget: settled.gadget, stalk: settled.kit, structure: settled.kit, heap: settled.kit};

/** Offset of the anchor inside each prop's own SVG box, in the prop's native pixels (Box 220 x 170 from (-10, -30); Bubble 280 x 280; Gadget 200 x 260 from (-20, -20), dial at (88, 170)). */
const BOX_FOOT: [number, number] = [95, 160];
const BUBBLE_CENTRE: [number, number] = [140, 140];
const GADGET_DIAL: [number, number] = [108, 190];
/** The structure's two nested pointed arches, in native pixels at scale 1. */
const STRUCTURE = {outer: {width: 220, height: 300}, inner: {width: 130, height: 190}};
/** The lid of the placeholder box is drawn part open: the arrival beat is the one where it lifts. */
const BOX_LID = 0.7;

export const ACTOR_NAMES: readonly ActorName[] = ['structure', 'stalk', 'heap', 'box', 'bubble', 'gadget'];
const isActor = (name: string): name is ActorName => (ACTOR_NAMES as readonly string[]).includes(name);

const at = (a: ActorPlacement, offset: [number, number]): {x: number; y: number; scale: number} => ({x: a.x - offset[0] * a.scale, y: a.y - offset[1] * a.scale, scale: a.scale});

const drawing = (name: ActorName, a: ActorPlacement): React.ReactNode => {
  switch (name) {
    case 'box':
      return <Box lid={BOX_LID} hinge="back" />;
    case 'bubble':
      return <Bubble />;
    case 'gadget':
      return <Gadget glow={0.5} />;
    case 'stalk':
      return <StalkPiece flip={a.facing === 'left'} />;
    case 'heap':
      return <Heap />;
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
  name === 'box' ? at(a, BOX_FOOT) : name === 'bubble' ? at(a, BUBBLE_CENTRE) : name === 'gadget' ? at(a, GADGET_DIAL) : {x: a.x, y: a.y, scale: a.scale};

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
            {drawing(name, a)}
          </Sprite>
        );
      })}
    </>
  );
};

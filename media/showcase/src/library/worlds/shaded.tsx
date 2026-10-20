import {useLayoutEffect, useMemo} from 'react';
import {ThreeCanvas} from '@remotion/three';
import {BoxGeometry, Color, DataTexture, DoubleSide, EdgesGeometry, ExtrudeGeometry, NearestFilter, Path, RedFormat, Shape, ShapeGeometry, Vector2, type BufferGeometry} from 'three';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';
import type {Blocking} from '../animation/blocking';
import {maskToCanvas, useFigureGeometry, useFigureTexture} from '../cast/MeshFigure';
import {restPose} from '../cast/humanPose';
import type {Joints} from '../motion';
import {frameRings, type Pt} from '../props/Frame';
import {settled} from '../tokens';
import {STAGE, archOutline, clamp01, contourPx, lineColour, partsOf} from './contract';
import {contracts} from './contracts';
import {FigureLines, JoinGlow, PropsStack, Stage, reducedLine, useBloomLines, type Bloom, type FigureLight, type PropsLook} from './parts';
import type {PropsPart, SceneProps, WorldContract} from './types';

/**
 * The shaded world (programming world, D78): the human through a stepped-light fragment program with an emissive silhouette edge, in a
 * perspective camera; the architecture and the two kit blocks as real extrusions lit by a MeshToonMaterial (N steps from the contract) with
 * emissive fat-line edges. Companions stay the flat sprites of home: identity pigments are not touched (C1). The camera looks straight on
 * and each object turns about its own vertical axis (the figure to one side, the architecture to the other), so the three-quarter reading
 * is the objects' and the plane z = 0 still maps 1 px to 1 px. At `reduce` 1 every turn and every depth is 0: the drawing is the line world's.
 */
const W = 1280;
const H = 720;
const CAMERA_Z = 1400;
/** Canvas margin above and below the frame: the raised hands and the boots leave 720 px, and a clipped contour reads as separate pieces. */
const PAD = 240;
const HT = H + 2 * PAD;
const FOV = (2 * Math.atan(HT / 2 / CAMERA_Z) * 180) / Math.PI;
const TURN = {figure: 0.42, frame: -0.3, blocks: 0.22, arch: 0, gates: 0.22};
const DEPTH = {frame: 44, block: 44, arch: 70};
/** The gates stand this far in front of the arch's plane (so the arch never hides them); the camera magnifies that depth, so their stage pixels are lifted back (see `lift`). */
const GATE_Z = 60;
const GATE_K = CAMERA_Z / (CAMERA_Z - GATE_Z);
/** A stage pixel on the plane z = GATE_Z that lands on the same screen pixel as on z = 0: the camera sits at (W/2, H/2) looking straight on. */
const lift = ([x, y]: [number, number]): [number, number] => [W / 2 + (x - W / 2) / GATE_K, -(H / 2 + (y - H / 2) / GATE_K)];
/** The grid floor: the plane y = the blocking's floor.y, from z = FLOOR_Z.far (behind the stage) to z = FLOOR_Z.near (under the camera's bottom edge). */
const FLOOR_Z = {far: -1100, near: 950, step: 150, half: 2400, spacing: 160};
/** Brightness of the three gate rings: the ring the human made last (nearest the figure, the third) is the brightest. */
const GATE_LIGHT = [0.38, 0.62, 1];
/** How far (stage px) the light reaches on a gate before it falls to nothing: a little over half the gap between two gates (85-90), so only the ring the light is at, or nearly at, is lit. */
const GATE_REACH = 60;
/** Share of its resting brightness a gate keeps when the light is not at it. */
const GATE_DIM = 0.25;
/**
 * The ring's brightness. With no light given (the world sheet, a stand-alone scene) it is the resting `GATE_LIGHT`. With the beat's emitter given, a gate is at its resting brightness only
 * where the light is: `GATE_DIM` of it with the emitter a reach or more away, rising to all of it under the emitter. The light the human made last is the brightest only when it is the one lit;
 * otherwise the third ring (resting brightness 1, white-hot with its bloom) outshines the light that is walking toward it, and the eye (C29) goes to the ring and not to the emitter.
 */
const gateLight = (i: number, gateX: number, emitterX: number | undefined): number => {
  const rest = GATE_LIGHT[i] ?? 1;
  if (emitterX === undefined) return rest;
  const near = Math.max(0, 1 - Math.abs(emitterX - gateX) / GATE_REACH);
  return rest * (GATE_DIM + (1 - GATE_DIM) * near);
};

const toonGradient = (steps: number): DataTexture => {
  const data = Uint8Array.from({length: steps}, (_, i) => Math.round(255 * (0.3 + (0.7 * i) / Math.max(1, steps - 1))));
  const t = new DataTexture(data, steps, 1, RedFormat);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
};

/** Edges of `geometry` as screen-space fat lines of `width` px in `colour`, with the contract's bloom lines behind them. */
const useEdges = (geometry: BufferGeometry, colour: string, width: number, bloom?: Bloom, glowOrder = -1): {lines: LineSegments2; glow: LineSegments2[]} => {
  const lines = useMemo(
    () => new LineSegments2(new LineSegmentsGeometry().fromEdgesGeometry(new EdgesGeometry(geometry, 25)), new LineMaterial({toneMapped: false, resolution: new Vector2(W, H)})),
    [geometry],
  );
  // the colour and width change every crossing frame: write them into the one material instead of rebuilding it
  useLayoutEffect(() => {
    lines.material.color.set(colour);
    lines.material.linewidth = width;
  });
  const glow = useBloomLines(lines, colour, width, bloom, glowOrder);
  return {lines, glow};
};

const ringShape = (outer: Pt[], inner: Pt[]): Shape => {
  const s = new Shape(outer.map(([x, y]) => new Vector2(x, -y)));
  s.holes.push(new Path(inner.map(([x, y]) => new Vector2(x, -y))));
  return s;
};

type SolidProps = {geometry: BufferGeometry; fillColour: string; fill: number; edge: string; lw: number; gradient: DataTexture; bloom?: Bloom; emissive?: boolean; glowOrder?: number};
/** One extruded solid: toon-lit faces at `fill` opacity, emissive edges that stay (with their bloom). */
const Solid: React.FC<SolidProps> = ({geometry, fillColour, fill, edge, lw, gradient, bloom, emissive, glowOrder}) => {
  const {lines, glow} = useEdges(geometry, edge, lw, bloom, glowOrder);
  return (
    <>
      {glow.map((g, i) => (
        <primitive key={i} object={g} />
      ))}
      {fill > 0 && (
        <mesh geometry={geometry} frustumCulled={false}>
          {emissive ? (
            <meshBasicMaterial color={fillColour} transparent opacity={fill} toneMapped={false} side={DoubleSide} />
          ) : (
            <meshToonMaterial color={fillColour} gradientMap={gradient} transparent opacity={fill} toneMapped={false} />
          )}
        </mesh>
      )}
      <primitive object={lines} />
    </>
  );
};

/** The grid floor: fat lines on the plane y = the blocking's floor.y, a receding grid in the edge colour, nearer rows brighter. Two bands share one geometry builder. */
const gridSegments = (zFrom: number, zTo: number, floorY: number): Float32Array => {
  const y = -floorY;
  const out: number[] = [];
  const xs = Array.from({length: Math.floor((2 * FLOOR_Z.half) / FLOOR_Z.spacing)}, (_, i) => 640 - FLOOR_Z.half + (i + 0.5) * FLOOR_Z.spacing);
  for (const x of xs) out.push(x, y, zFrom, x, y, zTo);
  for (let z = Math.ceil(zFrom / FLOOR_Z.step) * FLOOR_Z.step; z <= zTo; z += FLOOR_Z.step) out.push(640 - FLOOR_Z.half, y, z, 640 + FLOOR_Z.half, y, z);
  return Float32Array.from(out);
};

const FloorBand: React.FC<{zFrom: number; zTo: number; floorY: number; colour: string; width: number; opacity: number}> = ({zFrom, zTo, floorY, colour, width, opacity}) => {
  const lines = useMemo(() => {
    const l = new LineSegments2(new LineSegmentsGeometry().setPositions(gridSegments(zFrom, zTo, floorY)), new LineMaterial({toneMapped: false, transparent: true, depthTest: false, depthWrite: false, resolution: new Vector2(W, H)}));
    l.frustumCulled = false;
    l.renderOrder = -2;
    return l;
  }, [zFrom, zTo, floorY]);
  useLayoutEffect(() => {
    lines.material.color.set(colour);
    lines.material.linewidth = width;
    lines.material.opacity = opacity;
  });
  return <primitive object={lines} />;
};

const Floor: React.FC<{strength: number; floorY: number; colour: string; lw: number}> = ({strength, floorY, colour, lw}) =>
  strength > 0 ? (
    <>
      <FloorBand zFrom={FLOOR_Z.far} zTo={-450} floorY={floorY} colour={colour} width={Math.max(1, lw * 0.4)} opacity={0.3 * strength} />
      <FloorBand zFrom={-450} zTo={FLOOR_Z.near} floorY={floorY} colour={colour} width={Math.max(1, lw * 0.5)} opacity={0.7 * strength} />
    </>
  ) : null;

/** A ring (the gate) as a flat annulus in stage pixels around its own centre: one face, so its edges are two loops and the bloom does not stack. */
const gateGeometry = (r: number): BufferGeometry => {
  const outer = new Shape().absarc(0, 0, r, 0, Math.PI * 2, false);
  outer.holes.push(new Path().absarc(0, 0, r * 0.72, 0, Math.PI * 2, true));
  return new ShapeGeometry(outer, 40);
};

/** The arch as one extruded polygon, in the box-corner coordinates the frame uses (x right, y down from the box's top left, drawn up-flipped). */
const archGeometry = (arch: Blocking['arch']): BufferGeometry => {
  const {x, y} = arch;
  const s = new Shape(archOutline(arch).map(([px, py]) => new Vector2(px - x, -(py - y))));
  const g = new ExtrudeGeometry(s, {depth: DEPTH.arch, bevelEnabled: false});
  g.translate(0, 0, -DEPTH.arch); // the front face stays on the plane z = 0, so it lands on the arch's pixels; the solid recedes behind it
  return g;
};

const mix = (a: string, b: string, t: number): string => `#${new Color(a).lerp(new Color(b), t).getHexString()}`;

/** One gate: a lit ring whose brightness is `light` (0..1), mirrored below the floor at low opacity. At `reduce` 1 only its contour stays, in the line colour. */
const Gate: React.FC<{g: Blocking['gates'][number]; light: number; fill: number; reduce: number; edge: string; lineHex: string; lw: number; gradient: DataTexture; bloom?: Bloom}> = ({g, light, fill, reduce, edge, lineHex, lw, gradient, bloom}) => {
  const geometry = useMemo(() => gateGeometry(g.r), [g.r]);
  const bright = mix(edge, '#c8f6ff', 0.45 * light);
  const face = mix('#06141f', mix(edge, '#8fdcf2', 0.3 * light), 0.12 + 0.55 * light);
  const at = reduce > 0 ? mix(bright, lineHex, reduce) : bright;
  const base = g.y + g.r;
  const soft = bloom ? {...bloom, strength: bloom.strength * 0.3 * light * light} : undefined;
  return (
    <>
      <group position={[...lift([g.x, g.y]), GATE_Z]} scale={1 / GATE_K} rotation={[0, TURN.gates * (1 - reduce), 0]}>
        <Solid geometry={geometry} fillColour={face} fill={fill} edge={at} lw={lw} gradient={gradient} bloom={soft} emissive glowOrder={4} />
      </group>
      {fill > 0.05 && (
        <group position={[...lift([g.x, 2 * base - g.y]), GATE_Z]} scale={[1 / GATE_K, -1 / GATE_K, 1 / GATE_K]} rotation={[0, TURN.gates * (1 - reduce), 0]}>
          <mesh geometry={geometry} frustumCulled={false}>
            <meshBasicMaterial color={bright} transparent opacity={0.16 * light * fill} toneMapped={false} depthWrite={false} side={DoubleSide} />
          </mesh>
        </group>
      )}
    </>
  );
};
const ShadedFigure: React.FC<{pose: Joints; fill: number; line: ReturnType<typeof reducedLine>; steps: number; turn: number; bloom?: Bloom; light?: FigureLight; figure: Blocking['figure']}> = ({pose, fill, line, steps, turn, bloom, light, figure}) => {
  const texture = useFigureTexture(figure.swoop);
  const geometry = useFigureGeometry(pose, figure.swoop);
  const pivotX = maskToCanvas(restPose.torso!)[0];
  const {scale, x, y} = figure;
  return (
    <group position={[x, -y, 0]} scale={scale}>
      <group position={[pivotX, 0, 0]} rotation={[0, turn, 0]}>
        <group position={[-pivotX, 0, 0]}>
          <FigureLines parts={{geometry, texture}} line={line} fill={fill} steps={steps} resolution={[W, H]} bloom={bloom} light={light} />
        </group>
      </group>
    </group>
  );
};

const Architecture: React.FC<{fill: number; reduce: number; edge: string; lineHex: string; lw: number; gradient: DataTexture; bloom?: Bloom; parts: PropsPart[]; blocking: Blocking; lightX?: number}> = ({lightX, fill, reduce, edge, lineHex, lw, gradient, bloom, parts, blocking}) => {
  const {x, y, width: w, height: h} = blocking.frame ?? {x: 0, y: 0, width: 0, height: 0};
  const ring = useMemo(() => {
    if (!blocking.frame) return null;
    const r = frameRings(w, h);
    const g = new ExtrudeGeometry(ringShape(r.outer, r.inner), {depth: DEPTH.frame, bevelEnabled: false});
    g.translate(0, 0, -DEPTH.frame / 2);
    return g;
  }, [w, h]);
  const blocks = useMemo(
    () =>
      blocking.blocks.map((b) => {
        const g = new BoxGeometry(b.width, b.height, DEPTH.block);
        return {b, g};
      }),
    [blocking.blocks.map((b) => `${b.x},${b.y},${b.width},${b.height},${b.role}`).join('|')],
  );
  const a = blocking.arch;
  const arch = useMemo(() => archGeometry(a), [a.x, a.y, a.width, a.height, a.opening, a.top]);
  const flat = Math.max(0.001, 1 - reduce);
  return (
    <>
      {parts.includes('architecture') && ring && (
        <group position={[x + w / 2, -(y + h / 2), 0]} rotation={[0, TURN.frame * (1 - reduce), 0]} scale={[1, 1, flat]}>
          <group position={[-w / 2, h / 2, 0]}>
            <Solid geometry={ring} fillColour={settled.gadget.main1} fill={fill} edge={edge} lw={lw} gradient={gradient} bloom={bloom} />
          </group>
        </group>
      )}
      {parts.includes('blocks') &&
        blocks.map(({b, g}, i) => (
          <group key={i} position={[b.x + b.width / 2, -(b.y + b.height / 2), 0]} rotation={[0, TURN.blocks * (1 - reduce), 0]} scale={[1, 1, flat]}>
            <Solid geometry={g} fillColour={settled.kit[b.role]} fill={fill} edge={edge} lw={lw} gradient={gradient} bloom={bloom} />
          </group>
        ))}
      {parts.includes('arch') && (
        <group position={[a.x + a.width / 2, -(a.y + a.height / 2), 0]} rotation={[0, TURN.arch * (1 - reduce), 0]} scale={[1, 1, flat]}>
          <group position={[-a.width / 2, a.height / 2, 0]}>
            <Solid geometry={arch} fillColour={settled.kit.main1} fill={fill} edge={edge} lw={lw} gradient={gradient} bloom={bloom} />
          </group>
        </group>
      )}
      {parts.includes('gates') &&
        blocking.gates.map((g, i) => <Gate key={i} g={g} light={gateLight(i, g.x, lightX)} fill={fill} reduce={reduce} edge={edge} lineHex={lineHex} lw={lw} gradient={gradient} bloom={bloom} />)}
    </>
  );
};

const Lights: React.FC = () => (
  <directionalLight position={[-500, 700, 900]} intensity={Math.PI} />
);

const bloomOf = (c: WorldContract, strength: number): Bloom | undefined => (c.shading?.bloom ? {...c.shading.bloom, strength} : undefined);

export const ShadedScene: React.FC<SceneProps> = ({frame, pose, emitter, reduce = 0, shift, field, parts: override, blocking = STAGE}) => {
  const c = contracts.shaded;
  const r = clamp01(reduce);
  const parts = partsOf('shaded', override);
  const steps = c.shading?.steps ?? 2;
  const gradient = useMemo(() => toonGradient(Math.max(2, steps)), [steps]);
  const line = reducedLine(c, contracts.line, r, blocking);
  const lw = contourPx(c, blocking);
  const native: PropsLook = {fill: true, ink: settled.outline, lw: null, shading: true};
  const edge = c.shading?.emissiveEdges === false ? lineColour(contracts.line) : line.colour;
  const bloom = bloomOf(c, 1 - r);
  const light: FigureLight = {lightDir: c.shading?.lightDir, shadowFloor: c.shading?.shadowFloor, stepAt: c.shading?.stepAt};
  return (
    <Stage field={field ?? c.field} shift={shift}>
      <JoinGlow contract={c} emitter={emitter} opacity={1 - r} blocking={blocking} />
      <ThreeCanvas width={W} height={HT} style={{position: 'absolute', left: 0, top: -PAD}} camera={{fov: FOV, near: 10, far: 6000, position: [W / 2, -H / 2, CAMERA_Z], rotation: [0, 0, 0]}}>
        <Lights />
        {parts.includes('floor') && <Floor strength={1 - r} floorY={blocking.floor.y} colour={edge} lw={lw} />}
        <ShadedFigure pose={pose} fill={1 - r} line={line} steps={steps} turn={TURN.figure * (1 - r)} bloom={bloom} light={light} figure={blocking.figure} />
        <Architecture fill={1 - r} reduce={r} edge={edge} lineHex={lineColour(contracts.line)} lw={lw} gradient={gradient} bloom={bloom} parts={parts} blocking={blocking} lightX={emitter?.x} />
      </ThreeCanvas>
      {/* the beat's actors are filled with the kit's own roles (the settled palette), not the beat's dark pair: the radiance of the shaded world's hue is #17263a, and props in it stand black on black */}
      <PropsStack contract={c} lineWorld={contracts.line} reduce={r} native={native} frame={frame} parts={parts.includes('actors') ? ['companions', 'actors'] : ['companions']} blocking={blocking} />
    </Stage>
  );
};

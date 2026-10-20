import {useLayoutEffect, useMemo, type ReactNode} from 'react';
import {AbsoluteFill, interpolateColors} from 'remotion';
import {AdditiveBlending, DoubleSide} from 'three';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {Clawd} from '../cast/Clawd';
import {Codex} from '../cast/Codex';
import {PAD_SIDE, PAD_TOP, canvasH, canvasW, MeshFigure, type FigureParts} from '../cast/MeshFigure';
import type {Blocking} from '../animation/blocking';
import type {PartName} from '../motion/partsRig';
import {boil, onTwos, type Joints} from '../motion';
import {Frame} from '../props/Frame';
import {ActorsLayer} from './actors';
import {Radiance, type Emitter} from '../Radiance';
import {Sprite} from '../Sprite';
import {identity, settled, type RoleMap} from '../tokens';
import {STAGE, archOutline, clamp01, contourPx, joinEmitter, lineColour} from './contract';
import {makeFigureMaterial, setFigureState} from './figureShader';
import {makeOutline, type SolvedListeners} from './outline';
import type {PropsPart, WorldContract} from './types';

/** Field, then the drawing; `shift` translates the drawing (not the field) along a crossing's leading line. */
export const Stage: React.FC<{field: string; shift?: [number, number]; children: ReactNode}> = ({field, shift = [0, 0], children}) => (
  <AbsoluteFill style={{background: field}}>
    <div style={{position: 'absolute', inset: 0, transform: shift[0] || shift[1] ? `translate(${shift[0]}px, ${shift[1]}px)` : undefined}}>{children}</div>
  </AbsoluteFill>
);

/**
 * The join's light, under everything else, confined to a rectangle around its own emitter so it never reaches the figure. The emitter is the
 * caller's (the animatic reads it from the beat's blocking emitter path, start to end across the beat) or, when none is given, the touch point;
 * the mask is centred on whichever it is, so a light that moves with the blocking is never clipped away from where it sits.
 */
const glowMask = (light: Emitter) => ({x: light.x - 0.6 * light.radius, y: light.y - 0.5 * light.radius, width: 1.2 * light.radius, height: light.radius}); // 200 x 160 at the radius of 170 the contracts use
export const JoinGlow: React.FC<{contract: WorldContract; emitter?: Emitter; opacity?: number; blocking?: Blocking}> = ({contract, emitter, opacity = 1, blocking = STAGE}) => {
  if (!contract.radiance.on || opacity <= 0) return null;
  const light = joinEmitter(contract, emitter, blocking);
  return (
    <div style={{position: 'absolute', inset: 0, opacity}}>
      <Radiance emitter={light} motes={24} grain={light.grain ?? 0.05} mask={glowMask(light)} seed={4} />
    </div>
  );
};

/** How the drawn props are inked and filled. `ink: null` leaves their strokes transparent; `lw` overrides every stroke to that many screen pixels. */
export type PropsLook = {fill: boolean; ink: string | null; lw: number | null; shading: boolean};
export type {PropsPart};

const clear: RoleMap = {main1: 'transparent', main2: 'transparent', shadow: 'transparent', light: 'transparent', accent: 'transparent'};

const KitBlock: React.FC<{width: number; height: number}> = ({width, height}) => (
  <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{overflow: 'visible'}}>
    <g stroke="var(--outline)" strokeWidth="4" strokeLinejoin="round">
      <rect x="0" y="0" width={width} height={height} fill="var(--fill)" />
    </g>
  </svg>
);

/** CSS that turns the drawn props into the look: no stipple, strokes at the contract's width, inner shapes outlined when their fills are gone. */
const lookCss = `
.wl-flat [filter] { display: none; }
.wl-lw svg g, .wl-lw svg path, .wl-lw svg rect, .wl-lw svg polygon { stroke-width: var(--lw); }
.wl-outline [stroke="none"]:not([filter]) { stroke: var(--outline); }
`;

/** Boil for the companions: one fixed contour variant per slot of the contract's rate. */
const variantOf = (frame: number, c: WorldContract, seed: number): number => boil(onTwos(frame), c.boil.variants, seed, 30, c.boil.rate);

const pathOf = (pts: [number, number][]): string => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') + 'Z';

/** x at the horizon of each receding floor line; the lines converge on the vanishing point (640, 360), the eye level the shaded camera shares. */
const FLOOR_RAYS = [160, 300, 420, 520, 640, 760, 860, 980, 1120];
const VANISH = {x: 640, y: 360};
const FLOOR_ROWS = [545, 625, 710];

/** The arch, the three gates and the floor as strokes: the line world's language, in the caller's ink at the caller's width. */
export const StageStrokes: React.FC<{parts: PropsPart[]; ink: string; width: number; blocking?: Blocking}> = ({parts, ink, width, blocking = STAGE}) => {
  const bottom = 720, horizon = blocking.floor.y;
  return (
    <svg width={1280} height={720} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible', '--lw': `${width}px`} as React.CSSProperties} fill="none" stroke={ink} strokeWidth={width} strokeLinejoin="round" strokeLinecap="round">
      {parts.includes('floor') && (
        <g>
          <line x1={0} y1={horizon} x2={1280} y2={horizon} />
          {FLOOR_RAYS.map((x0) => (
            <line key={x0} x1={x0} y1={horizon} x2={VANISH.x + ((x0 - VANISH.x) * (bottom - VANISH.y)) / (horizon - VANISH.y)} y2={bottom} />
          ))}
          {FLOOR_ROWS.map((y) => (
            <line key={y} x1={0} y1={y} x2={1280} y2={y} />
          ))}
        </g>
      )}
      {parts.includes('arch') && <path d={pathOf(archOutline(blocking.arch))} />}
      {parts.includes('gates') &&
        blocking.gates.map((g, i) => (
          <g key={i}>
            <circle cx={g.x} cy={g.y} r={g.r} />
            <circle cx={g.x} cy={g.y} r={g.r * 0.72} />
          </g>
        ))}
    </svg>
  );
};

/** Codex and Clawd (identity pigments, C1), the frame (architecture) and the two kit blocks (the join), drawn flat as SVG. */
export const PropsLayer: React.FC<{look: PropsLook; frame: number; contract: WorldContract; parts?: PropsPart[]; opacity?: number; blocking?: Blocking; actorRoles?: RoleMap}> = ({look, frame, contract, parts = ['companions', 'architecture', 'blocks'], opacity = 1, blocking = STAGE, actorRoles}) => {
  if (opacity <= 0) return null;
  const outline = look.ink ?? 'transparent';
  const lwFor = (scale: number) => (look.lw === null ? {} : {'--lw': `${look.lw / scale}px`} as React.CSSProperties);
  const cls = [look.shading ? '' : 'wl-flat', look.lw === null ? '' : 'wl-lw', look.fill ? '' : 'wl-outline'].join(' ');
  const gadget = look.fill ? settled.gadget : clear;
  const kit = look.fill ? settled.kit : clear;
  // a held wince is one boil variant: inside `codex.hold` Codex is drawn as the frame the hold starts on
  const hold = blocking.codex.hold;
  const codexFrame = hold && frame >= hold.from && frame < hold.to ? hold.from : frame;
  return (
    <div className={cls} style={{position: 'absolute', inset: 0, opacity}}>
      <style>{lookCss}</style>
      {(parts.includes('arch') || parts.includes('gates') || parts.includes('floor')) && <StageStrokes parts={parts} ink={outline} width={look.lw ?? 4} blocking={blocking} />}
      {parts.includes('architecture') && blocking.frame && (
        <Sprite roles={gadget} outline={outline} x={blocking.frame.x} y={blocking.frame.y} style={lwFor(1)}>
          <Frame width={blocking.frame.width} height={blocking.frame.height} />
        </Sprite>
      )}
      {parts.includes('blocks') &&
        blocking.blocks.map((b, i) => (
          <Sprite key={i} roles={kit} outline={outline} x={b.x} y={b.y} style={{...lwFor(1), '--fill': kit[b.role]} as React.CSSProperties}>
            <KitBlock width={b.width} height={b.height} />
          </Sprite>
        ))}
      {parts.includes('actors') && (
        <div className="wl-flat" style={{position: 'absolute', inset: 0}}>
          <ActorsLayer blocking={blocking} outline={outline} fill={look.fill} roles={actorRoles} style={lwFor} />
        </div>
      )}
      {parts.includes('companions') && (
        <>
          <Sprite roles={look.fill ? identity.codex : clear} outline={outline} x={blocking.codex.x} y={blocking.codex.y} scale={blocking.codex.scale} style={lwFor(blocking.codex.scale)}>
            <Codex variant={variantOf(codexFrame, contract, 1)} look={variantOf(codexFrame, contract, 5) % 2} />
          </Sprite>
          <Sprite roles={look.fill ? identity.clawd : clear} outline={outline} x={blocking.clawd.x} y={blocking.clawd.y} scale={blocking.clawd.scale} style={lwFor(blocking.clawd.scale)}>
            <Clawd raise={blocking.clawd.raise ?? 0.2} variant={variantOf(frame, contract, 2)} />
          </Sprite>
        </>
      )}
    </div>
  );
};

/** The contour state the line and shaded figure draws: colour, strength, and its width in screen pixels (the shader reads it in texture pixels). */
export type LineSpec = {colour: string; widthPx: number; alpha: number; screenPx: number; interior: number};

/** Bloom without a dependency: the emissive line drawn again behind itself at `widths` x its width and `opacities`, additively (shading.bloom). */
export type Bloom = {widths: number[]; opacities: number[]; strength: number};

/** Extra fat lines that share `lines`' geometry (so a geometry the solver rewrites in place glows too); materials follow `colour`, `width` and `bloom` each render. */
export const useBloomLines = (lines: LineSegments2, colour: string, width: number, bloom: Bloom | undefined, renderOrder: number): LineSegments2[] => {
  const count = bloom ? Math.min(bloom.widths.length, bloom.opacities.length) : 0;
  const glow = useMemo(
    () =>
      Array.from({length: count}, () => {
        const m = new LineMaterial({toneMapped: false, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, resolution: lines.material.resolution});
        const g = new LineSegments2(lines.geometry, m);
        g.frustumCulled = false;
        return g;
      }),
    [lines, count],
  );
  useLayoutEffect(() => {
    glow.forEach((g, i) => {
      g.renderOrder = renderOrder;
      g.visible = !!bloom && bloom.strength > 0;
      g.material.color.set(colour);
      g.material.linewidth = width * (bloom?.widths[i] ?? 1);
      g.material.opacity = (bloom?.opacities[i] ?? 0) * (bloom?.strength ?? 0);
    });
  });
  return glow;
};

/** The shading's light and step settings (contract), as the figure shader state wants them. */
export type FigureLight = {lightDir?: [number, number, number]; shadowFloor?: number; stepAt?: number};

/**
 * The figure's contour, in two parts that share the colour: the silhouette as fat lines along the mesh boundary (connected by construction,
 * outline.ts) and the edges between colour regions found by the fragment program. `fill` and `steps` drive the same program's fill.
 */
const FigureLines: React.FC<{parts: FigureParts; line: LineSpec; fill: number; steps: number; resolution: [number, number]; bloom?: Bloom; light?: FigureLight}> = ({parts: {geometry, texture}, line, fill, steps, resolution, bloom, light}) => {
  const material = useMemo(() => makeFigureMaterial(texture), [texture]);
  const {lines: outline, update} = useMemo(() => makeOutline(geometry, resolution), [geometry, resolution[0], resolution[1]]);
  useLayoutEffect(() => {
    const listeners = ((geometry.userData.onSolved as SolvedListeners | undefined) ??= new Set());
    listeners.add(update);
    update();
    return () => void listeners.delete(update);
  }, [geometry, update]);
  useLayoutEffect(() => {
    setFigureState(material, {widthTex: line.widthPx, lineColour: line.colour, lineAlpha: line.alpha * line.interior, fillAlpha: fill, steps, ...light});
    outline.material.color.set(line.colour);
    outline.material.linewidth = line.screenPx;
    outline.material.opacity = line.alpha;
  });
  const glow = useBloomLines(outline, line.colour, line.screenPx, bloom, 0.5);
  return (
    <>
      {glow.map((g, i) => (
        <primitive key={i} object={g} />
      ))}
      <mesh geometry={geometry} frustumCulled={false} renderOrder={1}>
        <primitive object={material} attach="material" />
      </mesh>
      <primitive object={outline} />
    </>
  );
};

/** Screen-pixel contour -> pixels of the figure's texture (the mesh carries mask pixels to the screen at registration.scale x scale, 0.727 here). */
export const textureWidth = (contractPx: number, figureScale: number): number => contractPx / (1.069414 * figureScale);

/**
 * The human through the shared ortho canvas. `fill` 1 with no `line` is MeshFigure untouched (home at rest is today's look, byte for byte);
 * any other state draws the texture at `fill` opacity under a contour pass read off the same texture. `order` (front first) draws the fill-1, no-line figure as the parts rig
 * (PartsFigure.tsx) in that order; the contour passes read one mesh's boundary and keep drawing the single mesh.
 */
const orthoResolution = (scale: number): [number, number] => [Math.round((canvasW + 2 * PAD_SIDE) * scale), Math.round((canvasH + PAD_TOP) * scale)];

export const FlatFigure: React.FC<{pose: Joints; fill: number; line: LineSpec | null; blocking?: Blocking; order?: readonly PartName[]}> = ({pose, fill, line, blocking = STAGE, order}) => {
  const {order: placedOrder, at: _travel, ...place} = blocking.figure;
  if (fill >= 1 && !line) return <MeshFigure pose={pose} order={order ?? (placedOrder as readonly PartName[] | undefined)} {...place} />;
  return (
    <MeshFigure
      pose={pose}
      {...place}
      mesh={(parts) => (
        <>
          {fill > 0 && (
            <mesh geometry={parts.geometry} frustumCulled={false}>
              <meshBasicMaterial map={parts.texture} transparent opacity={fill} alphaTest={0.05} side={DoubleSide} toneMapped={false} depthWrite={false} />
            </mesh>
          )}
          {line && <FigureLines parts={parts} line={line} fill={0} steps={0} resolution={orthoResolution(blocking.figure.scale)} />}
        </>
      )}
    />
  );
};

/** Inner contours: the world's own setting at rest, easing to the line world's as the crossing reduces. */
const interiorAt = (c: WorldContract, lineWorld: WorldContract, reduce: number): number => {
  const own = c.line.interior ? 1 : 0, target = lineWorld.line.interior ? 1 : 0;
  return own + (target - own) * clamp01(reduce);
};

/** The contour state at `reduce` for a world: its own line colour easing to the line world's, at the contract's width. */
export const reducedLine = (c: WorldContract, lineWorld: WorldContract, reduce: number, blocking: Blocking = STAGE): LineSpec => ({
  colour: reduce > 0 ? interpolateColors(clamp01(reduce), [0, 1], [lineColour(c), lineColour(lineWorld)]) : lineColour(c),
  widthPx: textureWidth(contourPx(c, blocking), blocking.figure.scale),
  screenPx: contourPx(c, blocking),
  alpha: 1,
  interior: interiorAt(c, lineWorld, reduce),
});

/**
 * The props through a crossing: at rest the world's own look; with `reduce` the fills fade out (opacity) while the strokes are redrawn at the
 * contract's contour width in the line colour and stay, so the lines are never cross-dissolved with a second render of the same props.
 */
export const PropsStack: React.FC<{contract: WorldContract; lineWorld: WorldContract; reduce: number; native: PropsLook; frame: number; parts?: PropsPart[]; blocking?: Blocking; actorRoles?: RoleMap}> = ({contract, lineWorld, reduce, native, frame, parts, blocking = STAGE, actorRoles}) => {
  const r = clamp01(reduce);
  if (r === 0) return <PropsLayer look={native} frame={frame} contract={contract} parts={parts} blocking={blocking} actorRoles={actorRoles} />;
  return (
    <>
      <PropsLayer look={{...native, ink: null, lw: null}} frame={frame} contract={contract} parts={parts} opacity={1 - r} blocking={blocking} actorRoles={actorRoles} />
      <PropsLayer look={{fill: false, ink: reducedLine(contract, lineWorld, r, blocking).colour, lw: contourPx(contract, blocking), shading: false}} frame={frame} contract={contract} parts={parts} blocking={blocking} />
    </>
  );
};

export {FigureLines};

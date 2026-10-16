import {useLayoutEffect} from 'react';
import {AbsoluteFill, continueRender, delayRender, Img, staticFile, useCurrentFrame} from 'remotion';
import {fonts} from '../design';
import {CameraView, type CameraPose} from '../library/animation/camera';
import {Clawd} from '../library/cast/Clawd';
import {Codex} from '../library/cast/Codex';
import {MeshFigure} from '../library/cast/MeshFigure';
import {Box} from '../library/props/Box';
import {Bubble} from '../library/props/Bubble';
import {Gadget} from '../library/props/Gadget';
import {ArchPiece, BlockPiece, FramePiece, RingPiece, StalkPiece, StringPiece} from '../library/props/Pieces';
import {Sprite} from '../library/Sprite';
import {identity, roleVars, s01Turrell, settled} from '../library/tokens';
import {FlatFigure} from '../library/worlds/parts';
import {PIECE_SIZE, SIZE, chart, layout, stagedBlocking, stateAt, toScreen, type PieceDraw} from './shotS01Plan';
import {STALK0_SCALE, projectState, type BehindP, type CoreP, type FigureP, type FrontP, type GrainP, type Pass, type PassProjection, type BackP, type UnderP} from './shotS01Passes';

/**
 * Shot s01, the film's intro (D53, D64, D74): beats arrival (0-180) and everything-at-once (180-420) in the home world, one camera move (the widen, 150-210)
 * led by the bubble and the first stalk's curl, one emitter at a time (the box seam, then the gadget's dial), Turrell blue flooding the field in beat 2.
 * Everything is read from `shotS01Plan` (the chart, the key sheet, the layout), so the exposure sheet and this picture are one state.
 * The human is the parts rig through `FlatFigure` (the home plate cut into parts, each its own ARAP mesh, drawn in `partsOrder`); the props are the existing drawn props (`Box`, `Gadget`, `Frame`, `Codex`, `Clawd`) and the worlds'
 * own stalk, arch and ring geometry (`props/Pieces`); the flood and the grain are drawn here and reseed only on twos.
 */

const W = SIZE.width, H = SIZE.height;
const staging = layout.staging;

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const cool = {'--cool': s01Turrell.cool} as React.CSSProperties;
const kitVars = {...roleVars(s01Turrell.kit, s01Turrell.outline), ...cool};

/**
 * The light, under every asset. The flood is a radial gradient centred on the emitter, drawn in SCREEN space (radius times the camera's zoom): a 4000 px
 * div in the scaled world exceeded the compositor's tile and showed as a rectangle (frame 200 of the first render). The cone to the trio and the pool on
 * the floor are small and stay in the world.
 */
const Flood: React.FC<{p: UnderP}> = ({p}) => {
  const f = p.flood;
  const [dx, dy] = p.dialXY;
  return (
    <>
      <svg width={1} height={1} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible', opacity: f * p.dial * 0.6}}>
        <defs>
          <linearGradient id="s01-cone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#bcd0ff" stopOpacity="0.95" />
            <stop offset="0.5" stopColor="#0a51fb" stopOpacity="0.55" />
            <stop offset="1" stopColor="#0a51fb" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <polygon points={`${dx - 40},${dy + 20} ${dx + 40},${dy + 20} ${dx + 360},${staging.floorY} ${dx - 360},${staging.floorY}`} fill="url(#s01-cone)" />
      </svg>
      <div style={{position: 'absolute', left: dx - 520, top: staging.floorY - 60, width: 1040, height: 120, opacity: f * 0.8, background: 'radial-gradient(ellipse closest-side at center, rgba(40,110,255,0.9) 0%, rgba(10,81,251,0.45) 45%, rgba(10,81,251,0) 100%)'}} />
    </>
  );
};

/** The flood proper, in screen space under the camera view. */
const ScreenFlood: React.FC<{p: UnderP; camera: CameraPose}> = ({p, camera}) => {
  const f = p.flood;
  const [x, y] = toScreen(camera, p.dialXY[0], p.dialXY[1]);
  const R = (500 + f * 1700) * camera.zoom;
  return <div style={{position: 'absolute', left: x - R, top: y - R, width: 2 * R, height: 2 * R, opacity: f * 0.9, background: 'radial-gradient(circle closest-side, rgba(10,81,251,0.95) 0%, rgba(10,81,251,0.62) 34%, rgba(10,60,200,0.28) 62%, rgba(7,12,60,0) 100%)'}} />;
};

/**
 * Seeded motes drifting up through the flood, stepped on twos (the light's grain is boil, not shimmer). `invisible` keeps the element, an opacity below 1 and its extent and paints nothing: the front pass carries it
 * (see `FrontP.motes`), because a sibling under the front with an opacity below 1 changes how the browser rasterises the front: the front is drawn soft in the whole frame and sharp without it
 * (measured on frame 252: 16 905 pixels beyond 2 levels, the invisible element brings it to 0).
 */
const Motes: React.FC<{frame: number; flood: number; invisible?: boolean}> = ({frame, flood, invisible = false}) => {
  if (flood < 0.2) return null;
  const r = rng(31), f = frame;
  const dots = Array.from({length: 46}, () => ({x: -800 + r() * 2900, y0: -950 + r() * 1650, r: 1.6 + r() * 2.6, speed: 0.12 + r() * 0.22, ph: r() * 6.28}));
  return (
    <svg width={1} height={1} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible', opacity: Math.min(1, flood)}}>
      {dots.map((d, i) => {
        const y = ((d.y0 - f * d.speed * 4 + 1700) % 1650) - 950;
        return <circle key={i} cx={d.x + Math.sin(f / 40 + d.ph) * 8} cy={y} r={d.r} fill={i % 7 === 0 ? s01Turrell.accent : '#cfe0ff'} opacity={invisible ? 0 : 0.55} />;
      })}
    </svg>
  );
};

/** The lamp itself, in screen space over the picture: a blown-out core at the emitter, white at its centre (the one thing the light layer may draw over an identity pigment). The seam is a hairline, the dial a lamp. */
const Core: React.FC<{p: CoreP}> = ({p}) => {
  const e = p.emitter;
  const [x, y] = toScreen(p.camera, e.x, e.y), z = p.camera.zoom;
  if (e.kind === 'seam') {
    const w = (70 + 90 * e.intensity) * z, h = (6 + 12 * e.intensity) * z;
    return <div style={{position: 'absolute', left: x - w, top: y - h, width: 2 * w, height: 2 * h, mixBlendMode: 'screen', background: 'radial-gradient(ellipse closest-side at center, #ffffff 0%, #ffffff 24%, rgba(190,212,255,0.95) 48%, rgba(10,81,251,0.5) 74%, rgba(10,81,251,0) 100%)'}} />;
  }
  const R = (90 + 330 * e.intensity) * z;
  return <div style={{position: 'absolute', left: x - R, top: y - R, width: 2 * R, height: 2 * R, mixBlendMode: 'screen', background: 'radial-gradient(circle closest-side, #ffffff 0%, #ffffff 26%, rgba(190,212,255,0.96) 40%, rgba(10,81,251,0.6) 64%, rgba(10,81,251,0) 100%)'}} />;
};

const placed = (x: number, y: number, rot: number, scale: number): React.CSSProperties => ({position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', transform: `translate(${x}px, ${y}px) rotate(${rot}deg) scale(${scale})`});

/** One projected piece: a drawn prop at its pose along the chart's curve; stalks grow as they fly, the rest scale up out of the funnel. */
const Piece: React.FC<{p: PieceDraw; boilVariant: number}> = ({p, boilVariant}) => {
  const {pose} = p;
  const body = (() => {
    switch (p.kind) {
      case 'stalk':
        return <StalkPiece grow={pose.landed ? 1 : 0.35 + 0.65 * pose.t} variant={(boilVariant + p.seed) % 3} flip={p.seed % 2 === 1} />;
      case 'arch':
        return <ArchPiece width={PIECE_SIZE.arch.width} height={PIECE_SIZE.arch.height} />;
      case 'ring':
        return <RingPiece r={PIECE_SIZE.ring} />;
      case 'frame':
        return <FramePiece width={PIECE_SIZE.frame.width} height={PIECE_SIZE.frame.height} />;
      case 'string':
        return <StringPiece end={PIECE_SIZE.string.end} sag={PIECE_SIZE.string.sag} />;
      default:
        return <BlockPiece width={PIECE_SIZE.block.width} height={PIECE_SIZE.block.height} role={p.seed % 2 ? 'main2' : 'main1'} />;
    }
  })();
  const scale = p.kind === 'stalk' ? pose.scale * PIECE_SIZE.stalk : pose.scale;
  return <div style={placed(pose.x, pose.y, pose.rot, scale)}>{body}</div>;
};

const Pieces: React.FC<{pieces: PieceDraw[]; boil: number}> = ({pieces, boil}) => (
  <div style={{position: 'absolute', left: 0, top: 0, ...kitVars}}>
    {pieces.map((p) => <Piece key={p.id} p={p} boilVariant={boil} />)}
  </div>
);

/** The grain: a seeded noise over the whole picture at the chart's grain amount, reseeded on twos from three variants. */
const Grain: React.FC<{amount: number; variant: number}> = ({amount, variant}) => (
  <svg width={W} height={H} style={{position: 'absolute', left: 0, top: 0, mixBlendMode: 'screen', opacity: amount * 0.1, pointerEvents: 'none'}}>
    <filter id="s01-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="1" seed={chart.boil.seed + variant} />
      <feColorMatrix type="saturate" values="0" />
    </filter>
    <rect width={W} height={H} filter="url(#s01-grain)" />
  </svg>
);

/** The shot's blocking: the layout's staging laid over the beat's file, which only the figure, the Codex and Clawd read, and the staging overrides all three, so both beats draw the same. */
const blocking = stagedBlocking('arrival');

/**
 * The pass components. Each reads its projection (shotS01Passes.ts) and nothing else: that is what lets the render cache key a drawing by the projection's hash. The world-space ones
 * are bodies, drawn inside the one `CameraView` the whole frame shares (`ShotS01`, the DOM the film has always had) or inside a `CameraView` of their own (`ShotS01Layer`, one pass on a transparent frame).
 */
const UnderBody: React.FC<{p: UnderP}> = ({p}) => (
  <>
    <Flood p={p} />
    <Motes frame={p.motesFrame} flood={p.flood} />
  </>
);

const BehindBody: React.FC<{p: BehindP}> = ({p}) => (
  <>
    <Pieces pieces={p.pieces} boil={p.boil} />
    <Sprite roles={identity.codex} outline={settled.outline} x={blocking.codex.x} y={blocking.codex.y} scale={blocking.codex.scale} style={cool}>
      <Codex variant={p.boil} look={p.codex.lean > 0.3 ? 1 : 0} lean={p.codex.lean} catchArms={p.codex.catch} />
    </Sprite>
  </>
);

const FigureBody: React.FC<{p: FigureP}> = ({p}) => <FlatFigure pose={p.pose} fill={1} line={null} blocking={blocking} order={p.order} />;

const FrontBody: React.FC<{p: FrontP}> = ({p}) => {
  const g = p.gadget;
  const bubbleScale = p.bubble.size * 1.2;
  const clawdFeet = {x: staging.clawd.x + 116 * staging.clawd.scale, y: staging.clawd.feetY};
  return (
    <>
      <Sprite roles={s01Turrell.gadget} outline={s01Turrell.outline} x={g.origin[0]} y={g.origin[1]} scale={g.scale} style={cool}>
        <Gadget glow={g.glow} />
      </Sprite>
      {p.bubble.size > 0.01 && (
        <Sprite roles={s01Turrell.kit} outline={s01Turrell.outline} x={p.bubble.centre[0] - 140 * bubbleScale} y={p.bubble.centre[1] - 140 * bubbleScale} scale={bubbleScale}>
          <Bubble squash={p.boil - 1} wobble={p.boil - 1} />
        </Sprite>
      )}
      <Sprite roles={s01Turrell.box} outline={s01Turrell.outline} x={staging.box.x} y={staging.box.y} scale={staging.box.scale} style={cool}>
        <Box lid={p.lid} variant={p.boil} hinge="back" />
      </Sprite>
      <div style={{position: 'absolute', left: 0, top: 0, transformOrigin: `${clawdFeet.x}px ${clawdFeet.y}px`, transform: `translate(${p.clawd.push * 70}px, 0) rotate(${p.clawd.push * 9}deg)`}}>
        <Sprite roles={identity.clawd} outline={settled.outline} x={blocking.clawd.x} y={blocking.clawd.y} scale={blocking.clawd.scale} style={cool}>
          <Clawd variant={p.boil} lean={p.clawd.lean} squash={p.clawd.push * 0.8} />
        </Sprite>
      </div>
      <Pieces pieces={p.pieces} boil={p.boil} />
      {p.stalk0 > 0.01 && (
        <div style={{...kitVars, ...placed(g.funnel[0], g.funnel[1], -24, STALK0_SCALE)}}>
          <StalkPiece grow={p.stalk0} variant={p.boil} />
        </div>
      )}
      {p.pop > 0 && (
        <svg width={1} height={1} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
          <circle cx={p.bubble.centre[0]} cy={p.bubble.centre[1]} r={190 + 330 * (1 - p.pop)} fill="none" stroke={s01Turrell.accent} strokeWidth={10 * p.pop + 2} opacity={p.pop} />
        </svg>
      )}
    </>
  );
};

const TitlePass: React.FC<{opacity: number}> = ({opacity}) => (
  <div style={{position: 'absolute', left: 64, top: 52, display: 'flex', alignItems: 'center', gap: 18, opacity}}>
    <Img src={staticFile('mark-reversed.svg')} style={{width: 74, height: 56}} />
    <div style={{fontFamily: fonts.sans, color: settled.kit.light, fontSize: 30, fontWeight: 600, letterSpacing: 0.5}}>Claude Prompts</div>
  </div>
);

/**
 * `layers="figure"` draws only the human, under the camera, on the field colour: the figure's drawing and nothing else (no light, no props, no title, no
 * grain). The twos and hold probes read a crop of the frame and cannot tell a figure change from the light's (the emitter sits inside that crop); this
 * pass is what they measure the drawn layer on.
 */
export const ShotS01: React.FC<{layers?: 'all' | 'figure'}> = ({layers = 'all'}) => {
  const frame = useCurrentFrame();
  const {passes: P, params} = projectState(stateAt(frame));
  const camera = P.figure!.camera;
  if (layers === 'figure') {
    return (
      <AbsoluteFill style={{background: settled.field}}>
        <CameraView pose={camera} size={SIZE}>
          <FigureBody p={P.figure!} />
        </CameraView>
      </AbsoluteFill>
    );
  }
  const S = P.back!;
  return (
    <AbsoluteFill style={{background: params.field}}>
      {S.under && <ScreenFlood p={S.under} camera={camera} />}
      <CameraView pose={camera} size={SIZE}>
        {S.under && <UnderBody p={S.under} />}
        <BehindBody p={S.behind} />
        <FigureBody p={P.figure!} />
        <FrontBody p={P.front!} />
      </CameraView>
      {P['light-over'] && <Core p={P['light-over']} />}
      {P.grain && <Grain amount={params.grainAmount} variant={P.grain.variant} />}
      {P.title && <TitlePass opacity={params.titleOpacity} />}
    </AbsoluteFill>
  );
};

/**
 * One pass on a transparent frame, from a projection (scripts/animation/render-cached.mjs renders a list of them, frame n of this composition = job n). The grain and the title are drawn
 * at full opacity: their per-frame opacity is a frame parameter the compositor applies, so one drawing serves every frame that shows it.
 */
export type LayerJob = {pass: Pass; id: string; p: PassProjection[Pass]};
/**
 * The figure's canvas, drawing nothing. In the whole frame the figure's WebGL canvas is a compositing layer, and what is painted after it and overlaps it is a compositing layer of its own, whose origin the browser snaps to a whole pixel; a pass drawn without a canvas under it keeps its sub-pixel
 * position, a half-pixel off the whole frame's (measured on Clawd's outline, frame 0). The back carries this canvas where the figure's is, the front and the lamp's core carry it before them.
 */
const FigureCanvasShim: React.FC = () => <MeshFigure mesh={() => null} {...blocking.figure} />;

export const ShotS01Layer: React.FC<{jobs: LayerJob[]}> = ({jobs}) => {
  const frame = useCurrentFrame();
  const job = jobs[frame];
  // the next job's tiles are raster work the browser does after React commits: hold the screenshot two animation frames so a tile of the previous job is never what is captured
  useLayoutEffect(() => {
    const handle = delayRender(`s01 layer job ${frame}`);
    requestAnimationFrame(() => requestAnimationFrame(() => continueRender(handle)));
  }, [frame]);
  if (!job) return null;
  // a fresh DOM per job: a tile of the previous job's picture was measured left standing when the same nodes were updated in place
  switch (job.pass) {
    case 'back': {
      const p = job.p as BackP;
      return (
        <AbsoluteFill key={frame} style={{background: p.field}}>
          {p.under && <ScreenFlood p={p.under} camera={p.camera} />}
          <CameraView pose={p.camera} size={SIZE}>
            {p.under && <UnderBody p={p.under} />}
            <BehindBody p={p.behind} />
            <FigureCanvasShim />
          </CameraView>
        </AbsoluteFill>
      );
    }
    case 'front': {
      const p = job.p as FrontP;
      return <AbsoluteFill key={frame}><CameraView pose={p.camera} size={SIZE}>{p.motes && <Motes frame={0} flood={0.5} invisible />}<FigureCanvasShim /><FrontBody p={p} /></CameraView></AbsoluteFill>;
    }
    case 'figure': {
      const p = job.p as FigureP;
      return <AbsoluteFill><CameraView pose={p.camera} size={SIZE}><FigureBody p={p} /></CameraView></AbsoluteFill>;
    }
    case 'light-over': {
      const p = job.p as CoreP;
      return <AbsoluteFill key={frame}><CameraView pose={p.camera} size={SIZE}><FigureCanvasShim /></CameraView><Core p={p} /></AbsoluteFill>;
    }
    case 'grain':
      return <AbsoluteFill key={frame}><Grain amount={10} variant={(job.p as GrainP).variant} /></AbsoluteFill>;
    case 'title':
      return <AbsoluteFill><TitlePass opacity={1} /></AbsoluteFill>;
  }
};

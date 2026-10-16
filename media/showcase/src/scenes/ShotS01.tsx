import {AbsoluteFill, Img, interpolateColors, staticFile, useCurrentFrame} from 'remotion';
import {fonts} from '../design';
import {CameraView} from '../library/animation/camera';
import {quantise} from '../library/animation/track';
import {Clawd} from '../library/cast/Clawd';
import {Codex} from '../library/cast/Codex';
import {Box} from '../library/props/Box';
import {Bubble} from '../library/props/Bubble';
import {Gadget} from '../library/props/Gadget';
import {ArchPiece, BlockPiece, FramePiece, RingPiece, StalkPiece, StringPiece} from '../library/props/Pieces';
import {Sprite} from '../library/Sprite';
import {identity, roleVars, s01Turrell, settled} from '../library/tokens';
import {FlatFigure} from '../library/worlds/parts';
import {PIECE_SIZE, SIZE, chart, layout, stagedBlocking, stateAt, toScreen, type PieceDraw, type ShotState} from './shotS01Plan';

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
const Flood: React.FC<{s: ShotState}> = ({s}) => {
  const f = s.light.flood;
  if (f <= 0.001) return null;
  const [dx, dy] = s.gadget.dial;
  return (
    <>
      <svg width={1} height={1} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible', opacity: f * s.light.dial * 0.6}}>
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
const ScreenFlood: React.FC<{s: ShotState}> = ({s}) => {
  const f = s.light.flood;
  if (f <= 0.001) return null;
  const [x, y] = toScreen(s.camera, s.gadget.dial[0], s.gadget.dial[1]);
  const R = (500 + f * 1700) * s.camera.zoom;
  return <div style={{position: 'absolute', left: x - R, top: y - R, width: 2 * R, height: 2 * R, opacity: f * 0.9, background: 'radial-gradient(circle closest-side, rgba(10,81,251,0.95) 0%, rgba(10,81,251,0.62) 34%, rgba(10,60,200,0.28) 62%, rgba(7,12,60,0) 100%)'}} />;
};

/** Seeded motes drifting up through the flood, stepped on twos (the light's grain is boil, not shimmer). */
const Motes: React.FC<{frame: number; flood: number}> = ({frame, flood}) => {
  if (flood < 0.2) return null;
  const r = rng(31), f = quantise(frame, 2);
  const dots = Array.from({length: 46}, () => ({x: -800 + r() * 2900, y0: -950 + r() * 1650, r: 1.6 + r() * 2.6, speed: 0.12 + r() * 0.22, ph: r() * 6.28}));
  return (
    <svg width={1} height={1} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible', opacity: Math.min(1, flood)}}>
      {dots.map((d, i) => {
        const y = ((d.y0 - f * d.speed * 4 + 1700) % 1650) - 950;
        return <circle key={i} cx={d.x + Math.sin(f / 40 + d.ph) * 8} cy={y} r={d.r} fill={i % 7 === 0 ? s01Turrell.accent : '#cfe0ff'} opacity={0.55} />;
      })}
    </svg>
  );
};

/** The lamp itself, in screen space over the picture: a blown-out core at the emitter, white at its centre (the one thing the light layer may draw over an identity pigment). The seam is a hairline, the dial a lamp. */
const Core: React.FC<{s: ShotState}> = ({s}) => {
  const e = s.light.emitter;
  if (!e || e.intensity <= 0.01) return null;
  const [x, y] = toScreen(s.camera, e.x, e.y), z = s.camera.zoom;
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

const Pieces: React.FC<{s: ShotState; layer: 'back' | 'front'}> = ({s, layer}) => (
  <div style={{position: 'absolute', left: 0, top: 0, ...kitVars}}>
    {s.pieces.filter((p) => p.layer === layer).map((p) => <Piece key={p.id} p={p} boilVariant={s.boil} />)}
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

/**
 * `layers="figure"` draws only the human, under the camera, on the field colour: the figure's drawing and nothing else (no light, no props, no title, no
 * grain). The twos and hold probes read a crop of the frame and cannot tell a figure change from the light's (the emitter sits inside that crop); this
 * pass is what they measure the drawn layer on.
 */
export const ShotS01: React.FC<{layers?: 'all' | 'figure'}> = ({layers = 'all'}) => {
  const frame = useCurrentFrame();
  const s = stateAt(frame);
  const blocking = stagedBlocking(s.beat === 'arrival' ? 'arrival' : 'everything-at-once');
  const g = s.gadget;
  const field = interpolateColors(Math.min(1, s.light.flood), [0, 1], [settled.field, '#040a2a']);
  const bubbleScale = s.bubble.size * 1.2;
  const titleOpacity = 1 - Math.max(0, Math.min(1, (frame - 150) / 60));
  const clawdFeet = {x: staging.clawd.x + 116 * staging.clawd.scale, y: staging.clawd.feetY};
  const pop = s.light.pop;
  if (layers === 'figure') {
    return (
      <AbsoluteFill style={{background: settled.field}}>
        <CameraView pose={s.camera} size={SIZE}>
          <FlatFigure pose={s.pose} fill={1} line={null} blocking={blocking} order={s.partsOrder} />
        </CameraView>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{background: field}}>
      <ScreenFlood s={s} />
      <CameraView pose={s.camera} size={SIZE}>
        <Flood s={s} />
        <Motes frame={frame} flood={s.light.flood} />
        <Pieces s={s} layer="back" />
        <Sprite roles={identity.codex} outline={settled.outline} x={blocking.codex.x} y={blocking.codex.y} scale={blocking.codex.scale} style={cool}>
          <Codex variant={s.boil} look={s.codex.lean > 0.3 ? 1 : 0} lean={s.codex.lean} catchArms={s.codex.catch} />
        </Sprite>
        <FlatFigure pose={s.pose} fill={1} line={null} blocking={blocking} order={s.partsOrder} />
        <Sprite roles={s01Turrell.gadget} outline={s01Turrell.outline} x={g.origin[0]} y={g.origin[1]} scale={g.scale} style={cool}>
          <Gadget glow={g.glow} />
        </Sprite>
        {s.bubble.size > 0.01 && (
          <Sprite roles={s01Turrell.kit} outline={s01Turrell.outline} x={s.bubble.centre[0] - 140 * bubbleScale} y={s.bubble.centre[1] - 140 * bubbleScale} scale={bubbleScale}>
            <Bubble squash={s.boil - 1} wobble={s.boil - 1} />
          </Sprite>
        )}
        <Sprite roles={s01Turrell.box} outline={s01Turrell.outline} x={staging.box.x} y={staging.box.y} scale={staging.box.scale} style={cool}>
          <Box lid={s.lid} variant={s.boil} hinge="back" />
        </Sprite>
        <div style={{position: 'absolute', left: 0, top: 0, transformOrigin: `${clawdFeet.x}px ${clawdFeet.y}px`, transform: `translate(${s.clawd.push * 70}px, 0) rotate(${s.clawd.push * 9}deg)`}}>
          <Sprite roles={identity.clawd} outline={settled.outline} x={blocking.clawd.x} y={blocking.clawd.y} scale={blocking.clawd.scale} style={cool}>
            <Clawd variant={s.boil} lean={s.clawd.lean} squash={s.clawd.push * 0.8} />
          </Sprite>
        </div>
        <Pieces s={s} layer="front" />
        {s.stalk0 > 0.01 && (
          <div style={{...kitVars, ...placed(g.funnel[0], g.funnel[1], -24, 2.7)}}>
            <StalkPiece grow={s.stalk0} variant={s.boil} />
          </div>
        )}
        {pop > 0 && (
          <svg width={1} height={1} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
            <circle cx={s.bubble.centre[0]} cy={s.bubble.centre[1]} r={190 + 330 * (1 - pop)} fill="none" stroke={s01Turrell.accent} strokeWidth={10 * pop + 2} opacity={pop} />
          </svg>
        )}
      </CameraView>
      <Core s={s} />
      <Grain amount={s.light.grain} variant={s.boil} />
      <div style={{position: 'absolute', left: 64, top: 52, display: 'flex', alignItems: 'center', gap: 18, opacity: titleOpacity}}>
        <Img src={staticFile('mark-reversed.svg')} style={{width: 74, height: 56}} />
        <div style={{fontFamily: fonts.sans, color: settled.kit.light, fontSize: 30, fontWeight: 600, letterSpacing: 0.5}}>Claude Prompts</div>
      </div>
    </AbsoluteFill>
  );
};

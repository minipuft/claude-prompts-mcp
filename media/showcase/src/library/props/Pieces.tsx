import {gateStrokes, type Palette as CrayonPalette, type Stroke} from '../worlds/crayonStrokes';
import {Frame} from './Frame';

/**
 * The pieces the gadget projects (shot s01, beat 2): the existing world parts, drawn in the home world's flat role fills and the pale/dark contour of
 * the settled props. Nothing here is new geometry: stalks are the crayon world's `gateStrokes` (an S-curve and a spiral, three passes), arches and
 * ring gates are the worlds' arch and gate outlines, blocks are the kit block, the frame is `Frame`; the only new shape is the beaded string, a
 * catenary with beads (the chain object, seuss-green-cat-lights). All fills are roles (`var(--main1)` ...), so a palette change is the one edit.
 * Every piece is drawn in its own box with its origin at the piece's anchor (a stalk's foot, an arch's base centre, a ring's centre ...).
 */
type Pt = [number, number];

const STALK_R = 64; // the gate radius the stalk strokes are generated at; a stalk's height is 5.2 x this

/** Stroke colours of the crayon palette bound to roles: blue the body, sky the lighter pass, yellow the accent pass, red unused here. */
const strokeColour = (c: Stroke['colour']): string => (c === 'blue' ? 'var(--main1)' : c === 'sky' ? 'var(--main2)' : c === 'yellow' ? 'var(--accent)' : c === 'ink' ? 'var(--outline)' : 'var(--shadow)');
export type CrayonKeys = keyof CrayonPalette;

/** A curling stalk (S-curve up, then a spiral) rooted at (0, 0); `grow` 0..1 draws it on from the foot; `variant` re-lays the strokes by hand (the boil). Height about 333 px at size 1. */
export const StalkPiece: React.FC<{grow?: number; variant?: number; flip?: boolean}> = ({grow = 1, variant = 0, flip = false}) => {
  const strokes = gateStrokes(variant, 4, [{x: 0, y: 0, r: STALK_R}]);
  return (
    <svg width="1" height="1" style={{overflow: 'visible', position: 'absolute', left: 0, top: 0}}>
      <g transform={`translate(0 ${-STALK_R}) ${flip ? 'scale(-1 1)' : ''}`} strokeLinecap="round" strokeLinejoin="round" fill="none">
        {strokes.map((s, i) => (
          <path key={i} d={s.d} pathLength={1} stroke={strokeColour(s.colour)} strokeWidth={s.colour === 'ink' ? s.width + 2 : s.width + 2.5} opacity={s.opacity} strokeDasharray={`${Math.max(0.001, grow)} 2`} />
        ))}
        {/* flag leaf on the spiral's first turn: appears when the stalk is nearly grown */}
        {grow > 0.85 && <path d="M0 -330 C16 -352 36 -348 46 -358 C42 -338 22 -326 4 -330 Z" fill="var(--accent)" stroke="var(--outline)" strokeWidth="3" />}
      </g>
    </svg>
  );
};

/** A pointed (Seuss) arch standing on its base centre at (0, 0): outer silhouette and the opening, `width` x `height` px. */
export const ArchPiece: React.FC<{width: number; height: number}> = ({width, height}) => {
  const w = width / 2, h = height, o = w * 0.56, oh = h * 0.7;
  const outer = `M ${-w} 0 L ${-w} ${-h * 0.42} Q ${-w} ${-h * 0.92} 0 ${-h} Q ${w} ${-h * 0.92} ${w} ${-h * 0.42} L ${w} 0 Z`;
  const inner = `M ${-o} 0 L ${-o} ${-oh * 0.42} Q ${-o} ${-oh * 0.88} 0 ${-oh} Q ${o} ${-oh * 0.88} ${o} ${-oh * 0.42} L ${o} 0 Z`;
  return (
    <svg width="1" height="1" style={{overflow: 'visible', position: 'absolute', left: 0, top: 0}}>
      <path d={`${outer} ${inner}`} fillRule="evenodd" fill="var(--main1)" stroke="var(--light)" strokeWidth="5" strokeLinejoin="round" />
      <path d={`${outer} ${inner}`} fillRule="evenodd" fill="none" stroke="var(--outline)" strokeWidth="2" strokeLinejoin="round" />
      <path d={`M ${-w * 0.78} ${-h * 0.4} Q ${-w * 0.78} ${-h * 0.8} 0 ${-h * 0.9}`} fill="none" stroke="var(--main2)" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
};

/** A ring gate centred on (0, 0): the worlds' two concentric circles (outer r, inner 0.72 r) as one ring of main1 with a pale and a dark contour. */
export const RingPiece: React.FC<{r: number}> = ({r}) => (
  <svg width="1" height="1" style={{overflow: 'visible', position: 'absolute', left: 0, top: 0}}>
    <path d={`M ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 A ${r} ${r} 0 1 0 ${-r} 0 Z M ${-r * 0.72} 0 A ${r * 0.72} ${r * 0.72} 0 1 1 ${r * 0.72} 0 A ${r * 0.72} ${r * 0.72} 0 1 1 ${-r * 0.72} 0 Z`} fillRule="evenodd" fill="var(--main1)" stroke="var(--light)" strokeWidth="4" />
    <circle cx="0" cy="0" r={r} fill="none" stroke="var(--outline)" strokeWidth="2" />
    <circle cx="0" cy="0" r={r * 0.72} fill="none" stroke="var(--outline)" strokeWidth="2" />
    <circle cx={-r * 0.86} cy={-r * 0.24} r={r * 0.06} fill="var(--accent)" />
  </svg>
);

/** A kit block centred on (0, 0): the kit block of the worlds (a rect with the dark contour), two roles. */
export const BlockPiece: React.FC<{width: number; height: number; role?: 'main1' | 'main2'}> = ({width, height, role = 'main1'}) => (
  <svg width="1" height="1" style={{overflow: 'visible', position: 'absolute', left: 0, top: 0}}>
    <g strokeLinejoin="round">
      <rect x={-width / 2} y={-height / 2} width={width} height={height} fill={`var(--${role})`} stroke="var(--outline)" strokeWidth="4" />
      <rect x={-width / 2 + 4} y={-height / 2 + 4} width={width - 8} height={Math.max(4, height * 0.18)} fill="var(--light)" opacity="0.85" />
    </g>
  </svg>
);

/** A patch of tile (the crayon world's patch, home-world fills): four kit blocks in a two-by-two grid, bottom centre at (0, 0), 112 px wide and 88 px high at size 1. */
export const PATCH = {width: 112, height: 88};
export const PatchPiece: React.FC = () => (
  <div style={{position: 'absolute', left: 0, top: 0}}>
    {([[-30, -66, 'main1'], [30, -66, 'main2'], [-30, -22, 'main2'], [30, -22, 'main1']] as const).map(([x, y, role]) => (
      <div key={`${x},${y}`} style={{position: 'absolute', left: x, top: y}}>
        <BlockPiece width={52} height={40} role={role} />
      </div>
    ))}
  </div>
);

/** A framed opening centred on (0, 0): the project's `Frame`. */
export const FramePiece: React.FC<{width: number; height: number}> = ({width, height}) => (
  <div style={{position: 'absolute', left: -width / 2, top: -height / 2}}>
    <Frame width={width} height={height} />
  </div>
);

/** A beaded light string from (0, 0) to `end`, sagging `sag` px: the chain object. Beads alternate the light and accent roles. */
export const StringPiece: React.FC<{end: Pt; sag: number; beads?: number}> = ({end, sag, beads = 14}) => {
  const [ex, ey] = end;
  const at = (t: number): Pt => [ex * t, ey * t + 4 * sag * t * (1 - t)];
  const pts = Array.from({length: beads + 1}, (_, i) => at(i / beads));
  return (
    <svg width="1" height="1" style={{overflow: 'visible', position: 'absolute', left: 0, top: 0}}>
      <path d={pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')} fill="none" stroke="var(--main2)" strokeWidth="3" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 3 === 1 ? 7 : 5} fill={i % 3 === 1 ? 'var(--accent)' : 'var(--light)'} stroke="var(--outline)" strokeWidth="2" />
      ))}
    </svg>
  );
};

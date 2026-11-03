import {gateStrokes, stalkCentre} from '../worlds/crayonStrokes';

/**
 * The props of the scaffold beats (5-8, rows 9.6): the crayon Clawd hands the human, the three strokes she draws in the air and the stalk they become (with a leaf that opens), the grid the stalk's lines reach, the three lit gates, Codex's
 * pointing arm and the title mark. Placeholders in the role fills of the other props (`var(--main1)` ...), each in its own box with its origin at the anchor `worlds/actors.tsx` names for it. The stalk's lines are `stalkCentre`, the
 * line the crayon world draws its gates' stalks with, so the three strokes are exactly the stalk they turn into.
 */
type Pt = [number, number];
const STALK_R = 64;
const CENTRE: Pt[] = stalkCentre([0, STALK_R], STALK_R, 1).map(([x, y]) => [x, y - STALK_R]);
/** The stalk's centreline cut into the three strokes the human draws, as index ranges of `CENTRE`: the lower S, the upper S with the first turn, the curl. */
export const STROKE_RANGES: readonly [number, number][] = [[0, 12], [11, 31], [30, CENTRE.length]];
const d = (pts: Pt[]): string => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');

const SVG: React.CSSProperties = {overflow: 'visible', position: 'absolute', left: 0, top: 0};

/** One of the stalk's three strokes (1-3), a thick waxy line with a lighter pass along it and the dark wax edge, rooted at the stalk's foot (0, 0). */
export const StrokePiece: React.FC<{index: 1 | 2 | 3}> = ({index}) => {
  const [a, b] = STROKE_RANGES[index - 1]!;
  const pts = CENTRE.slice(a, b);
  return (
    <svg width="1" height="1" style={SVG}>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d={d(pts)} stroke="var(--main1)" strokeWidth="19" opacity="0.95" />
        <path d={d(pts.map(([x, y]) => [x + 5, y] as Pt))} stroke="var(--accent)" strokeWidth="7" opacity="0.9" />
        <path d={d(pts.map(([x, y]) => [x + 12, y] as Pt))} stroke="var(--outline)" strokeWidth="3" opacity="0.8" />
      </g>
    </svg>
  );
};

/** The stalk the strokes become: the same line filled in three passes, with a leaf on the first turn that opens (`open` 0 shut and upright, 1 open and wide). Rooted at (0, 0), about 333 px tall at size 1, the leaf 75 px wide at full open. */
export const OpeningStalk: React.FC<{open: number; flip?: boolean}> = ({open, flip = false}) => {
  const strokes = gateStrokes(0, 4, [{x: 0, y: 0, r: STALK_R}]);
  const colour = (c: string): string => (c === 'blue' ? 'var(--main1)' : c === 'sky' ? 'var(--main2)' : c === 'yellow' ? 'var(--accent)' : c === 'ink' ? 'var(--outline)' : 'var(--shadow)');
  const o = Math.max(0, Math.min(1, open));
  return (
    <svg width="1" height="1" style={SVG}>
      <g transform={`translate(0 ${-STALK_R}) ${flip ? 'scale(-1 1)' : ''}`} strokeLinecap="round" strokeLinejoin="round" fill="none">
        {strokes.map((s, i) => (
          <path key={i} d={s.d} stroke={colour(s.colour)} strokeWidth={s.colour === 'ink' ? s.width + 2 : s.width + 2.5} opacity={s.opacity} />
        ))}
        {/* the leaf: its base on the spiral's first turn, folded up along the stem when shut and swung out to the side as it opens */}
        <g transform={`translate(0 -330) rotate(${(-80 * (1 - o)).toFixed(1)}) scale(${(0.15 + 1.45 * o).toFixed(3)} ${(0.15 + 1.35 * o).toFixed(3)})`}>
          <path d="M0 0 C16 -22 36 -18 46 -28 C42 -8 22 4 4 0 Z" fill="var(--accent)" stroke="var(--outline)" strokeWidth="2" />
          <path d="M3 -2 C18 -10 30 -12 42 -24" stroke="var(--outline)" strokeWidth="1.5" />
        </g>
      </g>
    </svg>
  );
};

/** A crayon: its tip at (0, 0), the paper-wrapped body rising 84 px, 18 px wide. */
export const CrayonPiece: React.FC = () => (
  <svg width="1" height="1" style={SVG}>
    <g strokeLinejoin="round">
      <path d="M -9 -16 L 9 -16 L 0 0 Z" fill="var(--main1)" stroke="var(--outline)" strokeWidth="2.5" />
      <rect x="-9" y="-84" width="18" height="68" fill="var(--main1)" stroke="var(--outline)" strokeWidth="2.5" />
      <rect x="-9" y="-70" width="18" height="34" fill="var(--light)" stroke="var(--outline)" strokeWidth="2" />
      <path d="M -9 -84 L -9 -90 L 9 -90 L 9 -84" fill="var(--main2)" stroke="var(--outline)" strokeWidth="2" />
    </g>
  </svg>
);

/** The grid: a lattice standing on its bottom centre (0, 0), 240 px wide and 240 high, bars every 40 px in the world's ink and the cell corners marked, so a piece can stand in any cell. */
export const GRID = {width: 240, height: 240, pitch: 40};
export const GridPiece: React.FC = () => {
  const cols = Math.round(GRID.width / GRID.pitch), rows = Math.round(GRID.height / GRID.pitch);
  return (
    <svg width="1" height="1" style={SVG}>
      <g fill="none" stroke="var(--outline)" strokeLinecap="round">
        {Array.from({length: cols + 1}, (_, i) => <path key={`v${i}`} d={`M ${-GRID.width / 2 + i * GRID.pitch} 0 L ${-GRID.width / 2 + i * GRID.pitch} ${-GRID.height}`} strokeWidth="3" />)}
        {Array.from({length: rows + 1}, (_, i) => <path key={`h${i}`} d={`M ${-GRID.width / 2} ${-i * GRID.pitch} L ${GRID.width / 2} ${-i * GRID.pitch}`} strokeWidth="3" />)}
      </g>
      {Array.from({length: cols + 1}, (_, i) => Array.from({length: rows + 1}, (_, j) => <circle key={`${i},${j}`} cx={-GRID.width / 2 + i * GRID.pitch} cy={-j * GRID.pitch} r="3.5" fill="var(--accent)" stroke="var(--outline)" strokeWidth="1" />))}
    </svg>
  );
};

/** Codex's arm held out to point: from its shoulder at (0, 0) up and to the left to the finger at (-290, -272), a hand at the end with the finger out. */
export const POINTER = {to: [-290, -272] as Pt};
export const PointerPiece: React.FC = () => {
  const [x, y] = POINTER.to;
  return (
    <svg width="1" height="1" style={SVG}>
      <g strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d={`M 0 0 L ${x + 18} ${y + 23}`} stroke="var(--outline)" strokeWidth="19" />
        <path d={`M 0 0 L ${x + 18} ${y + 23}`} stroke="var(--main1)" strokeWidth="13" />
        <path d={`M ${x + 18} ${y + 23} L ${x} ${y}`} stroke="var(--outline)" strokeWidth="9" />
        <path d={`M ${x + 18} ${y + 23} L ${x} ${y}`} stroke="var(--light)" strokeWidth="5" />
      </g>
      <circle cx={x + 22} cy={y + 28} r="14" fill="var(--main1)" stroke="var(--outline)" strokeWidth="2.5" />
    </svg>
  );
};

/** The title mark: a lit join (two blocks that touch) and the name beside it, centred on (0, 0), 400 px wide and 80 high. */
export const TitlePiece: React.FC = () => (
  <svg width="1" height="1" style={SVG}>
    <g strokeLinejoin="round">
      <rect x="-196" y="-18" width="30" height="24" fill="var(--main1)" stroke="var(--outline)" strokeWidth="3" />
      <rect x="-166" y="-18" width="30" height="24" fill="var(--main2)" stroke="var(--outline)" strokeWidth="3" />
      <rect x="-168" y="-18" width="4" height="24" fill="var(--accent)" />
    </g>
    <text x="-122" y="2" fontFamily="'Helvetica Neue', Arial, sans-serif" fontWeight="700" fontSize="44" letterSpacing="1" fill="var(--light)" stroke="var(--outline)" strokeWidth="1">claude prompts</text>
  </svg>
);

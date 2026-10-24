import {AbsoluteFill} from 'remotion';
import {Sprite} from '../library/Sprite';
import {Clawd} from '../library/cast/Clawd';
import {Codex} from '../library/cast/Codex';
import {identity, settled} from '../library/tokens';

/** Skin candidates between Clawd coral and Codex blue (D54), shown as flat heads with contour, stipple-free, beside the companions. */
const CANDIDATES: Array<{id: string; hex: string; note: string}> = [
  {id: 'A', hex: '#c885c2', note: 'via magenta, midpoint'},
  {id: 'B', hex: '#67b479', note: 'via green, midpoint'},
  {id: 'C', hex: '#d291cc', note: 'via magenta, Midnight Gospel lightness'},
];
const Head: React.FC<{skin: string; label: string; note: string}> = ({skin, label, note}) => (
  <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10}}>
    <svg width="150" height="170" viewBox="0 0 150 170">
      <path d="M30 30 C60 -6 120 6 126 50 C132 92 122 128 92 140 C62 152 26 128 24 92 C22 68 26 44 30 30 Z" fill={skin} stroke={settled.outline} strokeWidth="4" />
      <path d="M26 92 C40 150 110 152 124 110 C120 136 92 150 70 146 C46 142 30 120 26 92 Z" fill={settled.human.shadow} opacity="0.55" />
      <ellipse cx="54" cy="80" rx="6" ry="9" fill={settled.outline} /><ellipse cx="98" cy="80" rx="6" ry="9" fill={settled.outline} />
      <path d="M68 112 q8 5 16 0" stroke={settled.outline} strokeWidth="3" fill="none" />
      <path d="M26 44 C40 10 100 0 128 36 C100 20 60 22 26 44 Z" fill={settled.human.main2} stroke={settled.outline} strokeWidth="4" />
    </svg>
    <div style={{fontFamily: 'Instrument Sans', color: settled.kit.light, fontSize: 22, fontWeight: 600}}>{label} {skin}</div>
    <div style={{fontFamily: 'IBM Plex Mono', color: settled.kit.main2, fontSize: 15}}>{note}</div>
  </div>
);
export const SkinSwatch: React.FC = () => (
  <AbsoluteFill style={{background: settled.field}}>
    <Sprite roles={identity.codex} outline={settled.outline} x={60} y={300} scale={1.6}><Codex /></Sprite>
    <div style={{position: 'absolute', left: 300, top: 250, display: 'flex', gap: 60}}>
      {CANDIDATES.map((c) => <Head key={c.id} skin={c.hex} label={c.id} note={c.note} />)}
    </div>
    <Sprite roles={identity.clawd} outline={settled.outline} x={1020} y={330} scale={1.8}><Clawd /></Sprite>
  </AbsoluteFill>
);

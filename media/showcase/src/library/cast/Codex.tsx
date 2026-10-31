import {DitherDefs} from '../Dither';

/**
 * Codex companion: the original blue cloud-headed figure with a dark terminal face showing a cyan prompt glyph,
 * small body, stub arms and legs. Identity cues from the official sprite sheet; five-role flat SVG with a boil variant.
 * `lean` 0..1 leans the head forward past the body (the head turns about its neck, the body tips less about its feet: a line of action, not one rotation);
 * `catchArms` 0..1 raises both arms to catch something. At 0 and 0 the drawing is the original, node for node.
 */
export const Codex: React.FC<{variant?: number; look?: number; lean?: number; catchArms?: number}> = ({variant = 0, look = 0, lean = 0, catchArms = 0}) => (
  <svg width="120" height="140" viewBox="-10 -10 120 140" style={{overflow: 'visible'}}>
    <DitherDefs id="codex-dither" seed={5} />
    <ellipse cx="50" cy="124" rx="44" ry="9" fill="url(#codex-dither-cast)" filter="url(#codex-dither)" />
    <g stroke="var(--outline)" strokeWidth="4" strokeLinejoin="round" transform={`translate(${[0, 1.8, -2.0][variant] ?? 0} ${[0, -1.2, 1.4][variant] ?? 0}) rotate(${[0, -1.0, 0.9][variant] ?? 0} 50 60)`}>
      <g transform={lean ? `translate(${lean * 3} 0) rotate(${lean * 4} 50 108)` : undefined}>
      {/* body */}
      <rect x="30" y="74" width="40" height="34" rx="10" fill="var(--main2)" />
      <path d="M30 96 h40 v4 a10 10 0 0 1 -10 10 h-20 a10 10 0 0 1 -10 -10 z" fill="url(#codex-dither-ramp)" filter="url(#codex-dither)" stroke="none" />
      {/* arms and legs */}
      <rect x="14" y="80" width="14" height="10" rx="5" fill="var(--main2)" transform={catchArms ? `rotate(${catchArms * 118} 28 85)` : undefined} />
      <rect x="72" y="80" width="14" height="10" rx="5" fill="var(--main2)" transform={catchArms ? `rotate(${-catchArms * 118} 72 85)` : undefined} />
      <rect x="34" y="106" width="12" height="14" rx="4" fill="var(--shadow)" />
      <rect x="54" y="106" width="12" height="14" rx="4" fill="var(--shadow)" />
      </g>
      <g transform={lean ? `translate(${lean * 12} ${lean * 4}) rotate(${lean * 9} 50 74)` : undefined}>
      {/* cloud head: five lobes */}
      <path d="M20 60 C6 60 6 40 20 38 C18 24 36 18 46 26 C52 12 76 14 78 30 C92 30 96 50 84 56 C92 70 74 80 62 72 C54 82 34 80 30 70 C20 72 14 66 20 60 Z" fill="var(--main1)" />
      <path d="M62 72 C54 82 34 80 30 70 C20 72 14 66 20 60 L84 56 C92 70 74 80 62 72 Z" fill="url(#codex-dither-ramp)" filter="url(#codex-dither)" stroke="none" />
      <path d="M46 26 C52 12 76 14 78 30 L46 30 Z" fill="var(--light)" stroke="none" />
      {/* terminal face */}
      <rect x="28" y="38" width="46" height="30" rx="7" fill="var(--shadow)" />
      <text x={38 + look * 3} y="60" fontFamily="IBM Plex Mono, monospace" fontSize="18" fontWeight="700" fill="var(--accent)" stroke="none">{'>_'}</text>
      </g>
    </g>
  </svg>
);

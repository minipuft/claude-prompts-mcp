import {AbsoluteFill, Img, staticFile, useCurrentFrame} from 'remotion';
import {Radiance} from '../library/Radiance';
import {Sprite} from '../library/Sprite';
import {Clawd} from '../library/cast/Clawd';
import {Codex} from '../library/cast/Codex';
import {Human} from '../library/cast/Human';
import {Box} from '../library/props/Box';
import {identity, settled} from '../library/tokens';
import {boil, house, lag, move, onTwos} from '../library/motion';
import {fonts} from '../design';

/**
 * Beat 1, Arrival (D53): frame 0 is the poster. Settled black field, the project mark and title held top-left,
 * Codex and Clawd either side of a plain box, a thin light at the box seam. At LID_AT the lid lifts a little (anticipation of beat 2).
 */
const LID_AT = 72;

export const Beat1Opening: React.FC = () => {
  const frame = useCurrentFrame();
  const drawn = onTwos(frame);
  const palette = settled;
  const lid = move(drawn, LID_AT, 0, 0.35, {...house, action: 10, settle: 16}, 0.12);
  const leak = lag(frame, (f) => move(onTwos(f), LID_AT, 0, 1, {...house, action: 10, settle: 16}, 0), 3, 0.1);
  const boxX = 530;
  const boxY = 400;
  return (
    <AbsoluteFill style={{background: palette.field}}>
      {/* the seam light: the only emitter, tiny until the lid moves */}
      {/* seam light: a thin band at the lid line that widens as the lid lifts; masked to the lid opening so it leaks, not floats */}
      <Radiance emitter={{x: boxX + 95, y: boxY + 56, radius: 40 + leak * 300, color: palette.emitter, intensity: 0.5 + leak * 0.45}} bands={palette.bands} motes={4 + Math.round(leak * 30)} grain={0.04} seed={2} mask={{x: boxX + 10, y: boxY + 20 - leak * 200, width: 200, height: 40 + leak * 220}} />
      {/* mark and title, held */}
      <div style={{position: 'absolute', left: 64, top: 52, display: 'flex', alignItems: 'center', gap: 18}}>
        <Img src={staticFile('mark-reversed.svg')} style={{width: 74, height: 56}} />
        <div style={{fontFamily: fonts.sans, color: palette.kit.light, fontSize: 30, fontWeight: 600, letterSpacing: 0.5}}>Claude Prompts</div>
      </div>
      <div style={{position: 'absolute', left: 64, top: 118, fontFamily: fonts.mono, color: palette.kit.main2, fontSize: 18}}>a box arrives</div>
      {/* trio and box; idle boil only */}
      <Sprite roles={identity.codex} outline={palette.outline} x={300} y={430} scale={1.9}>
        <Codex variant={boil(frame, 3, 5)} look={leak} />
      </Sprite>
      <Sprite roles={palette.human} outline={palette.outline} x={boxX + 60} y={boxY - 180} scale={1.25} style={{'--skin': identity.humanSkin.main1, '--skin-shadow': identity.humanSkin.shadow, '--skin-light': identity.humanSkin.light} as React.CSSProperties}>
        <Human lift={lid / 0.35} variant={boil(frame, 3, 17)} look={leak} />
      </Sprite>
      <Sprite roles={palette.kit} outline={palette.outline} x={boxX} y={boxY} scale={1.1}>
        <Box lid={lid} variant={boil(frame, 3, 9)} />
      </Sprite>
      <Sprite roles={identity.clawd} outline={palette.outline} x={800} y={470} scale={2.0}>
        <Clawd raise={0} variant={boil(frame, 3, 3)} />
      </Sprite>
    </AbsoluteFill>
  );
};

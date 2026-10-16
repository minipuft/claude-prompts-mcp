import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {Radiance} from '../library/Radiance';
import {Sprite} from '../library/Sprite';
import {Clawd} from '../library/cast/Clawd';
import {Frame} from '../library/props/Frame';
import {Gadget} from '../library/props/Gadget';
import {FrameInterior} from '../library/glass/FrameInterior';
import {identity, lerpPalette, overwhelm, scaffold} from '../library/tokens';
import {boil, house, lag, move, moveLength, onTwos, seamPulse, stagger} from '../library/motion';

/**
 * Beats 4–5 under the animation language (D51): drawn on twos, light on ones.
 * Beat 4 (0–119): Clawd raises the frame as one phased move; the radiance lags it and narrows into the frame.
 * Beat 5 (120–239): towerA slides in, the second stalk rises, each landing with a seam pulse, staggered.
 */
const RAISE_AT = 24;
const JOIN_A_AT = 132;
const JOIN_B_AT = stagger(JOIN_A_AT, 1, 5) + moveLength(house) - 10;

export const Beats45: React.FC = () => {
  const frame = useCurrentFrame();
  const drawn = onTwos(frame);
  // drawn layer: phased moves evaluated on twos
  const raise = move(drawn, RAISE_AT, 0, 1, {...house, action: 8, settle: 14});
  const joinA = move(drawn, JOIN_A_AT, 0, 1, {...house, action: 10, settle: 12}, 0.05);
  const joinB = move(drawn, JOIN_B_AT, 0, 1, {...house, action: 8, settle: 12}, 0.1);
  // light layer: lags the drawn value on ones, with memory
  const light = lag(frame, (f) => move(onTwos(f), RAISE_AT, 0, 1, {...house, action: 8, settle: 14}), 3, 0.12);
  const pulseA = seamPulse(frame, JOIN_A_AT + house.anticipation + 10 + 3);
  const pulseB = seamPulse(frame, JOIN_B_AT + house.anticipation + 8 + 3);
  const palette = lerpPalette(overwhelm, scaffold, Math.max(0, Math.min(1, light)));
  const frameBox = {x: 560, y: 180, width: 420, height: 320};
  const emitterRadius = interpolate(light, [0, 1], [900, 260], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const variant = boil(frame, 3, 3);
  // the frame rides the raise: it rises with the arm from below into place
  const frameY = frameBox.y + (1 - raise) * 260;
  return (
    <AbsoluteFill style={{background: palette.field}}>
      <Radiance
        emitter={{x: frameBox.x + frameBox.width / 2, y: frameY + frameBox.height / 2, radius: emitterRadius, color: palette.emitter, intensity: 0.9}}
        bands={palette.bands}
        depthRings={0}
        motes={light > 0.5 ? 40 : 60}
        grain={0.05}
        mask={light > 0.5 ? {...frameBox, y: frameY} : undefined}
        seed={4}
      />
      <Sprite roles={palette.gadget} outline={palette.outline} x={1010} y={380} scale={1.0}>
        <Gadget glow={1 - light} />
      </Sprite>
      <Sprite roles={identity.clawd} outline={palette.outline} x={330} y={420} scale={2.2}>
        <Clawd raise={raise} variant={variant} />
      </Sprite>
      <div style={{position: 'absolute', left: frameBox.x, top: frameY, width: frameBox.width, height: frameBox.height, overflow: 'hidden', opacity: interpolate(light, [0.25, 0.7], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>
        <FrameInterior width={frameBox.width} height={frameBox.height} palette={palette} reveal={Math.max(0, Math.min(1, light))} joinA={joinA} joinB={joinB} pulseA={pulseA} pulseB={pulseB} />
      </div>
      <Sprite roles={palette.gadget} outline={palette.outline} x={frameBox.x} y={frameY}>
        <Frame width={frameBox.width} height={frameBox.height} />
      </Sprite>
    </AbsoluteFill>
  );
};

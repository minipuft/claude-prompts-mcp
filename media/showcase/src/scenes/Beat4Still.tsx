import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {Radiance} from '../library/Radiance';
import {Sprite} from '../library/Sprite';
import {Clawd} from '../library/cast/Clawd';
import {Frame} from '../library/props/Frame';
import {Gadget} from '../library/props/Gadget';
import {FrameInterior} from '../library/glass/FrameInterior';
import {identity, lerpPalette, overwhelm, scaffold} from '../library/tokens';

/**
 * Beat 4, "The frame": Clawd holds up the frame; through it one kit piece is lit with depth behind it.
 * Over 90 frames the palette morphs Overwhelm -> Scaffold and the emitter narrows into the frame's interior.
 */
export const Beat4Still: React.FC = () => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, 90], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const palette = lerpPalette(overwhelm, scaffold, t);
  const frameBox = {x: 560, y: 180, width: 420, height: 320};
  const emitterRadius = interpolate(t, [0, 1], [900, 260]);
  return (
    <AbsoluteFill style={{background: palette.field}}>
      {/* radiance UNDER the flat assets so identity pigments stay fixed; narrows to the frame interior as t -> 1 */}
      <Radiance
        emitter={{x: frameBox.x + frameBox.width / 2, y: frameBox.y + frameBox.height / 2, radius: emitterRadius, color: palette.emitter, intensity: 0.9}}
        bands={palette.bands}
        depthRings={t > 0.5 ? 7 : 0}
        motes={t > 0.5 ? 90 : 60}
        grain={0.05}
        mask={t > 0.5 ? frameBox : undefined}
        seed={4}
      />
      {/* flat assets */}
      <Sprite roles={palette.gadget} outline={palette.outline} x={1010} y={380} scale={1.0}>
        <Gadget glow={1 - t} />
      </Sprite>
      <Sprite roles={identity.clawd} outline={palette.outline} x={330} y={420} scale={2.2}>
        <Clawd raise={t} />
      </Sprite>
      {/* the world inside the frame: a GPU pass, clipped to the frame box (D45, D46) */}
      <div style={{position: 'absolute', left: frameBox.x, top: frameBox.y, width: frameBox.width, height: frameBox.height, overflow: 'hidden', opacity: interpolate(t, [0.3, 0.7], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>
        <FrameInterior width={frameBox.width} height={frameBox.height} palette={palette} reveal={t} />
      </div>
      <Sprite roles={palette.gadget} outline={palette.outline} x={frameBox.x} y={frameBox.y}>
        <Frame width={frameBox.width} height={frameBox.height} />
      </Sprite>
    </AbsoluteFill>
  );
};

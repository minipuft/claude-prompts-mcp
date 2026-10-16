import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {fonts} from '../design';
import {CameraView, cameraAt, lockedCamera} from '../library/animation/camera';
import {settled} from '../library/tokens';
import {worlds, type WorldId} from '../library/worlds';
import {Crossing} from '../library/worlds/Crossing';
import {frameState, reelCamera, reelChart, SIZE, timeline} from './animaticPlan';
import {hueOf} from './lightPlan';
import {jointParents} from '../library/cast/humanPose';
import {poseAt} from '../library/motion';

const worldId = (id: string): WorldId => {
  if (!(id in worlds)) throw new Error(`animatic: "${id}" is not a world`);
  return id as WorldId;
};

/**
 * The animatic (row 1.6): the whole timeline at the film's frame size, every beat in its world at its blocking, the human held on its keys
 * (holds only, no inbetweens), crossings through the line world inside their windows, the camera on ones over the top, and the emitter in the
 * shot's hue. A caption strip names the world, the beat and the frame; it is review chrome over the picture, not part of the film, so the probe
 * renders turn it off (`--props='{"captions":false}'`): it covers the figure's boots, which the loop-closure probe needs to see.
 * Everything is read from `animaticPlan`, the module the exposure sheet reads.
 */
export const Animatic: React.FC<{captions?: boolean}> = ({captions = true}) => {
  const frame = useCurrentFrame();
  const s = frameState(frame);
  const hue = hueOf(s.beat.id);
  const scene = s.crossing ? (
    <Crossing from={worldId(s.crossing.fromWorld)} to={worldId(s.crossing.toWorld)} frame={frame} start={s.crossing.start} length={s.crossing.length} chart={s.heldChart} lead={[56, 0]} blocking={s.blocking} emitter={s.emitter} />
  ) : (
    (() => {
      const {Scene} = worlds[worldId(s.beat.world)];
      return <Scene frame={frame} pose={s.pose} emitter={s.emitter} blocking={s.blocking} />;
    })()
  );
  return (
    <AbsoluteFill style={{background: settled.field}}>
      <CameraView pose={s.camera} size={SIZE}>{scene}</CameraView>
      {captions && <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: 34, display: 'flex', alignItems: 'center', gap: 22, padding: '0 20px', background: 'rgba(5,7,13,0.78)', fontFamily: fonts.mono, fontSize: 18, color: '#c9d6d4'}}>
        <span style={{fontWeight: 700}}>{s.beat.id}</span>
        <span>{s.crossing ? `${s.crossing.fromWorld} > ${s.crossing.toWorld}` : s.beat.world}</span>
        <span>{s.drawing}</span>
        <span style={{marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6}}>
          <i style={{width: 22, height: 14, background: hue.radiance, border: '1px solid #c9d6d4'}} />
          <i style={{width: 22, height: 14, background: hue.accent}} />
        </span>
        <span style={{width: 150, textAlign: 'right'}}>f{String(frame).padStart(4, '0')} / {timeline.durationInFrames}</span>
      </div>}
    </AbsoluteFill>
  );
};

/** The 30-frame camera-on-ones reel (row 1.4): the home world under a pan; the figure's drawing steps on twos while the camera moves every frame. `locked` holds the camera still: the control, where only the figure's drawing can change the picture. */
export const CameraReelHome: React.FC<{locked?: boolean}> = ({locked = false}) => {
  const frame = useCurrentFrame();
  const {Scene} = worlds.home;
  return (
    <AbsoluteFill style={{background: settled.field}}>
      <CameraView pose={locked ? lockedCamera(SIZE) : cameraAt(reelCamera, frame)} size={SIZE}>
        <Scene frame={frame} pose={poseAt(reelChart, frame, jointParents)} />
      </CameraView>
    </AbsoluteFill>
  );
};

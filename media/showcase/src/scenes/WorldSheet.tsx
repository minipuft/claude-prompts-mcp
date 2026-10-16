import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {fonts} from '../design';
import {jointParents, liftChart} from '../library/cast/humanPose';
import {poseAt} from '../library/motion';
import {worlds, type PropsPart, type WorldId} from '../library/worlds';
import {WORLD_PARTS} from '../library/worlds/contract';
import {Crossing} from '../library/worlds/Crossing';

/** The pose every world sheet shows: liftChart at frame 36 (the raise), through poseAt like MeshProof. */
export const SHEET_FRAME = 36;

const panelLines = (id: WorldId): string[] => {
  const c = worlds[id].contract;
  return [
    `world ${c.id}${c.provisional ? ' · provisional' : ''}`,
    `field ${c.field}`,
    `line 1/${c.line.ratio} · ${c.line.colour}${c.line.hex ? ` ${c.line.hex}` : ''}`,
    `fills ${c.fills}${c.shading ? ` · ${c.shading.steps} steps` : ''}${c.shading?.emissiveEdges ? ` · emissive edges ${c.shading.edgeColour ?? ''}` : ''}`,
    `boil ${c.boil.variants} variants · ${c.boil.rate}/s${c.boil.figuresOnly ? ' · figures only' : ''}`,
    c.paper ? `paper tooth ${c.paper.tooth}` : 'paper none',
    `radiance ${c.radiance.on ? `on ${c.radiance.colour ?? ''}` : 'off'}`,
    `cards ${c.cards.join(' · ')}`,
  ];
};

/**
 * World sheet (D78): the shared test scene (the human at liftChart 36, Codex and Clawd, one frame, one join) in one world, with that
 * world's contract printed beside it. Worlds with an arch (every world but home) print it in a translucent strip along the bottom: the
 * arch fills the upper left, where home keeps its panel, outside STAGE.figureCrop. The panel is sheet-only chrome.
 */
export const WorldSheet: React.FC<{world: WorldId; parts?: PropsPart[]}> = ({world, parts}) => {
  const {Scene, contract} = worlds[world];
  const dark = contract.field.toLowerCase() === '#f1dcbc' || contract.field.toLowerCase() === '#f3ead8';
  const strip = WORLD_PARTS[world].includes('arch');
  const ink = dark ? '#3a2f22' : '#c9d6d4';
  const lines = panelLines(world);
  return (
    <AbsoluteFill>
      <Scene frame={SHEET_FRAME} pose={poseAt(liftChart, SHEET_FRAME, jointParents)} parts={parts} />
      {strip ? (
        <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, padding: '7px 24px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '2px 18px', fontFamily: fonts.mono, fontSize: 11, lineHeight: 1.35, color: ink, background: dark ? 'rgba(241,220,188,0.72)' : 'rgba(5,7,13,0.72)'}}>
          {lines.map((l, i) => (
            <div key={i} style={{fontWeight: i === 0 ? 700 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{l}</div>
          ))}
        </div>
      ) : (
        <div style={{position: 'absolute', left: 24, top: 24, width: 330, display: 'flex', flexDirection: 'column', gap: 5, fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 1.4, color: ink}}>
          {lines.map((l, i) => (
            <div key={i} style={{fontWeight: i === 0 ? 700 : 400, fontSize: i === 0 ? 15 : 12.5}}>{l}</div>
          ))}
        </div>
      )}
    </AbsoluteFill>
  );
};

/**
 * World crossing proof (D78, beats 5-7): the human in the liftChart pose; home to 30, then the crossing to the shaded world (home reduces
 * to its lines, the lines hold and slide right along the leading line, shaded refills) to frame 100, shaded to the end.
 */
export const WorldCrossingProof: React.FC = () => {
  const frame = useCurrentFrame();
  return <Crossing from="home" to="shaded" frame={frame} start={30} length={70} chart={liftChart} lead={[56, 0]} />;
};

/** Everything the worlds draw except the floor: the floor passes under the figure's feet and would count as silhouette (measurement only). */
const WITHOUT_FLOOR: PropsPart[] = ['companions', 'architecture', 'blocks', 'arch', 'gates'];

/** One world alone through the lift, 48 frames: the world's boil and the rig's motion in its renderer (also the per-world render-time probe). */
export const WorldReel: React.FC<{world: WorldId; parts?: PropsPart[]}> = ({world, parts}) => {
  const frame = useCurrentFrame();
  const {Scene} = worlds[world];
  return <Scene frame={frame} pose={poseAt(liftChart, frame, jointParents)} parts={parts} />;
};

/**
 * The same crossing in a taller frame (1280x1160, the scene offset 220 px down) so the human's hands and feet, which leave the 720 px
 * frame, are not clipped: a contour that continues off-screen reads as several pieces to scripts/measure-silhouette.py. Measurement only.
 */
export const WorldCrossingMeasure: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{background: worlds.home.contract.field}}>
      <div style={{position: 'absolute', left: 0, top: 220, width: 1280, height: 720}}>
        <Crossing from="home" to="shaded" frame={frame} start={30} length={70} chart={liftChart} lead={[56, 0]} parts={WITHOUT_FLOOR} />
      </div>
    </AbsoluteFill>
  );
};

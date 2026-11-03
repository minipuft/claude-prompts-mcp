import {AssetSheet} from '../scenes/AssetSheet';
import {Sprite} from '../library/Sprite';
import {Clawd} from '../library/cast/Clawd';
import {Codex} from '../library/cast/Codex';
import {identity, settled} from '../library/tokens';
import {HumanBell, HumanKin, HumanKite} from './human-v2';

const skinVars = {'--skin': identity.humanSkin.main1, '--skin-shadow': identity.humanSkin.shadow, '--skin-light': identity.humanSkin.light} as React.CSSProperties;
const wrap = (node: React.ReactNode) => (
  <Sprite roles={settled.human} outline={settled.outline} x={0} y={0} scale={1} style={{position: 'relative', ...skinVars}}>
    {node}
  </Sprite>
);

/** Human muse sheet 15 (clean slate, D56): Bell / Kite / Kin at lift 0.6, companions at the edges for scale, 64 px silhouettes under the labels. */
export const HumanSheet2: React.FC = () => (
  <>
    <AssetSheet
      asset="human (resource_manager, the hands) · sheet 15"
      variants={[
        {id: 'A', title: 'Bell', borrows: 'seuss-archbishop-katz: layered mauve/blue/cream bands, rounded apex · lin-fosters: long arms, enlarged hands · chetas: dot eyes, one mouth stroke', between: "Codex's lobed cap · the gadget's stacked lobes", node: wrap(<HumanBell lift={0.6} />), silhouette: <HumanBell lift={0.6} />},
        {id: 'B', title: 'Kite', borrows: 'lin-fosters: stick limbs, enlarged hands and feet · seuss-freebird: hair as one trailing line · chetas: expression economy', between: "Clawd's compact mass · Codex's rounder head", node: wrap(<HumanKite lift={0.6} />), silhouette: <HumanKite lift={0.6} />},
        {id: 'C', title: 'Kin', borrows: "clawd-official: block mass, stub legs · codex-official: lobed cap · seuss-cat-stairway: feathered contour", between: "Clawd's block · Codex's cloud lobes (the trio as one species)", node: wrap(<HumanKin lift={0.6} />), silhouette: <HumanKin lift={0.6} />},
      ]}
    />
    <Sprite roles={identity.codex} outline={settled.outline} x={4} y={360} scale={1.3}><Codex /></Sprite>
    <Sprite roles={identity.clawd} outline={settled.outline} x={1100} y={380} scale={1.2}><Clawd /></Sprite>
  </>
);

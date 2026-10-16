import {AssetSheet} from '../scenes/AssetSheet';
import {Sprite} from '../library/Sprite';
import {Clawd} from '../library/cast/Clawd';
import {Codex} from '../library/cast/Codex';
import {identity, settled} from '../library/tokens';
import {HumanBlob, HumanBlock, HumanStalk} from './human-variants';

const skinVars = {'--skin': identity.humanSkin.main1, '--skin-shadow': identity.humanSkin.shadow, '--skin-light': identity.humanSkin.light} as React.CSSProperties;
const wrap = (node: React.ReactNode) => (
  <Sprite roles={settled.human} outline={settled.outline} x={0} y={0} scale={1.1} style={{position: 'relative', ...skinVars}}>
    {node}
  </Sprite>
);

/** Human muse sheet 14: three constructions at lift 0.6, companions at the edges for scale (3 : 1.5 : 1.2). */
export const HumanSheet: React.FC = () => (
  <>
    <AssetSheet
      asset="human (resource_manager, the hands)"
      variants={[
        {id: 'A', title: 'Stalk', borrows: 'seuss-no-one-youer: body as one tapered swoop · seuss-cat-stairway: long neck, flag hair mass, light-role contour', between: "Codex's lobed head · the gadget's antenna leaf", node: wrap(<HumanStalk lift={0.6} />)},
        {id: 'B', title: 'Blob', borrows: 'midnight-gospel-junkyard: tiny round head, tall soft body, noodle limbs, dot eyes · hallway: blob torso', between: "Codex's cloud lobes · the gadget's stacked lobes", node: wrap(<HumanBlob lift={0.6} />)},
        {id: 'C', title: 'Block', borrows: 'human-selected-02: compact face, large forehead, wide-set eyes · seuss-cat-stairway: light-role contour', between: "Clawd's block mass · Codex's rounder head", node: wrap(<HumanBlock lift={0.6} />)},
      ]}
    />
    <Sprite roles={identity.codex} outline={settled.outline} x={30} y={330} scale={1.5}><Codex /></Sprite>
    <Sprite roles={identity.clawd} outline={settled.outline} x={1100} y={380} scale={1.2}><Clawd /></Sprite>
  </>
);

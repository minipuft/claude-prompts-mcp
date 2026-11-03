import crayonJson from '../../../v3/worlds/crayon.json';
import homeJson from '../../../v3/worlds/home.json';
import lineJson from '../../../v3/worlds/line.json';
import shadedJson from '../../../v3/worlds/shaded.json';
import type {WorldContract, WorldId} from './types';

/** The four provisional contracts, read from v3/worlds/*.json (resolveJsonModule); nothing about a look is written anywhere else. */
export const contracts: Record<WorldId, WorldContract> = {
  home: homeJson as WorldContract,
  crayon: crayonJson as WorldContract,
  line: lineJson as WorldContract,
  shaded: shadedJson as unknown as WorldContract,
};

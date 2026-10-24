import {CrayonScene} from './crayon';
import {contracts} from './contracts';
import {HomeScene} from './home';
import {LineScene} from './line';
import {ShadedScene} from './shaded';
import type {World, WorldId} from './types';

/** The four worlds (D78): renderers over the one rig. Each Scene draws the same test scene (STAGE in contract.ts) in its own language. */
export const worlds: Record<WorldId, World> = {
  home: {contract: contracts.home, Scene: HomeScene},
  crayon: {contract: contracts.crayon, Scene: CrayonScene},
  line: {contract: contracts.line, Scene: LineScene},
  shaded: {contract: contracts.shaded, Scene: ShadedScene},
};

export type {PropsPart, SceneProps, World, WorldContract, WorldId} from './types';

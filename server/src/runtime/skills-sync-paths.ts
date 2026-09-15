// @lifecycle canonical - Resolves the directories skills sync reads and writes, the way the server resolves them.
/**
 * Skills Sync Paths
 *
 * Skills sync runs from its CLI and from `system_control`, and must read the tree the server
 * serves: the bundled resources with the workspace layered over them. The precedence lives in
 * `PathResolver` and the root set in `resource-roots.ts`. `modules/skills-sync` may import neither,
 * so they are resolved here and handed down, the way the resource indexer receives its roots.
 */

import { PathResolver } from './paths.js';
import { indexerResourceRoots } from './resource-roots.js';

import {
  locateSkillsSyncPackageRoot,
  type ResourceType,
  type SkillsSyncPaths,
} from '#modules/skills-sync/service.js';

/**
 * Resolve skills sync's directories through `pathResolver`, or through a resolver built from the
 * environment and the located package root when none is given.
 *
 * Source roots reuse the indexer's derivation because both answer one question: which directories
 * hold the catalog the server serves, lowest precedence first.
 */
export function resolveSkillsSyncPaths(
  pathResolver: PathResolver = new PathResolver({
    cli: {},
    packageRoot: locateSkillsSyncPackageRoot(),
  })
): SkillsSyncPaths {
  const indexed = indexerResourceRoots(pathResolver);
  const sourceRootsOf = (type: ResourceType): readonly string[] => {
    const roots = indexed[type];
    if (roots === undefined) {
      throw new Error(`No ${type} source roots were resolved from ${pathResolver.getWorkspace()}`);
    }
    return roots;
  };

  return {
    packageRoot: pathResolver.getPackageRoot(),
    workspace: pathResolver.isUsingCustomWorkspace() ? pathResolver.getWorkspace() : undefined,
    runtimeStateDir: pathResolver.getRuntimeStatePath(),
    serverConfigPath: pathResolver.getConfigPath(),
    sourceRoots: {
      prompt: sourceRootsOf('prompt'),
      gate: sourceRootsOf('gate'),
      framework: sourceRootsOf('framework'),
      style: sourceRootsOf('style'),
    },
    writeRoots: {
      prompt: pathResolver.getPromptsPath(),
      gate: pathResolver.getGatesPath(),
      framework: pathResolver.getFrameworksPath(),
      style: pathResolver.getStylesPath(),
    },
    bundledRoots: {
      prompt: pathResolver.getBundledResourceDir('prompts'),
      gate: pathResolver.getBundledResourceDir('gates'),
      framework: pathResolver.getBundledResourceDir('frameworks'),
      style: pathResolver.getBundledResourceDir('styles'),
    },
  };
}

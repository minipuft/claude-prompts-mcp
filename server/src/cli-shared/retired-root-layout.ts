// @lifecycle canonical - Finds resource folders at a workspace root that the server no longer reads and words their refusal.
/**
 * The retired folder layout: `<workspace>/<type>/` beside `<workspace>/resources/<type>/`.
 *
 * The server serves a workspace's resources from `<workspace>/resources/<type>/` only. A workspace
 * whose root still holds a `<type>/` folder that the loader for that type recognises resources in
 * is refused, because serving the rest of the workspace without it would drop those resources
 * with no word to the operator. A root folder with one of those names that holds no resource
 * definition (an unrelated `scripts/` directory, an empty `prompts/`) is not a resource folder
 * and is ignored.
 *
 * "Holds a resource" is each loader's own question, asked through the loader's own discovery:
 *   - prompts: a category directory (`isExcludedCategoryDirectoryName` decides) below which
 *     `discoverYamlPrompts` finds a prompt
 *   - gates, frameworks, styles: `discoverNestedYamlDirectories` finds a `gate.yaml`,
 *     `framework.yaml` or `style.yaml` one or two levels down
 *   - scripts: `<id>/tool.yaml`, the one place `WorkspaceScriptLoader` reads
 *
 * Shared by the server's startup refusal (`PathResolver.assertUsablePathSettings`), `cpm`, and
 * `initWorkspace`, so all three answer the question the same way.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { discoverCategoryDirectories } from '#modules/prompts/category-maintenance.js';
import { hasYamlPrompts } from '#modules/prompts/yaml-prompt-loader.js';
import * as retirementNotices from '#shared/utils/_generated/retirement-notices.js';
import { discoverNestedYamlDirectories } from '#shared/utils/yaml/index.js';

/** The resource types that had a folder at the workspace root. */
const ROOT_FOLDER_TYPES = ['prompts', 'gates', 'frameworks', 'styles', 'scripts'] as const;

export type RootFolderType = (typeof ROOT_FOLDER_TYPES)[number];

function holdsScriptTool(dir: string): boolean {
  try {
    return readdirSync(dir, { withFileTypes: true }).some(
      (entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'tool.yaml'))
    );
  } catch {
    return false;
  }
}

/** The definition file each nested-YAML type's loader discovers one or two levels down. */
const DEFINITION_FILES = {
  gates: 'gate.yaml',
  frameworks: 'framework.yaml',
  styles: 'style.yaml',
} as const;

function holdsResourceDefinition(type: RootFolderType, dir: string): boolean {
  if (type === 'prompts') {
    return discoverCategoryDirectories(dir).some((category) => hasYamlPrompts(join(dir, category)));
  }
  if (type === 'scripts') return holdsScriptTool(dir);
  return discoverNestedYamlDirectories(dir, DEFINITION_FILES[type]).length > 0;
}

/** The resource types whose folder at `workspace`'s root holds at least one resource definition. */
export function findRetiredRootFolders(workspace: string): RootFolderType[] {
  return ROOT_FOLDER_TYPES.filter((type) => holdsResourceDefinition(type, join(workspace, type)));
}

/**
 * The refusal text: what is retired, the ledger's replacement, and one `Move:` line per folder.
 * `lead` is the caller's own prefix (`Refusing to start:`).
 */
export function describeRetiredRootLayout(
  workspace: string,
  folders: readonly RootFolderType[],
  lead: string
): string {
  const notice = retirementNotices.folderLayoutWorkspaceRoot;
  const held = folders.map((type) => join(workspace, type)).join(', ');
  return [
    `${lead} ${notice.retired} are no longer read (retired in ${notice.refusedIn}); ${workspace} holds resources in ${held}.`,
    `Expected ${notice.replacement}.`,
    ...folders.map(
      (type) => `Move: ${join(workspace, type)} -> ${join(workspace, 'resources', type)}`
    ),
  ].join('\n');
}

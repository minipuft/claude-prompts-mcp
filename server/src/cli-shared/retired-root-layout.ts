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
import { retirementNotice } from '#shared/utils/retirement-notice.js';
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

function holdsResourceDefinition(type: RootFolderType, dir: string): boolean {
  switch (type) {
    case 'prompts':
      return discoverCategoryDirectories(dir).some((category) =>
        hasYamlPrompts(join(dir, category))
      );
    case 'gates':
      return discoverNestedYamlDirectories(dir, 'gate.yaml').length > 0;
    case 'frameworks':
      return discoverNestedYamlDirectories(dir, 'framework.yaml').length > 0;
    case 'styles':
      return discoverNestedYamlDirectories(dir, 'style.yaml').length > 0;
    case 'scripts':
      return holdsScriptTool(dir);
  }
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
  const notice = retirementNotice('folder-layout-workspace-root');
  const held = folders.map((type) => join(workspace, type)).join(', ');
  return [
    `${lead} ${notice.retired} are no longer read (retired in ${notice.refusedIn}); ${workspace} holds resources in ${held}.`,
    `Expected ${notice.replacement}.`,
    ...folders.map(
      (type) => `Move: ${join(workspace, type)} -> ${join(workspace, 'resources', type)}`
    ),
  ].join('\n');
}

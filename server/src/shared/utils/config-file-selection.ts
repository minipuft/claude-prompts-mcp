// @lifecycle canonical - The one place that decides which file is THE config when several could be.
/**
 * Config File Selection
 *
 * The server reads one config file chosen from up to six candidates (owner ruling R1,
 * `plans/project-workspace-followups-2026-10-28.md`; user-facing statement in
 * `docs/reference/configuration.md` §Which File Is Read):
 *
 *   1. `--config` / `MCP_CONFIG_PATH`
 *   2. `<project>/.claude-prompts/config.jsonc`
 *   3. `<project>/.claude-prompts/config.json`
 *   4. `<workspace>/config.jsonc`
 *   5. `<workspace>/config.json`
 *   6. `<package>/config.json`
 *
 * {@link selectConfigFile} is steps 1-5 and nothing else; step 6 is the server's own shipped file,
 * which only `PathResolver` has a root for, so it is the one thing that caller adds when this
 * function finds nothing. (`PathResolver` also keeps step 1 in `getConfigPath`, because a bad
 * explicit path owes a refusal that names the flag or variable; it calls this for steps 2-5.)
 *
 * It lives in `shared/` because every process that reads the config has to agree on the order, and
 * they cannot reach each other: the server's `PathResolver` (`runtime/`), `cpm config` and the
 * version-history scope (`cli-shared/`, which may not import `runtime/`), and the startup probe in
 * `index.ts`. A reader that keeps its own "workspace only" lookup is the defect this module closes:
 * it edits or reports a file the server is not reading as soon as a project carries a
 * `.claude-prompts/config.jsonc`.
 *
 * The Python hooks (`hooks/lib/config_loader.py`) cannot import this and restate the order; the
 * tests on both sides pin the same cases.
 *
 * SELECTION IS NOT VALIDATION. An explicit path comes back as given — whether it exists, parses
 * or is ambiguous is the caller's refusal to make (the server throws `PathSettingError`; `cpm`
 * reports `not found`; a hook falls back to defaults), which is why none of that is decided here.
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';

import { findWorkspaceConfigFiles } from './config-file-format.js';
import { resolveSettingPath } from './path-setting.js';
import { deriveProjectDir } from './project-scope.js';

/** The directory a project keeps its own resources and config in, directly under the project directory. */
export const PROJECT_WORKSPACE_DIR_NAME = '.claude-prompts';

/** Which step produced the chosen file. */
export type ConfigFileOrigin = 'explicit' | 'project' | 'workspace';

/** The chosen config file and the step that chose it. */
export interface SelectedConfigFile {
  path: string;
  origin: ConfigFileOrigin;
}

/** The places a config file can come from, each optional because a reader may have none of them. */
export interface ConfigFileSources {
  /** `--config` / `MCP_CONFIG_PATH`, already resolved to a path. An empty string counts as unset. */
  explicit?: string | undefined;
  /** The project's `.claude-prompts/` directory, when it exists. */
  projectWorkspace?: string | undefined;
  /** The workspace directory (`--workspace` / `MCP_WORKSPACE`). */
  workspace?: string | undefined;
}

/**
 * Choose the config file: the first of steps 1-5 that has one.
 *
 * Within the project directory and within the workspace, `config.jsonc` outranks `config.json`
 * ({@link findWorkspaceConfigFiles}); holding both is ambiguity the caller refuses, not a tie this
 * function breaks differently.
 *
 * @returns The chosen file and its origin, or `undefined` when no step has one
 */
export function selectConfigFile(sources: ConfigFileSources): SelectedConfigFile | undefined {
  const { explicit, projectWorkspace, workspace } = sources;

  if (explicit !== undefined && explicit !== '') {
    return { path: explicit, origin: 'explicit' };
  }

  const projectFile =
    projectWorkspace === undefined ? undefined : findWorkspaceConfigFiles(projectWorkspace)[0];
  if (projectFile !== undefined) {
    return { path: projectFile, origin: 'project' };
  }

  const workspaceFile =
    workspace === undefined ? undefined : findWorkspaceConfigFiles(workspace)[0];
  return workspaceFile === undefined ? undefined : { path: workspaceFile, origin: 'workspace' };
}

/** Where a process finds the project directory and the explicit path; injectable for a test. */
export interface ConfigLaunch {
  env?: NodeJS.ProcessEnv | undefined;
  cwd?: string | undefined;
}

/**
 * The launch's `<project>/.claude-prompts/` when that directory exists.
 *
 * The project directory is {@link deriveProjectDir}'s: `CLAUDE_PROJECT_DIR`, else the working
 * directory. Checked with `stat`, not by file name: a project that has the folder but no config
 * yet is still where a new config belongs.
 */
export function findProjectWorkspace(launch: ConfigLaunch = {}): string | undefined {
  const projectDir = deriveProjectDir(launch.env, launch.cwd);
  if (projectDir === undefined) {
    return undefined;
  }
  const candidate = join(resolveSettingPath(projectDir.value), PROJECT_WORKSPACE_DIR_NAME);
  try {
    return statSync(candidate).isDirectory() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/**
 * {@link selectConfigFile} for a process that is not the server: the explicit path comes from
 * `MCP_CONFIG_PATH` and the project directory from the launch, since such a process has no
 * `--config` flag and no transport to be discovered by.
 *
 * @param workspace - The workspace directory the process was pointed at
 * @returns The file the server would read from the same environment, or `undefined` when none of
 *   steps 1-5 has one (the packaged file is the server's own concern)
 */
export function selectLaunchConfigFile(
  workspace: string,
  launch: ConfigLaunch = {}
): SelectedConfigFile | undefined {
  const explicit = (launch.env ?? process.env)['MCP_CONFIG_PATH'];
  return selectConfigFile({
    explicit: explicit === undefined || explicit === '' ? undefined : resolveSettingPath(explicit),
    projectWorkspace: findProjectWorkspace(launch),
    workspace,
  });
}

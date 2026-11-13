// @lifecycle test - The one place a test says where resources come from
/**
 * Resource locations for a test: which variable names which folder, and the guarantee that none of
 * it leaks in or out.
 *
 * Why one helper. Before it, thirty-odd files each saved some of the path variables, deleted them,
 * and restored them by hand, and each chose a different subset. The reason is the same everywhere:
 * the Claude Code plugin that runs this server exports `MCP_RESOURCES_PATH` into the maintainer's
 * shell, where it names the profile's own resources folder, so a test that does not decide the
 * answer resolves against the owner's personal library. On a maintainer's machine such a test
 * fails (or, worse, passes against the wrong tree) while CI, where nothing exports it, stays
 * green. A subset that forgot `CLAUDE_PROJECT_DIR` or `MCP_CONFIG_PATH` left the same hole one
 * variable over.
 *
 * What it owns:
 *   - `RESOURCE_LOCATION_ENV_KEYS`: every variable `PathResolver` consults to place resources, the
 *     config file or the project folder. Every setup here snapshots all of them, clears all of
 *     them, and restores all of them, so a test names only the ones it means to set.
 *   - `resourceLocationEnv`: the same option-to-variable mapping as a plain object, for a test that
 *     builds a CHILD process environment and must not touch its own.
 *   - `withResourceLocations`: sets the variables on `process.env` and hands back the matching
 *     `cleanup`, for a body that owns its lifetime (`try`/`finally`, a `cleanups` list).
 *   - `isolateResourceLocations`: the `beforeEach`/`afterEach` pair, for a file or `describe`.
 *
 * `list` writes the workspace's `config.jsonc` with a `paths.resources` list, because that list is
 * the third way a test names resources and it lives in a file rather than a variable. The file is
 * written inside `workspace`; removing that directory is the test's own cleanup.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach } from '@jest/globals';

/** Where each option lands. `serverRoot` is the skills-sync CLI's package root, not a location. */
const OPTION_VARIABLES = {
  workspace: 'MCP_WORKSPACE',
  resourcesPath: 'MCP_RESOURCES_PATH',
  runtimeRoot: 'MCP_RUNTIME_ROOT',
  configPath: 'MCP_CONFIG_PATH',
  pluginData: 'CLAUDE_PLUGIN_DATA',
  projectDir: 'CLAUDE_PROJECT_DIR',
  serverRoot: 'MCP_SERVER_ROOT',
} as const;

type LocationOption = keyof typeof OPTION_VARIABLES;

/** Every variable a setup snapshots, clears and restores, in `OPTION_VARIABLES` order. */
export const RESOURCE_LOCATION_ENV_KEYS = Object.values(OPTION_VARIABLES);

/**
 * What a test says. Each string is the value of the variable it names; leave it out and the
 * variable is unset for the test, whatever the shell exports.
 */
export interface ResourceLocationOptions {
  /** `MCP_WORKSPACE`: the profile folder (config, runtime state, `resources/<type>`). */
  workspace?: string;
  /** `MCP_RESOURCES_PATH`: the profile's own resources folder. */
  resourcesPath?: string;
  /** `MCP_RUNTIME_ROOT`. */
  runtimeRoot?: string;
  /** `MCP_CONFIG_PATH`. */
  configPath?: string;
  /** `CLAUDE_PLUGIN_DATA`. */
  pluginData?: string;
  /** `CLAUDE_PROJECT_DIR`: the project whose `.claude-prompts/` folder is searched first. */
  projectDir?: string;
  /** `MCP_SERVER_ROOT`: the package root the skills-sync CLI reads. */
  serverRoot?: string;
  /**
   * `paths.resources`, written to `<workspace>/config.jsonc`. Needs `workspace`: the list is the
   * workspace config's, and a test that has no workspace has no config file to put it in.
   */
  list?: readonly string[];
}

/** The variables an options object sets, as a child process would receive them. */
export type ResourceLocationEnv = Record<string, string>;

export interface ResourceLocationScope {
  /** Every location variable this scope has set so far, by variable name. */
  readonly env: Readonly<ResourceLocationEnv>;
  /** Set more variables on `process.env` (and write `list`) without touching the rest. */
  set(options: ResourceLocationOptions): Readonly<ResourceLocationEnv>;
  /** Clear every location variable again, then set `options`: a second setup inside one test. */
  reset(options?: ResourceLocationOptions): Readonly<ResourceLocationEnv>;
  /** Put every location variable back to what it was before this scope started. Idempotent. */
  cleanup(): void;
}

function writeLocationList(workspace: string | undefined, list: readonly string[]): void {
  if (workspace === undefined) {
    throw new Error(
      "resource-locations: `list` is the workspace config's, so it needs `workspace`."
    );
  }
  mkdirSync(workspace, { recursive: true });
  writeFileSync(
    path.join(workspace, 'config.jsonc'),
    `${JSON.stringify({ paths: { resources: list } }, null, 2)}\n`,
    'utf8'
  );
}

/**
 * The environment `options` describes, touching nothing. For a test that spawns a server or CLI
 * and hands it `env`: the child's locations are decided here and `process.env` stays as it was.
 * A `list` still writes the workspace's `config.jsonc`, since the child reads that file.
 */
export function resourceLocationEnv(options: ResourceLocationOptions = {}): ResourceLocationEnv {
  const env: Record<string, string> = {};
  for (const option of Object.keys(OPTION_VARIABLES) as LocationOption[]) {
    const value = options[option];
    if (value !== undefined) env[OPTION_VARIABLES[option]] = value;
  }
  if (options.list !== undefined) writeLocationList(options.workspace, options.list);
  return env;
}

/**
 * Clear every location variable, then set the ones `options` names, on `process.env`. The returned
 * `cleanup` restores all of them — the ones set and the ones merely cleared — to their prior
 * values, so a maintainer's exported `MCP_RESOURCES_PATH` is absent during the test and present
 * again afterward.
 */
export function withResourceLocations(
  options: ResourceLocationOptions = {}
): ResourceLocationScope {
  const original = new Map(RESOURCE_LOCATION_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of RESOURCE_LOCATION_ENV_KEYS) delete process.env[key];

  const applied: Record<string, string> = {};
  const set = (more: ResourceLocationOptions): Readonly<ResourceLocationEnv> => {
    const env = resourceLocationEnv(more);
    for (const [key, value] of Object.entries(env)) process.env[key] = value;
    Object.assign(applied, env);
    return applied;
  };
  const reset = (more: ResourceLocationOptions = {}): Readonly<ResourceLocationEnv> => {
    for (const key of RESOURCE_LOCATION_ENV_KEYS) delete process.env[key];
    for (const key of Object.keys(applied)) delete applied[key];
    return set(more);
  };
  set(options);

  return {
    get env() {
      return applied;
    },
    set,
    reset,
    cleanup() {
      for (const [key, value] of original) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

/**
 * Isolate every test in the enclosing file or `describe`: `beforeEach` clears (and sets `initial`),
 * `afterEach` restores. The returned handle's `set` and `reset` change locations inside a
 * test; the `afterEach` undoes them with the rest.
 */
export function isolateResourceLocations(
  initial: ResourceLocationOptions = {}
): Pick<ResourceLocationScope, 'set' | 'reset'> {
  let scope: ResourceLocationScope | undefined;
  beforeEach(() => {
    scope = withResourceLocations(initial);
  });
  afterEach(() => {
    scope?.cleanup();
    scope = undefined;
  });
  const active = (): ResourceLocationScope => {
    if (scope === undefined) {
      throw new Error('resource-locations: called outside a test body.');
    }
    return scope;
  };
  return {
    set: (options) => active().set(options),
    reset: (options) => active().reset(options),
  };
}

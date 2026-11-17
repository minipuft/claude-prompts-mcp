/**
 * The one way a CLI test starts a child process, and the environment that child gets.
 *
 * A maintainer's shell exports `MCP_WORKSPACE` and `MCP_RUNTIME_ROOT` at a personal library, and a
 * spawned `cpm` resolves `state.db`, config and resources from those before anything the test
 * passes. Measured 2026-11-17 with `MCP_RUNTIME_ROOT` pointed at a seeded probe database: this
 * suite wrote 46 `version_history` rows into it and failed 21 tests, while CI, where nothing
 * exports them, stayed green. Every `run()` here inherited the whole environment, by spreading
 * `process.env` or by passing no `env` at all, and the two that scrubbed chose different subsets.
 *
 * `LOCATION_ENV_KEYS` is removed from every child environment; a test that means one names it in
 * `env`, which is applied after the removal. `validate:test-location-env` (server/scripts) fails a
 * file under `cli/tests/` that imports `node:child_process` anywhere but here, so a new `run()`
 * cannot inherit the shell again.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The built CLI every integration suite drives. */
export const CPM = join(dirname(fileURLToPath(import.meta.url)), '../../dist/cpm.js');

/**
 * Every variable that decides where a `cpm` process reads and writes resources, runtime state,
 * config and the project folder. `MCP_RESOURCES_PATH` is read by nothing now and refused by the
 * server, so an exported one must not reach a child either.
 */
export const LOCATION_ENV_KEYS = [
  'MCP_WORKSPACE',
  'MCP_RUNTIME_ROOT',
  'MCP_RESOURCES_PATH',
  'MCP_CONFIG_PATH',
  'CLAUDE_PLUGIN_DATA',
  'CLAUDE_PROJECT_DIR',
] as const;

/** This process's environment without `LOCATION_ENV_KEYS`, then `overrides`. */
export function childEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of LOCATION_ENV_KEYS) delete env[key];
  return { ...env, ...overrides };
}

export interface ChildOptions {
  cwd?: string;
  /** Variables the child gets on top of `childEnv()`, location variables included. */
  env?: Record<string, string>;
  timeout?: number;
}

export interface ChildResult {
  /** The exit code; a child killed by a signal reads as 1. */
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Run `command` to completion under `childEnv(options.env)`. A child that could not be started
 * (missing binary, timeout) throws rather than reading as an ordinary non-zero exit.
 */
export function runChild(command: string, args: string[], options: ChildOptions = {}): ChildResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: childEnv(options.env),
    encoding: 'utf-8',
    timeout: options.timeout ?? 10_000,
  });
  if (result.error !== undefined) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Run the built `cpm` with `args`. */
export function runCpm(args: string[], options: ChildOptions = {}): ChildResult {
  return runChild(process.execPath, [CPM, ...args], options);
}

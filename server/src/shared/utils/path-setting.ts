// @lifecycle canonical - Refuses an operator-named directory setting that names no directory.
/**
 * Path Setting Refusal
 *
 * WHY THIS LIVES IN shared/
 * `runtime/paths.ts` (the server's composition-root `PathResolver`) and
 * `modules/skills-sync/service.ts` (a domain module, Layer 3) both refuse the same operator
 * setting -- an `MCP_WORKSPACE` or `MCP_RESOURCES_PATH` that resolves to a path that is not a
 * usable directory -- with byte-identical wording. `shared/` (Layer 0) is the one layer both a
 * domain module and the composition root may import, so it is the check's only home that keeps
 * both callers on the correct side of the module boundary. `runtime/paths.ts` keeps its own
 * config-file-specific refusal (`describeUnusableConfigFile`) and imports the pieces below for
 * the wording they share.
 */

import { statSync } from 'fs';
import { isAbsolute, resolve } from 'path';

/** An operator path setting: the flag or environment variable, and the value it was given. */
export interface PathSetting {
  name: '--config' | 'MCP_CONFIG_PATH' | '--workspace' | 'MCP_WORKSPACE' | 'MCP_RESOURCES_PATH';
  value: string;
}

/** What the process would use instead if the operator removed the setting. */
export interface PathFallback {
  label: string;
  resolved: string;
  /** Set when the fallback is itself unusable, so the advice does not send the operator into a second refusal unwarned. */
  caveat?: string;
}

/**
 * An operator path setting that cannot be used: a config file that is not a readable JSON object,
 * or a workspace or resources directory that is not there. Startup stops on it rather than serving
 * from defaults the operator did not ask for; the message is the whole explanation.
 */
export class PathSettingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathSettingError';
  }
}

/** Absolute form of a path setting's value; a relative value resolves against the working directory. */
export function resolveSettingPath(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

/**
 * Why `resolved` cannot serve as a directory setting, or `undefined` when it can.
 *
 * Checked with `stat`, not `existsSync`: a file at that path "exists" and is still no workspace.
 */
function describeUnusableDirectory(resolved: string): string | undefined {
  try {
    if (!statSync(resolved).isDirectory()) return 'is not a directory';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'does not exist';
    return `cannot be read (${code ?? String(error)})`;
  }
  return undefined;
}

/**
 * The refusal an operator reads: what was given, where it resolved, what is wrong, what to do.
 *
 * `subject` is the path that failed when it is not the setting's own value — a workspace's
 * config.json is found through `MCP_WORKSPACE` but is not the directory it names.
 */
export function formatPathSettingRefusal(details: {
  setting: PathSetting;
  resolved: string;
  problem: string;
  expected: string;
  remedy: string;
  subject?: string;
  verb?: 'start' | 'run';
}): string {
  const { setting, resolved, problem, expected, remedy, subject, verb = 'start' } = details;
  const setter = setting.name.startsWith('--')
    ? setting.name
    : `the ${setting.name} environment variable`;
  const failed = subject === undefined ? 'that path' : `its ${subject}`;
  return [
    `Refusing to ${verb}: ${setter} is set to "${setting.value}", which resolves to ${resolved}, and ${failed} ${problem}.`,
    `Expected ${expected} at that path, or ${remedy}.`,
  ].join('\n');
}

/** How to stop naming the setting, and what the process falls back to once it does. */
export function describeRemoval(setting: PathSetting, fallback: PathFallback | undefined): string {
  const removal = setting.name.startsWith('--')
    ? `remove ${setting.name}`
    : `unset ${setting.name}`;
  if (fallback === undefined) return removal;
  const caveat = fallback.caveat === undefined ? '' : ` (which ${fallback.caveat} too)`;
  return `${removal} to use ${fallback.label} at ${fallback.resolved}${caveat}`;
}

/**
 * Refuse a directory setting that names no directory; return its resolved path when it does.
 *
 * Exported for tools outside the server's startup that read the same variables, so an operator
 * sees one refusal whichever entry point reads the setting first.
 */
export function assertUsableDirectorySetting(
  setting: PathSetting,
  options: { fallback?: PathFallback; verb?: 'start' | 'run' } = {}
): string {
  const resolved = resolveSettingPath(setting.value);
  const problem = describeUnusableDirectory(resolved);
  if (problem !== undefined) {
    throw new PathSettingError(
      formatPathSettingRefusal({
        setting,
        resolved,
        problem,
        expected: 'an existing directory',
        remedy: describeRemoval(setting, options.fallback),
        ...(options.verb !== undefined && { verb: options.verb }),
      })
    );
  }
  return resolved;
}

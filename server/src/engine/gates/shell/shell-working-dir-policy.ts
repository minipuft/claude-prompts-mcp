// @lifecycle canonical - Operator-declared roots a shell_verify command may run inside.
/**
 * Shell Working Directory Roots
 *
 * WHY THIS EXISTS
 * `MCP_SHELL_VERIFY_ALLOWLIST` bounds which command a gate may run. It says nothing
 * about WHERE, and `shell_working_dir` is authored in the same file by the same
 * author (`gate-schema.ts:120`). An allowlisted `npm test` pointed at a directory the
 * author chose runs that directory's `package.json` scripts — so the allowlist
 * bounds a name whose meaning the author still supplies.
 *
 * WHY CONTAINMENT AND NOT REFUSAL
 * Ruling R7 splits the two axes by MECHANISM. `PATH` and its family REDIRECT what an
 * allowed command resolves to, so they are refused outright with no opt-out (see
 * `findUnsafeEnvironmentKeys`). A working directory only WIDENS reach: the command is
 * still the one the operator allowed. Refusing it outright would break the legitimate
 * case of verifying a sibling checkout, and an operator blocked from a legitimate
 * `npm test` reaches for `UNSAFE_ALLOW_ALL` instead — which is strictly worse than the
 * directory they wanted. So: contained by default, with an escape the operator
 * declares.
 *
 * THE DEFAULT IS NOT "ANYWHERE"
 * With this variable unset, the only permitted root is the executor's own
 * `defaultWorkingDir` — the directory the server would have used had the gate said
 * nothing. A gate that omits `shell_working_dir` is therefore unaffected, and one that
 * names a directory underneath it still works. Only an escape needs configuration.
 *
 * RETIREMENT CONDITION
 * None while `shell_working_dir` exists in the gate schema. Delete this module in the
 * same commit that removes that field.
 */

import { resolve } from 'node:path';

import { isPathInside } from '#shared/utils/path-containment.js';

/** Environment variable holding the operator's additional permitted roots. */
export const SHELL_VERIFY_ALLOWED_DIRS_ENV = 'MCP_SHELL_VERIFY_ALLOWED_DIRS';

/**
 * The one entry that permits any directory.
 *
 * Spelled identically to the command allowlist's sentinel so a fleet grep for
 * `UNSAFE_ALLOW_ALL` finds both. They are deliberately NOT the same switch: an
 * operator who accepts arbitrary commands has not thereby accepted arbitrary
 * directories, and each acceptance is stated where it applies.
 */
export const SHELL_VERIFY_ALLOW_ANY_DIR = 'UNSAFE_ALLOW_ALL';

/** Outcome of a working-directory check, carrying the reason a refusal happened. */
export interface WorkingDirDecision {
  allowed: boolean;
  /**
   * The absolute directory the spawn must use.
   *
   * Returned rather than left to the caller because a relative `shell_working_dir`
   * resolves against the SPAWNING process's cwd, not against the root it was checked
   * against — so a caller that checked one path and passed the raw string to `spawn`
   * would be measuring a different directory than the one the child lands in. Passing
   * this value back makes the checked path and the used path the same object.
   */
  resolvedDir?: string;
  /** Populated only when `allowed` is false; safe to show a caller. */
  reason?: string;
}

/**
 * Read the operator's additional permitted roots from the environment.
 *
 * Newline-separated for the same reason the command allowlist is: paths contain
 * commas far more often than newlines. A literal `\n` two-character sequence is also
 * accepted, because MCP client configuration files commonly cannot express a real
 * newline inside a value.
 */
export function loadShellVerifyAllowedDirs(
  env: NodeJS.ProcessEnv = process.env
): readonly string[] {
  const raw = env[SHELL_VERIFY_ALLOWED_DIRS_ENV];
  if (raw === undefined || raw.trim() === '') {
    return [];
  }
  return raw
    .replace(/\\n/g, '\n')
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/**
 * Decide whether `workingDir` is permitted, given the executor's default root and the
 * operator's declared roots.
 *
 * Containment is decided on RESOLVED paths by `isPathInside` — the same helper Tier
 * 2.1 landed for resource writes — because the failure being prevented is a string
 * that looks contained and resolves elsewhere. A relative `shell_working_dir` resolves
 * against `defaultRoot` rather than the server's cwd, so `../../etc` is checked as the
 * place it will actually land.
 */
export function isWorkingDirAllowed(
  workingDir: string | undefined,
  defaultRoot: string,
  operatorRoots: readonly string[]
): WorkingDirDecision {
  if (workingDir === undefined || workingDir.trim() === '') {
    return { allowed: true, resolvedDir: resolve(defaultRoot) };
  }

  const target = resolve(defaultRoot, workingDir);

  if (operatorRoots.includes(SHELL_VERIFY_ALLOW_ANY_DIR)) {
    return { allowed: true, resolvedDir: target };
  }

  const roots = [defaultRoot, ...operatorRoots.filter((r) => r !== SHELL_VERIFY_ALLOW_ANY_DIR)];

  for (const root of roots) {
    if (isPathInside(resolve(root), target)) {
      return { allowed: true, resolvedDir: target };
    }
  }

  return {
    allowed: false,
    reason:
      `shell_working_dir resolves to ${target}, which is outside every permitted root. ` +
      `Permitted: ${roots.join(', ')}. Add the root to ${SHELL_VERIFY_ALLOWED_DIRS_ENV} ` +
      `(newline-separated) if this server may verify there.`,
  };
}

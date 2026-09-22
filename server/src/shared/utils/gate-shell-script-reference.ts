// @lifecycle canonical - Decides which shell_verify argument names a file the gate ships with.
/**
 * A `shell_verify` argument that names a file INSIDE the gate — recognised once, for both halves.
 *
 * WHY THIS EXISTS. `resources/gates/handoff-artifacts/check-artifacts.js` ships beside its
 * `gate.yaml` and is run by that gate's `shell_command`. Named relative to the SERVER's working
 * directory it is broken on both halves at once: the spawn resolves it against whatever cwd the
 * client launched the server in (`ShellVerifyExecutor` defaults to `process.cwd()`), and
 * `resourceFileSet` cannot claim it, because a path relative to the process cwd is exactly the
 * unbounded reference that module refuses — so a checkpoint recorded the gate without its script
 * and a rollback restored a gate that could not run.
 *
 * Named relative to the GATE ROOT it is an ordinary declared reference, the same kind as
 * `guidanceFile`, and both halves work: the enumerator claims it under the containment rules it
 * already applies, and the runner resolves it against the root the loader stamped on the
 * definition.
 *
 * THE BOUND. An argument is a candidate only when it is relative, carries a file extension, and is
 * not a flag. The extension is what keeps `['npm', 'test']` out of this: `test` names a subcommand,
 * and a gate directory that happened to contain a file called `test` would otherwise have its
 * argument rewritten into a path. Existence and containment are checked by the CALLER, each with
 * the machinery it already has — the enumerator through `FileSetBuilder.addReference`, which
 * realpaths and refuses an escape, and the runner through an existence check under the gate root.
 * That split is deliberate: this module states the shape, and neither consumer gets a second
 * opinion about what counts as part of a resource.
 */

import * as path from 'node:path';

/**
 * The arguments of `command` that name a file the gate may ship with, in order.
 *
 * Index 0 is never a candidate: it is the program, bounded by `MCP_SHELL_VERIFY_ALLOWLIST`, and an
 * allowlist entry naming a path inside a gate would let a gate author ship an executable and name
 * it as the command. A gate ships SCRIPTS, run by an interpreter the operator allowed.
 */
export function gateShellScriptReferences(command: readonly string[]): string[] {
  return command.filter((argument, index) => index > 0 && isGateRelativeFileArgument(argument));
}

/** A relative, extension-carrying, non-flag argument — the shape of a shipped script. */
function isGateRelativeFileArgument(argument: string): boolean {
  if (argument === '' || argument.startsWith('-')) return false;
  if (path.isAbsolute(argument)) return false;
  const base = path.basename(argument);
  return base.includes('.') && !base.startsWith('.');
}

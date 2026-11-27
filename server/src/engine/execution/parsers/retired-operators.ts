// @lifecycle canonical - Refuses the command operator spellings the retirement ledger names.
/**
 * Two operator spellings are refused at the parse boundary, before any parsing strategy runs:
 * the `@` framework sigil (`^` is the framework operator) and the `=` gate operator (`::` is the
 * gate operator). `UnifiedCommandParser.parseCommand` calls both beside the reserved-operator and
 * gate-text refusals, on the command the strategies would parse, so a refused spelling never
 * reaches a strategy. Each refusal takes its wording from the retirement ledger through
 * its generated projection, so the replacement is written once.
 */

import { findSigilOperatorsOutsideQuotes, isPositionInsideQuotes } from './parser-utils.js';

import type { FrameworkIdLookup } from './symbolic-operator-parser.js';

import * as retirementNotices from '#shared/utils/_generated/retirement-notices.js';
import { ValidationError } from '#shared/utils/index.js';

/**
 * `@<id>` where `^<id>` would be read as the framework operator: at the start of the command,
 * right after its leading `>>` marker, or after whitespace. The rest of operator position (outside
 * quotes, the id ending at whitespace, the end or `, ; : ) ] } >`) is
 * `findSigilOperatorsOutsideQuotes`', the same rule the `^` operator is read by.
 */
const AT_FRAMEWORK_SIGIL = /(?:^(?:>>\s*)?|\s)@([A-Za-z0-9_-]+)(?![A-Za-z0-9_-])/g;

/**
 * The `=` gate operator: whitespace, `=` not followed by `=` or `>`, then a named criterion
 * (`id:"text"`), a quoted criterion or one unquoted word. `==`, `=>`, `==>`, `key=value` and an
 * `=` inside quotes never match.
 */
const EQUALS_GATE_OPERATOR =
  /\s=(?![=>])\s*(?:[a-z][a-z0-9_-]*:["'][^"']+["']|["'][^"']+["']|[^\s"']+)/gi;

/**
 * Refuse `@<id>` in operator position when `<id>` names a registered framework, naming the `^`
 * spelling to write instead. Any other `@word` (no registered framework, a mention, an email
 * address, a file reference, text inside quotes) is left to parse as ordinary text. Without a
 * lookup no framework is known, so nothing is refused.
 */
export function rejectAtFrameworkSigil(
  command: string,
  isRegisteredFramework: FrameworkIdLookup | undefined
): void {
  if (isRegisteredFramework === undefined) return;
  const refused = findSigilOperatorsOutsideQuotes(command, AT_FRAMEWORK_SIGIL).find((match) =>
    isRegisteredFramework(match.frameworkId.toUpperCase())
  );
  if (refused === undefined) return;
  const notice = retirementNotices.commandFrameworkAtSigil;
  throw new ValidationError(
    `Refused \`@${refused.frameworkId}\`: ${notice.retired} was retired in ${notice.refusedIn}. ` +
      `Use ${notice.replacement}: \`^${refused.frameworkId}\`.`
  );
}

/** Refuse the `=` gate operator, naming the `::` spelling of the same criterion. */
export function rejectEqualsGateOperator(command: string): void {
  for (const match of command.matchAll(EQUALS_GATE_OPERATOR)) {
    if (isPositionInsideQuotes(command, match.index)) continue;
    const typed = match[0].trim();
    const notice = retirementNotices.commandGateEqualsOperator;
    throw new ValidationError(
      `Refused \`${typed}\`: ${notice.retired} was retired in ${notice.refusedIn}. ` +
        `Use ${notice.replacement}: \`${typed.replace(/^=\s*/, ':: ')}\`.`
    );
  }
}

// @lifecycle canonical - Why an inline gate's criteria cannot register, and the refusal text that says so.
/**
 * One wording for every inline-criteria refusal (R11.8). Stage 05 refuses a parsed command's
 * blank criteria through `InlineGateProcessor.invalidCriteria`; the command parser refuses an
 * empty quoted criterion (`:: ""`) itself, because the gate grammar's quoted text is `[^"']+` and
 * an empty one never becomes a gate token stage 05 could see. Both read this module, which imports
 * nothing, so the parser reaches it without the cycle importing the processor would close.
 */

/** The accepted inline gate syntax, quoted by every criteria refusal (R11.8). */
const INLINE_GATE_SYNTAX =
  'Accepted forms: `:: "criterion"`, `:: id:"criterion"`, `:: verify:"command"`.';

/**
 * Why `criteria` cannot register as an inline gate, or undefined when it can. An absent or empty
 * list is no gate at all (the command builder writes `[]` on a step that declared none), so it is
 * a problem only when `required`: a named gate always declares one, and the command builder leaves
 * it with none when its quoted text is blank (`:: id:"  "`). PURE.
 */
export function inlineCriteriaProblem(
  criteria: readonly unknown[] | undefined,
  required = false
): string | undefined {
  if (criteria === undefined || criteria.length === 0) {
    return required ? 'carries no criterion: the text between its quotes is blank' : undefined;
  }
  const index = criteria.findIndex((item) => typeof item !== 'string' || item.trim().length === 0);
  if (index === -1) {
    return undefined;
  }
  const item = criteria[index];
  return typeof item === 'string'
    ? `has the criterion ${JSON.stringify(item)}, which is ${item.length === 0 ? 'empty' : 'blank'}`
    : `has criterion ${index + 1}, which is not text`;
}

/** The refusal text for `subject` whose criteria have `problem`: what, why, and the accepted syntax. */
export function criteriaRefusalDetail(subject: string, problem: string): string {
  return (
    `${subject} ${problem}. A criterion is the text the output is reviewed against, so without ` +
    `one the gate could neither pass nor fail, and running without it would enforce nothing you ` +
    `asked for. ${INLINE_GATE_SYNTAX}`
  );
}

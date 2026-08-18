// @lifecycle canonical - Registry of phase-guard content criteria: how each is evaluated, and whether it may be declared to the model.
/**
 * Phase Guard Criteria Registry
 *
 * One entry per content criterion a `phases.yaml` `guards:` block can carry. Each entry owns BOTH
 * halves of that criterion: how it is evaluated against a section, and whether it may be declared
 * to the model in the prompt. Adding a criterion is one entry here — the evaluator and the
 * prompt-time declaration renderer both read this list and know no criterion by name.
 *
 * `required` is deliberately NOT in this registry. It is not a content criterion: it decides
 * whether the section was found at all, and a missing section short-circuits every entry below.
 * That addressing role belongs to the evaluator, which handles it before this list runs.
 *
 * ## Polarity, and why negative criteria may never be declared
 *
 * A POSITIVE criterion states what the section must contain. Declaring it up front is safe and
 * often necessary: `contains_any` carries keyword lists no model can infer, so leaving it
 * undeclared spends a retry teaching the model something the framework already knew.
 *
 * A NEGATIVE criterion states what the section must NOT contain. Declaring one hands over the
 * evasion target — telling a model which patterns are rejected describes exactly what to avoid
 * emitting rather than what not to do. That distinction is load-bearing for the intended future
 * use of `matches_pattern` as a sensitive-data check, so it is enforced by the TYPE here
 * (`declare?: never` on negatives) rather than by convention: a negative criterion that tries to
 * declare itself is a compile error, not a review comment.
 */

import type { PhaseGuardCheckResult } from './types.js';
import type { ProcessingStep } from '../types/framework-types.js';

type PhaseGuards = NonNullable<ProcessingStep['guards']>;

/** Content criteria only. `required` is addressing, handled by the evaluator. */
export type CriterionKey = Exclude<keyof PhaseGuards, 'required'>;

interface CriterionBase {
  /** The `guards:` field this criterion reads. Also the `type` on its check result. */
  readonly key: CriterionKey;
  /** True when this phase's guards actually configure this criterion. */
  applies(guards: PhaseGuards): boolean;
  evaluate(guards: PhaseGuards, content: string, sectionHeader: string): PhaseGuardCheckResult;
}

/** States what the section MUST contain. Safe to tell the model in advance. */
interface PositiveCriterion extends CriterionBase {
  readonly polarity: 'positive';
  /**
   * One line of prompt-time declaration, or `null` when this criterion is evaluated but
   * deliberately not declared — recoverable from retry feedback alone, so declaring it would
   * spend tokens on every step to prevent a failure that self-corrects in one turn.
   */
  declare(guards: PhaseGuards): string | null;
}

/** States what the section must NOT contain. Never declarable — see the polarity note above. */
interface NegativeCriterion extends CriterionBase {
  readonly polarity: 'negative';
  readonly declare?: never;
}

export type GuardCriterion = PositiveCriterion | NegativeCriterion;

const lower = (value: string): string => value.toLowerCase();
const quoted = (values: readonly string[]): string => values.map((v) => `"${v}"`).join(', ');

/**
 * Evaluation order is preserved from the pre-registry implementation. Check order is observable —
 * it is the order failures appear in retry feedback — so reordering this array changes what the
 * model reads first on a retry.
 */
export const GUARD_CRITERIA: readonly GuardCriterion[] = [
  {
    key: 'min_length',
    polarity: 'positive',
    applies: (guards: PhaseGuards): boolean => guards.min_length !== undefined,
    evaluate: (
      guards: PhaseGuards,
      content: string,
      sectionHeader: string
    ): PhaseGuardCheckResult => {
      const min = guards.min_length ?? 0;
      const len = content.length;
      return {
        type: 'min_length',
        passed: len >= min,
        expected: min,
        actual: len,
        feedback:
          len >= min
            ? ''
            : `Section "${sectionHeader}" is too short (${len} chars). Expand to at least ${min} characters.`,
      };
    },
    // Not declared: a length failure names its own exact threshold in retry feedback, and
    // "write substantively" is already the default behavior a step prompt asks for.
    declare: (): string | null => null,
  },
  {
    key: 'max_length',
    polarity: 'positive',
    applies: (guards: PhaseGuards): boolean => guards.max_length !== undefined,
    evaluate: (
      guards: PhaseGuards,
      content: string,
      sectionHeader: string
    ): PhaseGuardCheckResult => {
      const max = guards.max_length ?? Number.POSITIVE_INFINITY;
      const len = content.length;
      return {
        type: 'max_length',
        passed: len <= max,
        expected: max,
        actual: len,
        feedback:
          len <= max
            ? ''
            : `Section "${sectionHeader}" is too long (${len} chars). Reduce to at most ${max} characters.`,
      };
    },
    // Declared: unlike a minimum, an unstated ceiling is invisible until it is breached, and the
    // model cannot shorten what it has already been asked to produce without a second turn.
    declare: (guards: PhaseGuards): string | null =>
      guards.max_length === undefined ? null : `at most ${guards.max_length} characters`,
  },
  {
    key: 'contains_any',
    polarity: 'positive',
    applies: (guards: PhaseGuards): boolean => (guards.contains_any?.length ?? 0) > 0,
    evaluate: (
      guards: PhaseGuards,
      content: string,
      sectionHeader: string
    ): PhaseGuardCheckResult => {
      const keywords = guards.contains_any ?? [];
      const contentLower = lower(content);
      const found = keywords.filter((kw) => contentLower.includes(lower(kw)));
      return {
        type: 'contains_any',
        passed: found.length > 0,
        expected: keywords,
        actual: found,
        feedback:
          found.length > 0
            ? ''
            : `Section "${sectionHeader}" must include at least one of: ${quoted(keywords)}.`,
      };
    },
    // Declared: a keyword list is unguessable. Leaving it undeclared spends one of the two
    // available retries teaching the model a vocabulary the framework already declared.
    declare: (guards: PhaseGuards): string | null => {
      const keywords = guards.contains_any ?? [];
      return keywords.length === 0 ? null : `mentions one of ${quoted(keywords)}`;
    },
  },
  {
    key: 'contains_all',
    polarity: 'positive',
    applies: (guards: PhaseGuards): boolean => (guards.contains_all?.length ?? 0) > 0,
    evaluate: (
      guards: PhaseGuards,
      content: string,
      sectionHeader: string
    ): PhaseGuardCheckResult => {
      const keywords = guards.contains_all ?? [];
      const contentLower = lower(content);
      const missing = keywords.filter((kw) => !contentLower.includes(lower(kw)));
      return {
        type: 'contains_all',
        passed: missing.length === 0,
        expected: keywords,
        actual: keywords.filter((kw) => contentLower.includes(lower(kw))),
        feedback:
          missing.length === 0
            ? ''
            : `Section "${sectionHeader}" is missing required terms: ${quoted(missing)}.`,
      };
    },
    declare: (guards: PhaseGuards): string | null => {
      const keywords = guards.contains_all ?? [];
      return keywords.length === 0 ? null : `mentions all of ${quoted(keywords)}`;
    },
  },
  {
    key: 'matches_pattern',
    polarity: 'negative',
    applies: (guards: PhaseGuards): boolean =>
      guards.matches_pattern !== undefined && guards.matches_pattern !== '',
    evaluate: (
      guards: PhaseGuards,
      content: string,
      sectionHeader: string
    ): PhaseGuardCheckResult => {
      const pattern = guards.matches_pattern ?? '';
      let passed = false;
      // No initializer: both the try and the catch assign it.
      let feedback: string;
      try {
        passed = new RegExp(pattern, 'i').test(content);
        feedback = passed
          ? ''
          : `Section "${sectionHeader}" does not match required pattern: /${pattern}/i.`;
      } catch {
        feedback = `Invalid phase guard pattern for "${sectionHeader}": "${pattern}" is not a valid regex.`;
      }
      return { type: 'matches_pattern', passed, expected: pattern, actual: passed, feedback };
    },
  },
  {
    key: 'forbidden_terms',
    polarity: 'negative',
    applies: (guards: PhaseGuards): boolean => (guards.forbidden_terms?.length ?? 0) > 0,
    evaluate: (
      guards: PhaseGuards,
      content: string,
      sectionHeader: string
    ): PhaseGuardCheckResult => {
      const terms = guards.forbidden_terms ?? [];
      const found = terms.filter((kw) => {
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b`, 'i').test(content);
      });
      return {
        type: 'forbidden_terms',
        passed: found.length === 0,
        expected: [],
        actual: found,
        feedback:
          found.length === 0
            ? ''
            : `Section "${sectionHeader}" contains forbidden terms: ${quoted(found)}. Remove these.`,
      };
    },
  },
];

/**
 * The prompt-time declaration for a phase's content criteria: every configured criterion that is
 * both declarable and has something to say. Negative criteria are structurally absent — they have
 * no `declare` to call.
 */
export function declareCriteria(guards: PhaseGuards | undefined): string[] {
  if (!guards) {
    return [];
  }

  const declarations: string[] = [];
  for (const criterion of GUARD_CRITERIA) {
    if (criterion.polarity !== 'positive' || !criterion.applies(guards)) {
      continue;
    }
    const line = criterion.declare(guards);
    if (line !== null && line !== '') {
      declarations.push(line);
    }
  }
  return declarations;
}

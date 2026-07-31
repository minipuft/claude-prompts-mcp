// @lifecycle canonical - Evaluates framework phase guards against model output.
/**
 * Phase Guard Evaluator
 *
 * Pure-function service that evaluates LLM output against framework phase guards.
 * Zero external dependencies. Takes output text + phase definitions, returns structured results.
 */

import { splitBySectionHeaders } from './section-splitter.js';

import type {
  PhaseGuardCheckResult,
  PhaseGuardEvaluationResult,
  PhaseGuardResult,
} from './types.js';
import type { ProcessingStep } from '../types/methodology-types.js';

/**
 * Evaluate LLM output against all phase guards.
 *
 * Only phases with both a `section_header` and `guards` are checked.
 * Phases without guards are silently skipped.
 *
 * @param output - Full LLM output text
 * @param phases - Processing steps from framework (may include steps without guards)
 * @returns Structured evaluation result with per-phase details and concatenated feedback
 */
export function evaluatePhaseGuards(
  output: string,
  phases: ProcessingStep[]
): PhaseGuardEvaluationResult {
  const phasesWithGuards = phases.filter(
    (
      p
    ): p is ProcessingStep & {
      section_header: string;
      guards: NonNullable<ProcessingStep['guards']>;
    } => !!p.section_header && !!p.guards
  );

  if (phasesWithGuards.length === 0) {
    return { allPassed: true, results: [], failedPhases: [], retryFeedback: '' };
  }

  const sectionHeaders = phasesWithGuards.map((p) => p.section_header);
  const sections = splitBySectionHeaders(output, sectionHeaders);

  const results: PhaseGuardResult[] = phasesWithGuards.map((phase) => {
    const section = sections.get(phase.section_header);
    const found = !!section;
    const content = section?.content ?? '';

    const checks = evaluateStepGuards(phase.guards, content, found, phase.section_header);
    const passed = checks.every((c) => c.passed);

    return {
      phase: phase.id,
      section_header: phase.section_header,
      found,
      checks,
      passed,
    };
  });

  const failedPhases = results.filter((r) => !r.passed).map((r) => r.phase);
  const allPassed = failedPhases.length === 0;

  const retryFeedback = buildRetryFeedback(results);

  return { allPassed, results, failedPhases, retryFeedback };
}

/**
 * Evaluate all guard rules for a single phase step.
 */
function evaluateStepGuards(
  guards: NonNullable<ProcessingStep['guards']>,
  content: string,
  sectionFound: boolean,
  sectionHeader: string
): PhaseGuardCheckResult[] {
  const checks: PhaseGuardCheckResult[] = [];

  // required: section must exist
  if (guards.required) {
    checks.push({
      type: 'required',
      passed: sectionFound,
      expected: true,
      actual: sectionFound,
      feedback: sectionFound
        ? ''
        : `Missing required section "${sectionHeader}". Add this section to your response.`,
    });

    // If required section missing, skip remaining checks (they'd all fail on empty content)
    if (!sectionFound) {
      return checks;
    }
  }

  // If section not found and not required, skip content checks
  if (!sectionFound) {
    return checks;
  }

  // min_length: content must be at least N characters
  if (guards.min_length !== undefined) {
    const len = content.length;
    checks.push({
      type: 'min_length',
      passed: len >= guards.min_length,
      expected: guards.min_length,
      actual: len,
      feedback:
        len >= guards.min_length
          ? ''
          : `Section "${sectionHeader}" is too short (${len} chars). Expand to at least ${guards.min_length} characters.`,
    });
  }

  // max_length: content must not exceed N characters
  if (guards.max_length !== undefined) {
    const len = content.length;
    checks.push({
      type: 'max_length',
      passed: len <= guards.max_length,
      expected: guards.max_length,
      actual: len,
      feedback:
        len <= guards.max_length
          ? ''
          : `Section "${sectionHeader}" is too long (${len} chars). Reduce to at most ${guards.max_length} characters.`,
    });
  }

  // contains_any: content must include at least one of the keywords
  if (guards.contains_any && guards.contains_any.length > 0) {
    const contentLower = content.toLowerCase();
    const found = guards.contains_any.filter((kw) => contentLower.includes(kw.toLowerCase()));
    checks.push({
      type: 'contains_any',
      passed: found.length > 0,
      expected: guards.contains_any,
      actual: found,
      feedback:
        found.length > 0
          ? ''
          : `Section "${sectionHeader}" must include at least one of: ${guards.contains_any.map((k) => `"${k}"`).join(', ')}.`,
    });
  }

  // contains_all: content must include all keywords
  if (guards.contains_all && guards.contains_all.length > 0) {
    const contentLower = content.toLowerCase();
    const missing = guards.contains_all.filter((kw) => !contentLower.includes(kw.toLowerCase()));
    checks.push({
      type: 'contains_all',
      passed: missing.length === 0,
      expected: guards.contains_all,
      actual: guards.contains_all.filter((kw) => contentLower.includes(kw.toLowerCase())),
      feedback:
        missing.length === 0
          ? ''
          : `Section "${sectionHeader}" is missing required terms: ${missing.map((k) => `"${k}"`).join(', ')}.`,
    });
  }

  // matches_pattern: content must match regex
  if (guards.matches_pattern) {
    let passed = false;
    let feedback = '';
    try {
      const regex = new RegExp(guards.matches_pattern, 'i');
      passed = regex.test(content);
      feedback = passed
        ? ''
        : `Section "${sectionHeader}" does not match required pattern: /${guards.matches_pattern}/i.`;
    } catch {
      feedback = `Invalid phase guard pattern for "${sectionHeader}": "${guards.matches_pattern}" is not a valid regex.`;
    }
    checks.push({
      type: 'matches_pattern',
      passed,
      expected: guards.matches_pattern,
      actual: passed,
      feedback,
    });
  }

  // forbidden_terms: content must NOT include any of the keywords (word-boundary match)
  if (guards.forbidden_terms && guards.forbidden_terms.length > 0) {
    const found = guards.forbidden_terms.filter((kw) => {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`, 'i').test(content);
    });
    checks.push({
      type: 'forbidden_terms',
      passed: found.length === 0,
      expected: [],
      actual: found,
      feedback:
        found.length === 0
          ? ''
          : `Section "${sectionHeader}" contains forbidden terms: ${found.map((k) => `"${k}"`).join(', ')}. Remove these.`,
    });
  }

  return checks;
}

/**
 * Build a structured markdown summary of passed phase guard results.
 * Injected into gate review prompts so the LLM reviewer knows structure is verified
 * and can focus on content quality.
 */
export function buildPhaseGuardPassSummary(result: PhaseGuardEvaluationResult): string {
  const total = result.results.length;
  const lines: string[] = [
    '## Structural Verification: PASS',
    '',
    `Deterministic phase guard checks passed (${total}/${total} phases verified):`,
  ];

  for (const phase of result.results) {
    const checkCount = phase.checks.length;
    lines.push(`- **${phase.phase}**: found, ${checkCount}/${checkCount} checks passed`);
  }

  lines.push('');
  lines.push(
    'Structure is verified. Focus your review on **content quality** — depth of analysis, actionability, and adherence to gate criteria below.'
  );

  return lines.join('\n');
}

/**
 * Build concatenated retry feedback from failed phase results.
 */
function buildRetryFeedback(results: PhaseGuardResult[]): string {
  const failedResults = results.filter((r) => !r.passed);
  if (failedResults.length === 0) return '';

  const lines: string[] = [
    '## Phase Guard Failures',
    '',
    'Your response did not meet the following structural requirements:',
    '',
  ];

  for (const result of failedResults) {
    const failedChecks = result.checks.filter((c) => !c.passed);
    for (const check of failedChecks) {
      if (check.feedback) {
        lines.push(`- ${check.feedback}`);
      }
    }
  }

  lines.push('');
  lines.push('Please revise your response to address these issues.');

  return lines.join('\n');
}

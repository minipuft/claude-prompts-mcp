// @lifecycle canonical - Evaluates framework phase guards against model output.
/**
 * Phase Guard Evaluator
 *
 * Pure-function service that evaluates LLM output against framework phase guards.
 * Zero external dependencies. Takes output text + phase definitions, returns structured results.
 */

import { GUARD_CRITERIA } from './criteria.js';
import { splitBySectionHeaders } from './section-splitter.js';

import type {
  PhaseGuardCheckResult,
  PhaseGuardEvaluationResult,
  PhaseGuardResult,
} from './types.js';
import type { ProcessingStep } from '../types/framework-types.js';

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

  // Content criteria come from the registry — this function knows none of them by name, so
  // adding a criterion is one entry in `criteria.ts` rather than another branch here.
  for (const criterion of GUARD_CRITERIA) {
    if (criterion.applies(guards)) {
      checks.push(criterion.evaluate(guards, content, sectionHeader));
    }
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

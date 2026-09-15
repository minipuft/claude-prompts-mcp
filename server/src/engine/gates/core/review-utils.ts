// @lifecycle canonical - Helpers for gate confirmation parsing and normalization.
import { parseLLMReview } from './llm-review-parser.js';
import {
  resolveJudgeConfig,
  isJudgeMode,
  buildJudgeEnvelope,
  renderJudgePrompt,
} from '../judge/judge-prompt-builder.js';

import type { GateDefinitionProvider } from './gate-loader.js';
import type { GateReviewPrompt } from '../../execution/types.js';
import type { JudgeEvaluationDefaults } from '../judge/types.js';
import type { LightweightGateDefinition } from '../types.js';

export interface ReviewPromptTimestamps {
  createdAt?: number;
  updatedAt?: number;
  previousResponseAt?: number;
}

export interface ComposedReviewPrompt {
  combinedPrompt: string;
  gateIds: string[];
  instructions: string[];
  prompts: GateReviewPrompt[];
  createdAt: number;
  metadata: {
    previousResponse?: string;
    retryHints: string[];
    timestamps?: ReviewPromptTimestamps;
  };
}

const DEFAULT_INSTRUCTIONS = [
  'Respond explicitly with `GATE_REVIEW: PASS` or `GATE_REVIEW: FAIL`.',
  'Include a concise justification referencing the gate criteria.',
];

/**
 * Build a deduplicated list of explicit review instructions pulled from gate prompts.
 * Falls back to the default instruction set when gates omit their own directives.
 */
export function buildReviewInstructions(prompts: GateReviewPrompt[]): string[] {
  const uniqueInstructions: string[] = [];
  const seen = new Set<string>();

  for (const prompt of prompts) {
    for (const instruction of prompt.explicitInstructions ?? []) {
      const normalized = instruction.trim();
      if (!normalized) {
        continue;
      }

      const key = normalized.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        uniqueInstructions.push(normalized);
      }
    }
  }

  if (uniqueInstructions.length === 0) {
    return [...DEFAULT_INSTRUCTIONS];
  }

  return uniqueInstructions;
}

/**
 * Compose a unified markdown prompt covering every gate review request.
 */
export function composeReviewPrompt(
  prompts: GateReviewPrompt[],
  previousResponse?: string,
  retryHints: string[] = [],
  timestamps?: ReviewPromptTimestamps
): ComposedReviewPrompt {
  const gateIds = prompts
    .map((prompt) => prompt.gateId)
    .filter((gateId): gateId is string => typeof gateId === 'string' && gateId.length > 0);

  const createdAt = timestamps?.createdAt ?? Date.now();
  const instructions = buildReviewInstructions(prompts);
  const instructionBlock = instructions.map((instruction) => `- ${instruction}`).join('\n');

  const gateSections = prompts.map((prompt, index) => {
    const sectionHeading = prompt.gateId
      ? ` [Gate Review] ${prompt.gateId}`
      : ` [Gate Review] Criteria ${index + 1}`;
    const summary = prompt.criteriaSummary.trim();
    const template = prompt.promptTemplate?.trim();
    const templateBlock = template ? `\n${template}` : '';

    return `${sectionHeading}\n${summary}${templateBlock}`;
  });

  const retryBlock =
    retryHints.length > 0
      ? ['Retry Hints:', ...retryHints.map((hint) => `- ${hint.trim()}`)].join('\n')
      : '';

  const previousResponseBlock =
    previousResponse && previousResponse.trim().length > 0
      ? ['Previous Assistant Response:', '```', previousResponse.trim(), '```'].join('\n')
      : '';

  // Phase : Add execution context section (original arguments and previous step results)
  const contextSections: string[] = [];
  const executionContext = prompts[0]?.executionContext;

  if (executionContext && Object.keys(executionContext.originalArgs).length > 0) {
    contextSections.push('## Original Request & Delivery Context');
    contextSections.push('');
    contextSections.push('Verify that the output satisfies the original request intent:');
    contextSections.push('');
    Object.entries(executionContext.originalArgs).forEach(([key, value]) => {
      // Truncate long values to prevent overwhelming the review prompt
      const truncatedValue =
        String(value).length > 200 ? String(value).substring(0, 200) + '...' : String(value);
      contextSections.push(`- **${key}**: ${truncatedValue}`);
    });
    contextSections.push('');
    contextSections.push('After evaluating quality gates, assess delivery:');
    contextSections.push('- Does the output address what was originally asked for?');
    contextSections.push(
      '- Are there aspects of the request that were missed or partially addressed?'
    );
  }

  if (executionContext && Object.keys(executionContext.previousResults).length > 0) {
    if (contextSections.length > 0) {
      contextSections.push(''); // Add spacing between sections
    }
    contextSections.push('Previous Step Results:');
    Object.entries(executionContext.previousResults).forEach(([step, result]) => {
      // Truncate long results to prevent overwhelming the review prompt
      const truncatedResult = result.length > 400 ? result.substring(0, 400) + '...' : result;
      contextSections.push(`- Step ${parseInt(step, 10) + 1}: ${truncatedResult}`);
    });
  }

  const executionContextBlock = contextSections.length > 0 ? contextSections.join('\n') : '';

  const segments = [
    ' [Gate Review] Quality Gate Self-Review',
    'Respond exactly with `GATE_REVIEW: PASS` or `GATE_REVIEW: FAIL` before continuing.',
    executionContextBlock, // Phase : Insert execution context after header
    'Instructions:',
    instructionBlock,
    gateSections.join('\n\n'),
    retryBlock,
    previousResponseBlock,
  ].filter((segment) => segment && segment.trim().length > 0);

  const combinedPrompt = segments.join('\n\n');

  const metadata: {
    previousResponse?: string;
    retryHints: string[];
    timestamps?: ReviewPromptTimestamps;
  } = {
    retryHints: retryHints.map((hint) => hint.trim()).filter((hint) => hint.length > 0),
  };

  const normalizedPreviousResponse = previousResponse?.trim();
  if (normalizedPreviousResponse) {
    metadata.previousResponse = normalizedPreviousResponse;
  }
  if (timestamps) {
    metadata.timestamps = timestamps;
  }

  return {
    combinedPrompt,
    gateIds,
    instructions,
    prompts,
    createdAt,
    metadata,
  };
}

// ============================================================================
// Judge Gate Resolution & Composition
// ============================================================================

/**
 * The criteria text a judge is given for one gate.
 *
 * `guidance` is all of it. A `pass_criteria` entry contributes nothing: the only fields this
 * ever rendered as prose were min_length/max_length/required_patterns/forbidden_patterns, which
 * had no evaluator (B9) and are now refused at load, and the structured types (`shell_verify`,
 * `script_tool`, `framework_compliance`) were never rendered here — they are run by the engine
 * and their verdict reaches the judge as a result, not as a criterion to assess.
 */
function collectGateCriteria(gate: LightweightGateDefinition): string[] {
  return gate.guidance ? [gate.guidance] : [];
}

/**
 * Categorize gate IDs into judge and self gates based on evaluation config.
 * Gates that cannot be loaded are silently skipped.
 */
export async function resolveJudgeGates(
  gateIds: string[],
  loader: GateDefinitionProvider,
  globalDefaults?: Partial<JudgeEvaluationDefaults>
): Promise<{ judgeGates: LightweightGateDefinition[]; selfGates: LightweightGateDefinition[] }> {
  const gates = await loader.loadGates(gateIds);
  const judgeGates: LightweightGateDefinition[] = [];
  const selfGates: LightweightGateDefinition[] = [];

  for (const gate of gates) {
    const resolved = resolveJudgeConfig(gate.evaluation, globalDefaults);
    if (isJudgeMode(resolved)) {
      judgeGates.push(gate);
    } else {
      selfGates.push(gate);
    }
  }

  return { judgeGates, selfGates };
}

export interface ComposedJudgeReviewPrompt {
  hasJudgeGates: boolean;
  judgePrompt: string;
  judgeGateIds: string[];
  modelHint?: string;
}

/**
 * Compose a context-isolated judge review prompt from judge-mode gates.
 * Delegates to judge-prompt-builder primitives for envelope construction and rendering.
 * Strips all generation context — judge sees only output + criteria.
 */
export function composeJudgeReviewPrompt(
  judgeGates: LightweightGateDefinition[],
  output: string
): ComposedJudgeReviewPrompt {
  if (judgeGates.length === 0) {
    return { hasJudgeGates: false, judgePrompt: '', judgeGateIds: [] };
  }

  const judgeGateIds = judgeGates.map((g) => g.id);
  const modelHint = judgeGates.find((g) => g.evaluation?.model)?.evaluation?.model;

  const firstResolved = resolveJudgeConfig(judgeGates[0]!.evaluation);
  const strict = firstResolved.strict;

  if (judgeGates.length === 1) {
    const gate = judgeGates[0]!;
    const criteria = collectGateCriteria(gate);
    const envelope = buildJudgeEnvelope(output, gate.name, gate.id, criteria, strict);
    return {
      hasJudgeGates: true,
      judgePrompt: renderJudgePrompt(envelope),
      judgeGateIds,
      modelHint,
    };
  }

  // Multiple gates: merge criteria under "Combined Review" heading
  const allCriteria: string[] = [];
  for (const gate of judgeGates) {
    allCriteria.push(...collectGateCriteria(gate));
  }

  const combinedId = judgeGateIds.join(',');
  const envelope = buildJudgeEnvelope(output, 'Combined Review', combinedId, allCriteria, strict);
  return { hasJudgeGates: true, judgePrompt: renderJudgePrompt(envelope), judgeGateIds, modelHint };
}

export { parseLLMReview };

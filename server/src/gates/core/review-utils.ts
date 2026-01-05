// @lifecycle canonical - Helpers for gate confirmation parsing and normalization.
import { parseLLMReview } from './llm-review-parser.js';

import type { GateReviewPrompt } from '../../execution/types.js';

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
    contextSections.push('Original Arguments:');
    Object.entries(executionContext.originalArgs).forEach(([key, value]) => {
      // Truncate long values to prevent overwhelming the review prompt
      const truncatedValue =
        String(value).length > 200 ? String(value).substring(0, 200) + '...' : String(value);
      contextSections.push(`- ${key}: ${truncatedValue}`);
    });
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

export { parseLLMReview };

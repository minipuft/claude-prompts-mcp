// @lifecycle canonical - Shared utilities for detecting framework guidance in text.
/**
 * Framework Detection Utilities
 *
 * Provides shared functions for detecting framework guidance presence
 * in system messages and other text content. Consolidates duplicate
 * detection logic from multiple pipeline stages.
 */

/**
 * Indicators that framework-specific guidance is present in text.
 * Used to prevent duplicate injection of framework system prompts.
 */
export const FRAMEWORK_INDICATORS = [
  'Apply the C.A.G.E.E.R.F methodology systematically',
  'Apply the ReACT methodology systematically',
  'Apply the 5W1H methodology systematically',
  'Apply the SCAMPER methodology systematically',
  'You are operating under the C.A.G.E.E.R.F',
  'You are operating under the ReACT',
  'You are operating under the 5W1H',
  'You are operating under the SCAMPER',
  '**Context**: Establish comprehensive situational awareness', // CAGEERF specific
  '**Reasoning**: Think through the problem', // ReACT specific
] as const;

/**
 * Check if text contains framework-specific guidance indicators.
 * Used to prevent duplicate framework system prompt injection.
 *
 * @param text - The text to check (typically a system message)
 * @returns true if any framework guidance indicator is found
 */
export function hasFrameworkGuidance(text?: string): boolean {
  if (!text) return false;
  return FRAMEWORK_INDICATORS.some((indicator) => text.includes(indicator));
}

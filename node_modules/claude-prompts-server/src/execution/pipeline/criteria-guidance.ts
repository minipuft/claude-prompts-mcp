// @lifecycle canonical - Shared gate criteria guidance formatter for pipeline stages.
/**
 * Format an array of criteria strings into structured guidance text.
 *
 * @param criteria - Array of criteria strings to format
 * @returns Formatted guidance text with numbered list
 */
export function formatCriteriaAsGuidance(criteria: readonly string[]): string {
  if (criteria.length === 0) {
    return '';
  }

  return criteria.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

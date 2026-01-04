// @lifecycle canonical - Shared utility for formatting gate criteria into guidance text.
/**
 * Gate Guidance Formatter
 *
 * Centralized utility for converting gate criteria arrays into formatted guidance text.
 * Used by pipeline stages and gate services to ensure consistent formatting.
 */
/**
 * Format an array of criteria strings into structured guidance text
 *
 * @param criteria - Array of criteria strings to format
 * @returns Formatted guidance text with numbered list
 *
 * @example
 * ```typescript
 * formatCriteriaAsGuidance(['Check naming', 'Verify tests'])
 * // Returns:
 * // "Evaluate the output against these criteria:
 * // 1. Check naming
 * // 2. Verify tests"
 * ```
 */
export function formatCriteriaAsGuidance(criteria) {
    if (criteria.length === 0) {
        return '';
    }
    // Just output numbered criteria - no preamble needed
    return criteria.map((item, index) => `${index + 1}. ${item}`).join('\n');
}
//# sourceMappingURL=gate-guidance-formatter.js.map
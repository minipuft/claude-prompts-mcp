// @lifecycle canonical - Gate guidance-layer formatter for criteria lists.
/**
 * Gate Guidance Formatter
 *
 * Canonical helper for converting gate criteria arrays into formatted guidance text.
 * Lives in the guidance layer so pipeline stages and renderers share the same formatter.
 */
/**
 * Format an array of criteria strings into structured guidance text.
 *
 * @param criteria - Array of criteria strings to format
 * @returns Formatted guidance text with numbered list
 *
 * @example
 * ```typescript
 * formatCriteriaAsGuidance(['Check naming', 'Verify tests'])
 * // Returns:
 * // "1. Check naming\n2. Verify tests"
 * ```
 */
export function formatCriteriaAsGuidance(criteria) {
    if (criteria.length === 0) {
        return '';
    }
    // Just output numbered criteria - no preamble needed
    return criteria.map((item, index) => `${index + 1}. ${item}`).join('\n');
}
//# sourceMappingURL=criteria-guidance-formatter.js.map
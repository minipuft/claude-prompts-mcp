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
export declare function formatCriteriaAsGuidance(criteria: readonly string[]): string;

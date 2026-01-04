/**
 * Inline Argument Parser
 *
 * Parses inline arguments from script reference syntax:
 * - {{script:analyzer file='data.csv'}}      → { file: 'data.csv' }
 * - {{script:analyzer count=42}}             → { count: 42 }
 * - {{script:analyzer verbose=true}}         → { verbose: true }
 * - {{script:analyzer a='x' b=2 c=false}}    → { a: 'x', b: 2, c: false }
 */
/**
 * Parse inline script arguments from an args string.
 *
 * @param argsString - The raw arguments portion (e.g., " file='data.csv' count=42")
 * @returns Parsed key-value pairs with typed values
 *
 * @example
 * parseInlineScriptArgs(" file='data.csv' count=42 verbose=true")
 * // Returns: { file: 'data.csv', count: 42, verbose: true }
 */
export declare function parseInlineScriptArgs(argsString: string): Record<string, unknown>;
/**
 * Validate that a parsed args object contains expected types.
 * Useful for type narrowing when the expected schema is known.
 *
 * @param args - Parsed arguments
 * @param schema - Expected type for each key ('string' | 'number' | 'boolean')
 * @returns Validation result with any type mismatches
 */
export declare function validateInlineArgs(args: Record<string, unknown>, schema: Record<string, 'string' | 'number' | 'boolean'>): {
    valid: boolean;
    errors: string[];
};

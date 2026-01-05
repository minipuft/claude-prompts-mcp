// @lifecycle canonical - Parser for inline script arguments in {{script:id key='val'}} syntax.
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
 * Regex pattern to match inline argument pairs.
 *
 * Captures:
 * - Group 1: Key name (identifier)
 * - Group 2: Single-quoted string value
 * - Group 3: Double-quoted string value
 * - Group 4: Numeric value (integer or decimal)
 * - Group 5: Boolean value (true/false)
 */
const INLINE_ARG_PATTERN =
  /([a-zA-Z_][a-zA-Z0-9_]*)=(?:'([^']*)'|"([^"]*)"|(\d+(?:\.\d+)?)|(\btrue\b|\bfalse\b))/g;

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
export function parseInlineScriptArgs(argsString: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  if (argsString === '' || argsString.trim() === '') {
    return args;
  }

  // Reset regex state
  INLINE_ARG_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = INLINE_ARG_PATTERN.exec(argsString)) !== null) {
    const key = match[1];
    if (key === undefined) continue;

    // Determine value type based on which capture group matched
    const singleQuotedValue = match[2];
    const doubleQuotedValue = match[3];
    const numericValue = match[4];
    const booleanValue = match[5];

    let value: unknown;

    if (singleQuotedValue !== undefined) {
      value = singleQuotedValue;
    } else if (doubleQuotedValue !== undefined) {
      value = doubleQuotedValue;
    } else if (numericValue !== undefined) {
      // Parse as number (preserves decimals)
      value = numericValue.includes('.') ? parseFloat(numericValue) : parseInt(numericValue, 10);
    } else if (booleanValue !== undefined) {
      value = booleanValue === 'true';
    }

    if (value !== undefined) {
      args[key] = value;
    }
  }

  return args;
}

/**
 * Validate that a parsed args object contains expected types.
 * Useful for type narrowing when the expected schema is known.
 *
 * @param args - Parsed arguments
 * @param schema - Expected type for each key ('string' | 'number' | 'boolean')
 * @returns Validation result with any type mismatches
 */
export function validateInlineArgs(
  args: Record<string, unknown>,
  schema: Record<string, 'string' | 'number' | 'boolean'>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const [key, expectedType] of Object.entries(schema)) {
    const value = args[key];
    if (value !== undefined) {
      const actualType = typeof value;
      if (actualType !== expectedType) {
        errors.push(`Argument "${key}" expected ${expectedType}, got ${actualType}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

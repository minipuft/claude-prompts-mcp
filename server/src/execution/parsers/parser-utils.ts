// @lifecycle canonical - Shared helpers for command parsing normalization.
/**
 * Normalize >> prefixes in symbolic commands for consistent parsing.
 *
 * The >> prefix serves as a hint to LLMs that this is an MCP tool command,
 * but it should not interfere with symbolic operator detection.
 */
export function normalizeSymbolicPrefixes(command: string): {
  normalized: string;
  hadPrefixes: boolean;
  originalCommand: string;
} {
  const original = command;
  let normalized = command;
  let hadPrefixes = false;

  const chainStepPattern = /-->\s*>>\s*/g;
  if (chainStepPattern.test(normalized)) {
    normalized = normalized.replace(chainStepPattern, '--> ');
    hadPrefixes = true;
  }

  const parallelPattern = /\+\s*>>\s*/g;
  if (parallelPattern.test(normalized)) {
    normalized = normalized.replace(parallelPattern, '+ ');
    hadPrefixes = true;
  }

  const conditionalPattern = /:\s*>>\s*/g;
  if (conditionalPattern.test(normalized)) {
    normalized = normalized.replace(conditionalPattern, ': ');
    hadPrefixes = true;
  }

  const frameworkPrefixPattern = /^>>\s*@/;
  if (frameworkPrefixPattern.test(normalized)) {
    normalized = normalized.replace(/^>>\s*/, '');
    hadPrefixes = true;
  }

  return { normalized, hadPrefixes, originalCommand: original };
}

/**
 * Remove style operators from a command segment to avoid polluting prompt args.
 */
export function stripStyleOperators(input: string): string {
  if (!input) {
    return input;
  }
  return input.replace(/#style(?:[:=]|\()([A-Za-z0-9_-]+)\)?/gi, ' ').trim();
}

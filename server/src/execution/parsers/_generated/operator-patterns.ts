// AUTO-GENERATED - Do not edit directly
// Source: tooling/contracts/registries/operators.json

/**
 * Operator patterns generated from SSOT registry.
 * Use these patterns in symbolic-operator-parser.ts
 */

export const GENERATED_OPERATOR_PATTERNS = {
  /** Sequential execution of prompts - --> */
  chain: {
    pattern: /-->/g,
    symbol: '-->',
    status: 'implemented',
  },
  /** Quality gate for validation - :: */
  gate: {
    pattern: /\s+(::|=)\s*(?:([a-z][a-z0-9_-]*):["']([^"']+)["']|["']([^"']+)["']|([^\s"']+))/gi,
    symbol: '::',
    status: 'implemented',
  },
  /** Apply methodology framework - @ */
  framework: {
    pattern: /(?:^|\s)@([A-Za-z0-9_-]+)(?=\s|$)/,
    symbol: '@',
    status: 'implemented',
  },
  /** Response formatting style - # */
  style: {
    pattern: /(?:^|\s)#([A-Za-z][A-Za-z0-9_-]*)(?=\s|$)/,
    symbol: '#',
    status: 'implemented',
  },
  /** Chain shorthand - repeat N times with SAME arguments - * N */
  repetition: {
    pattern: /\s*\*\s*(\d+)(?=\s|$|-->)/,
    symbol: '* N',
    status: 'implemented',
  },
  /** Concurrent execution - + */
  parallel: {
    pattern: /\s*\+\s*/g,
    symbol: '+',
    status: 'reserved',
  },
  /** Conditional branching - ? */
  conditional: {
    pattern: /\s*\?\s*["'](.+?)["']\s*:\s*(?:>>)?\s*([A-Za-z0-9_-]+)/,
    symbol: '?',
    status: 'reserved',
  },
} as const;

export type OperatorId = keyof typeof GENERATED_OPERATOR_PATTERNS;

export const IMPLEMENTED_OPERATORS = ['chain', 'gate', 'framework', 'style', 'repetition'] as const;

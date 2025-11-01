/**
 * Shared command parsing result types used across parser modules.
 *
 * Keeping these interfaces in a lightweight module prevents circular
 * dependencies between the unified parser implementation and the
 * symbolic/operator type definitions.
 */

export interface CommandParseResultBase<TOperators = unknown, TPlan = unknown> {
  promptId: string;
  rawArgs: string;
  format: 'simple' | 'json' | 'structured' | 'legacy' | 'symbolic';
  confidence: number;
  metadata: {
    originalCommand: string;
    parseStrategy: string;
    detectedFormat: string;
    warnings: string[];
  };
  operators?: TOperators;
  executionPlan?: TPlan;
}

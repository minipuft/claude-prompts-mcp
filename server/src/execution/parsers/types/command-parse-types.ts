// @lifecycle canonical - Type definitions for command parsing results.
/**
 * Shared command parsing result types used across parser modules.
 *
 * Keeping these interfaces in a lightweight module prevents circular
 * dependencies between the unified parser implementation and the
 * symbolic/operator type definitions.
 */
import type { ExecutionModifier, ExecutionModifiers } from '../../types.js';

export interface CommandParseResultBase<TOperators = unknown, TPlan = unknown> {
  promptId: string;
  rawArgs: string;
  format: 'simple' | 'json' | 'structured' | 'legacy' | 'symbolic';
  confidence: number;
  commandType?: 'single' | 'chain';
  modifiers?: ExecutionModifiers;
  metadata: {
    originalCommand: string;
    parseStrategy: string;
    detectedFormat: string;
    warnings: string[];
    prefixesNormalized?: boolean;
    modifierToken?: ExecutionModifier;
  };
  operators?: TOperators;
  executionPlan?: TPlan;
}

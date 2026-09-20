// @lifecycle canonical - Barrel exports for execution parsers.
/**
 * Execution Parsers Export Module
 *
 * Centralizes all parsing infrastructure exports including:
 * - Unified Command Parser with multi-strategy parsing
 * - Argument Processing Pipeline with validation and enrichment
 * - Schema Validation (minLength, maxLength, pattern enforcement)
 * - Compatibility Wrapper for backward compatibility
 */

// Core parsing infrastructure
export {
  UnifiedCommandParser,
  createUnifiedCommandParser,
  type CommandParseResult,
} from './command-parser.js';

export {
  ArgumentParser,
  createArgumentParser,
  type ArgumentParsingResult,
  type ExecutionContext,
} from './argument-parser.js';

export {
  ArgumentSchemaValidator,
  type SchemaValidationIssue,
  type SchemaValidationResult,
  type PromptSchemaOverrides,
} from './argument-schema.js';

// Domain services extracted from pipeline stages
export { ChainBlueprintResolver } from './chain-blueprint-resolver.js';
export {
  SymbolicCommandBuilder,
  type PromptLookup,
  type CollectedGateCriteria,
  type CollectedNamedGate,
} from './symbolic-command-builder.js';
export {
  WorkflowCommandBuilder,
  WORKFLOW_COMMAND_LABEL,
  type WorkflowIrPort,
  type WorkflowCommandResult,
} from './workflow-command-builder.js';

// Backward compatibility wrapper removed - migration completed
// Legacy parsing methods are preserved through deprecated redirects in consolidated-prompt-engine.ts

// Re-export for convenience
export type { PromptData } from '#shared/types/index.js';
export type { PromptArgument } from '#shared/types/index.js';
export type { ConvertedPrompt } from '../types.js';

export type { ValidationResult, ValidationError, ValidationWarning } from '../types.js';

import { ArgumentParser, createArgumentParser } from './argument-parser.js';
import { UnifiedCommandParser, createUnifiedCommandParser } from './command-parser.js';

import type { FrameworkIdLookup } from './symbolic-operator-parser.js';

import { Logger } from '#infra/logging/index.js';

/**
 * Complete parsing system with all components
 */
export interface ParsingSystem {
  commandParser: UnifiedCommandParser;
  argumentParser: ArgumentParser;
}

/**
 * Factory function to create complete parsing system
 *
 * Creates a fully configured parsing system with:
 * - Unified command parser with multi-strategy support
 * - Argument processor with validation and type coercion
 *
 * @param logger Logger instance for system-wide logging
 * @param isRegisteredFramework Optional lookup for quote-aware @framework detection, asked on
 *   every parse. When provided, only @framework operators it accepts are detected, and other
 *   @word patterns (like @docs/, @mention) stay literal text.
 * @returns Complete parsing system ready for use
 */
export function createParsingSystem(
  logger: Logger,
  isRegisteredFramework?: FrameworkIdLookup
): ParsingSystem {
  const commandParser = createUnifiedCommandParser(logger, isRegisteredFramework);
  const argumentParser = createArgumentParser(logger);

  logger.info('Parsing system initialized successfully');
  logger.info('- Unified command parser with multi-strategy support');
  logger.info('- Argument parser with validation pipeline');

  return {
    commandParser,
    argumentParser,
  };
}

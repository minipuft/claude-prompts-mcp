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

// Context resolution system
export {
  ContextResolver,
  createContextResolver,
  type ContextResolution,
  type ContextProvider,
  type ContextSource,
  type ContextAggregationOptions,
} from '../context/context-resolver.js';

// Backward compatibility wrapper removed - migration completed
// Legacy parsing methods are preserved through deprecated redirects in consolidated-prompt-engine.ts

// Re-export for convenience
export type { PromptData, PromptArgument, ConvertedPrompt } from '../../types/index.js';

export type { ValidationResult, ValidationError, ValidationWarning } from '../types.js';

import { ArgumentParser, createArgumentParser } from './argument-parser.js';
import { UnifiedCommandParser, createUnifiedCommandParser } from './command-parser.js';
import { Logger } from '../../logging/index.js';
import { ContextResolver, createContextResolver } from '../context/context-resolver.js';

/**
 * Complete parsing system with all components
 */
export interface ParsingSystem {
  commandParser: UnifiedCommandParser;
  argumentParser: ArgumentParser;
  contextResolver: ContextResolver;
}

/**
 * Factory function to create complete parsing system
 *
 * Creates a fully configured parsing system with:
 * - Unified command parser with multi-strategy support
 * - Argument processor with validation and type coercion
 * - Context resolver with intelligent fallbacks
 *
 * @param logger Logger instance for system-wide logging
 * @returns Complete parsing system ready for use
 */
export function createParsingSystem(logger: Logger): ParsingSystem {
  const commandParser = createUnifiedCommandParser(logger);
  const argumentParser = createArgumentParser(logger);
  const contextResolver = createContextResolver(logger);

  logger.info('Parsing system initialized successfully');
  logger.info('- Unified command parser with multi-strategy support');
  logger.info('- Argument parser with validation pipeline');
  logger.info('- Context resolver with intelligent fallbacks');

  return {
    commandParser,
    argumentParser,
    contextResolver,
  };
}

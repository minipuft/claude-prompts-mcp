// @lifecycle canonical - Barrel exports for execution context utilities.
/**
 * Context System Export Module
 *
 * Centralizes all execution context infrastructure exports:
 * - ExecutionContext: Pipeline state carrier
 * - ContextResolver: Template variable resolution
 * - Context types: Interfaces for pipeline state
 */

// ExecutionContext - primary pipeline state carrier
export { ExecutionContext } from './execution-context.js';

// Context types - interfaces for pipeline state
export type {
  NamedInlineGate,
  ParsedCommand,
  SessionContext,
  ExecutionResults,
} from './context-types.js';

// ContextResolver - template variable resolution
export {
  ContextResolver,
  createContextResolver,
  type ContextResolution,
  type ContextProvider,
  type ContextSource,
  type ContextAggregationOptions,
} from './context-resolver.js';

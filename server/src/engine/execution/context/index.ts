// @lifecycle canonical - Barrel exports for execution context utilities.
/**
 * Context System Export Module
 *
 * Centralizes all execution context infrastructure exports:
 * - PromptRequestContext: Pipeline state carrier
 * - Context types: Interfaces for pipeline state
 */

// PromptRequestContext - primary pipeline state carrier
export { PromptRequestContext } from './prompt-request-context.js';

// Context types - interfaces for pipeline state
export type {
  NamedInlineGate,
  ParsedCommand,
  SessionContext,
  ExecutionResults,
} from './context-types.js';

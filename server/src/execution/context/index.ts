// @lifecycle canonical - Barrel exports for execution context utilities.
/**
 * Context System Export Module
 *
 * Centralizes all context resolution infrastructure exports
 */

export {
  ContextResolver,
  createContextResolver,
  type ContextResolution,
  type ContextProvider,
  type ContextSource,
  type ContextAggregationOptions,
} from './context-resolver.js';

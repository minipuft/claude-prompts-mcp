// @lifecycle canonical - Exports for server-side hook system.
/**
 * Server-side Hook System
 *
 * Provides extensible hooks for pipeline stages, gate evaluation, and chain execution.
 *
 * Usage:
 * ```typescript
 * import { HookRegistry, PipelineHooks } from './hooks/index.js';
 *
 * const registry = new HookRegistry(logger);
 * registry.registerPipelineHooks({
 *   onBeforeStage: async (stage, ctx) => console.log(`Starting ${stage}`),
 * });
 * ```
 */

export type {
  ChainHooks,
  GateEvaluationResult,
  GateHooks,
  HookExecutionContext,
  PipelineHooks,
} from './hook-registry.js';
export { HookRegistry } from './hook-registry.js';

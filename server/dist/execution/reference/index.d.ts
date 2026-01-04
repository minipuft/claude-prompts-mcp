/**
 * Reference Resolution Module
 *
 * Enables template syntax for modular prompt composition and inline script execution:
 * - {{ref:prompt_id}} - Include another prompt's content
 * - {{script:id}} - Execute a pre-registered script and inline output
 *
 * Architecture:
 * ```
 * Template with {{ref:...}} and {{script:...}}
 *        ↓
 * PromptReferenceResolver.preResolve()  →  {{ref:...}} replaced
 *        ↓
 * ScriptReferenceResolver.preResolve()  →  {{script:...}} replaced
 *        ↓
 * processTemplate() → Final output
 * ```
 *
 * @example
 * ```typescript
 * // Prompt references
 * const promptResolver = new PromptReferenceResolver(logger, prompts);
 * const { resolvedTemplate } = await promptResolver.preResolve(
 *   'Before: {{ref:shared_intro}} After',
 *   { topic: 'AI' }
 * );
 *
 * // Script references
 * const scriptResolver = new ScriptReferenceResolver(logger, loader, executor);
 * const { resolvedTemplate } = await scriptResolver.preResolve(
 *   'Count: {{script:analyzer.row_count}}',
 *   { file: 'data.csv' }
 * );
 * ```
 */
export { PromptReferenceResolver } from './prompt-reference-resolver.js';
export type { IToolDetectionService, IScriptExecutor } from './prompt-reference-resolver.js';
export { PromptReferenceValidator } from './prompt-reference-validator.js';
export type { ReferenceValidationResult, ReferenceValidationError, } from './prompt-reference-validator.js';
export type { DetectedReference, PreResolveResult, ReferenceContext, ReferenceResolutionOptions, ReferenceResolutionResult, ReferenceScriptDetection, ResolutionDiagnostics, } from './types.js';
export { DEFAULT_RESOLUTION_OPTIONS } from './types.js';
export { CircularReferenceError, MaxDepthExceededError, PromptNotFoundError, PromptReferenceError, ReferenceRenderError, ScriptExecutionError, } from './errors.js';
export { ScriptReferenceResolver } from './script-reference-resolver.js';
export type { IScriptLoader, IScriptExecutorService } from './script-reference-resolver.js';
export type { DetectedScriptReference, ScriptPreResolveResult, ScriptResolutionDiagnostics, ScriptResolutionOptions, } from './script-reference-types.js';
export { DEFAULT_SCRIPT_RESOLUTION_OPTIONS } from './script-reference-types.js';
export { InvalidFieldAccessError, InvalidScriptIdError, InvalidScriptOutputError, ScriptExecutionFailedError, ScriptNotRegisteredError, ScriptReferenceError, } from './script-reference-errors.js';
export { parseInlineScriptArgs, validateInlineArgs } from './internal/inline-arg-parser.js';

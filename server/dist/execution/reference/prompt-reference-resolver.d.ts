/**
 * Prompt Reference Resolver
 *
 * Resolves {{ref:prompt_id}} template references by:
 * 1. Detecting reference patterns in templates
 * 2. Looking up prompts from the registry
 * 3. Executing associated script tools (respecting trigger config)
 * 4. Rendering the referenced prompt with script results in context
 * 5. Replacing the reference placeholder with rendered content
 *
 * Supports nested references with circular reference detection.
 */
import type { DetectedReference, PreResolveResult, ReferenceResolutionOptions, ReferenceResolutionResult } from './types.js';
import type { Logger } from '../../logging/index.js';
import type { ScriptExecutionResult, ToolDetectionMatch, LoadedScriptTool } from '../../scripts/types.js';
import type { ConvertedPrompt } from '../types.js';
/**
 * Interface for script detection service (injected dependency).
 */
export interface IToolDetectionService {
    detectTools(rawInput: string, args: Record<string, unknown>, availableTools: LoadedScriptTool[]): ToolDetectionMatch[];
}
/**
 * Interface for script executor (injected dependency).
 */
export interface IScriptExecutor {
    execute(request: {
        toolId: string;
        promptId: string;
        inputs: Record<string, unknown>;
        timeout?: number;
    }, tool: LoadedScriptTool): Promise<ScriptExecutionResult>;
}
/**
 * Resolves {{ref:prompt_id}} references in templates.
 */
export declare class PromptReferenceResolver {
    private readonly logger;
    private readonly prompts;
    private readonly toolDetectionService?;
    private readonly scriptExecutor?;
    private readonly options;
    constructor(logger: Logger, prompts: ConvertedPrompt[], toolDetectionService?: IToolDetectionService | undefined, scriptExecutor?: IScriptExecutor | undefined, options?: ReferenceResolutionOptions);
    /**
     * Pre-resolve all {{ref:...}} patterns in a template before Nunjucks processing.
     *
     * @param template - Template string potentially containing {{ref:...}} patterns
     * @param context - Context variables available for referenced prompts
     * @param resolutionChain - Chain of prompt IDs for cycle detection (internal use)
     * @returns Template with references replaced and script results
     */
    preResolve(template: string, context: Record<string, unknown>, resolutionChain?: string[]): Promise<PreResolveResult>;
    /**
     * Resolve a single prompt reference.
     *
     * @param promptId - ID of the prompt to resolve
     * @param context - Context variables for the referenced prompt
     * @param resolutionChain - Chain of prompt IDs for cycle detection
     * @returns Resolved content and script results
     */
    resolveReference(promptId: string, context: Record<string, unknown>, resolutionChain?: string[]): Promise<ReferenceResolutionResult>;
    /**
     * Detect all {{ref:...}} patterns in a template.
     */
    detectReferences(template: string): DetectedReference[];
    /**
     * Check if a template contains any {{ref:...}} patterns.
     */
    hasReferences(template: string): boolean;
    /**
     * Find a prompt by ID in the registry.
     */
    private findPrompt;
    /**
     * Execute scripts for a referenced prompt, respecting trigger configuration.
     */
    private executeScriptsForPrompt;
    /**
     * Build enriched context with script results available as {{tool_<id>}} variables.
     */
    private buildEnrichedContext;
}

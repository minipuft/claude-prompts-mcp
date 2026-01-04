import type { PromptArgument } from '../types/index.js';
type PromptDefinition = {
    arguments: PromptArgument[];
};
/**
 * Validates JSON arguments against the prompt's expected arguments
 * @param jsonArgs The JSON arguments to validate
 * @param prompt The prompt data containing expected arguments
 * @returns Object with validation results and sanitized arguments
 */
export declare function validateJsonArguments(jsonArgs: any, prompt: PromptDefinition): {
    valid: boolean;
    errors?: string[];
    sanitizedArgs?: Record<string, string | number | boolean | null | any[]>;
};
/**
 * Processes a template string by replacing placeholders with values using Nunjucks
 * @param template The template string with placeholders and potential Nunjucks logic
 * @param args The arguments to replace placeholders with
 * @param specialContext Special context values to replace first
 * @returns The processed template string
 */
export declare function processTemplate(template: string, args: Record<string, any>, specialContext?: Record<string, string>): string;
/**
 * Result of template processing with reference resolution.
 */
export interface ProcessTemplateWithRefsResult {
    /** The fully rendered template content */
    content: string;
    /** Script results from referenced prompts, keyed by "promptId:toolId" */
    scriptResults: Map<string, unknown>;
    /** All prompt IDs that were resolved during reference resolution */
    resolvedPromptIds: Set<string>;
    /** Inline script results from {{script:...}} references */
    inlineScriptResults?: Map<string, unknown>;
}
/**
 * Interface for script reference resolver.
 * Resolves {{script:id}} patterns in templates.
 */
export interface IScriptReferenceResolver {
    preResolve: (template: string, context: Record<string, unknown>, promptDir?: string) => Promise<{
        resolvedTemplate: string;
        scriptResults: Map<string, unknown>;
        diagnostics: {
            scriptsResolved: number;
            warnings: string[];
            resolutionTimeMs: number;
        };
    }>;
    hasScriptReferences: (template: string) => boolean;
}
/**
 * Options for processTemplateWithRefs.
 */
export interface ProcessTemplateOptions {
    /** Prompt reference resolver for {{ref:...}} patterns */
    promptResolver?: {
        preResolve: (template: string, context: Record<string, unknown>) => Promise<{
            resolvedTemplate: string;
            scriptResults: Map<string, unknown>;
            resolvedPromptIds: Set<string>;
        }>;
    };
    /** Script reference resolver for {{script:...}} patterns */
    scriptResolver?: IScriptReferenceResolver;
    /** Prompt directory for prompt-local script lookup */
    promptDir?: string;
}
/**
 * Processes a template string with {{ref:prompt_id}} and {{script:id}} reference resolution.
 *
 * This async wrapper:
 * 1. Pre-resolves all {{ref:...}} patterns using PromptReferenceResolver
 * 2. Pre-resolves all {{script:...}} patterns using ScriptReferenceResolver
 * 3. Processes the resolved template with Nunjucks via processTemplate()
 *
 * Use this instead of processTemplate() when templates may contain prompt or script references.
 *
 * @param template The template string with placeholders and potential {{ref:...}} or {{script:...}} patterns
 * @param args The arguments to replace placeholders with
 * @param specialContext Special context values to replace first
 * @param resolver Optional PromptReferenceResolver instance for reference resolution (legacy parameter)
 * @param options Optional options including script resolver
 * @returns The processed template string with references resolved, plus metadata
 *
 * @example
 * ```typescript
 * const result = await processTemplateWithRefs(
 *   'Intro: {{ref:shared_intro}}\nCount: {{script:analyzer.row_count}}',
 *   { topic: 'AI Safety' },
 *   {},
 *   promptResolver,
 *   { scriptResolver, promptDir: '/path/to/prompt' }
 * );
 * console.log(result.content); // Rendered with shared_intro and script output included
 * ```
 */
export declare function processTemplateWithRefs(template: string, args: Record<string, unknown>, specialContext?: Record<string, string>, resolver?: {
    preResolve: (template: string, context: Record<string, unknown>) => Promise<{
        resolvedTemplate: string;
        scriptResults: Map<string, unknown>;
        resolvedPromptIds: Set<string>;
    }>;
}, options?: ProcessTemplateOptions): Promise<ProcessTemplateWithRefsResult>;
export {};

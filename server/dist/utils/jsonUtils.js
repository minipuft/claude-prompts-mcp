// @lifecycle canonical - JSON escaping/unescaping helpers for prompt templates.
// JSON utility functions
import * as path from 'node:path'; // Import path module
import { fileURLToPath } from 'url'; // For ES module __dirname equivalent
import nunjucks from 'nunjucks';
// JSON escaping utilities (moved here to avoid circular dependency)
function escapeJsonForNunjucks(jsonStr) {
    return jsonStr
        .replace(/\{\{/g, '\\{\\{') // Escape Nunjucks variable syntax
        .replace(/\}\}/g, '\\}\\}') // Escape Nunjucks variable syntax
        .replace(/\{%/g, '\\{\\%') // Escape Nunjucks tag syntax
        .replace(/%\}/g, '\\%\\}') // Escape Nunjucks tag syntax
        .replace(/\{#/g, '\\{\\#') // Escape Nunjucks comment syntax
        .replace(/#\}/g, '\\#\\}'); // Escape Nunjucks comment syntax
}
function unescapeJsonFromNunjucks(escapedStr) {
    return escapedStr
        .replace(/\\{\\{/g, '{{') // Unescape Nunjucks variable syntax
        .replace(/\\}\\}/g, '}}') // Unescape Nunjucks variable syntax
        .replace(/\\{\\%/g, '{%') // Unescape Nunjucks tag syntax
        .replace(/\\%\\}/g, '%}') // Unescape Nunjucks tag syntax
        .replace(/\\{\\#/g, '{#') // Unescape Nunjucks comment syntax
        .replace(/\\#\\}/g, '#}'); // Unescape Nunjucks comment syntax
}
// Lazy initialization to avoid Jest import.meta.url issues
let nunjucksEnv = null;
// Get prompt templates path (Jest-compatible version)
// Uses __dirname in Jest/CommonJS, import.meta.url in ES modules
function getPromptTemplatesPath() {
    // Check for test environment override first
    const promptsPathEnv = process.env['PROMPTS_PATH'];
    if (promptsPathEnv) {
        return promptsPathEnv;
    }
    if (typeof __dirname !== 'undefined') {
        // Jest/CommonJS environment - __dirname is available
        return path.resolve(__dirname, '../../prompts');
    }
    // ES modules environment - use import.meta.url
    // This code path only runs in real ES modules (not Jest)
    try {
        // Using eval to prevent Jest from parsing import.meta at compile time
        const metaUrl = eval('import.meta.url');
        const currentFileUrl = fileURLToPath(metaUrl);
        const currentDirPath = path.dirname(currentFileUrl);
        return path.resolve(currentDirPath, '../../prompts');
    }
    catch (error) {
        // Fallback for any environment where import.meta is not available
        // Use process.cwd() as last resort
        return path.resolve(process.cwd(), 'server/prompts');
    }
}
// Initialize Nunjucks environment (called lazily)
function getNunjucksEnv() {
    if (!nunjucksEnv) {
        const promptTemplatesPath = getPromptTemplatesPath();
        nunjucksEnv = nunjucks.configure(promptTemplatesPath, {
            autoescape: false, // We're generating plain text prompts for LLM, not HTML
            throwOnUndefined: false, // Renders undefined variables as empty string for better compatibility
            watch: false, // Set to true for development to auto-reload templates; false for production
            noCache: process.env['NODE_ENV'] === 'development', // Disable cache in development, enable in production
            tags: {
                blockStart: '{%',
                blockEnd: '%}',
                variableStart: '{{',
                variableEnd: '}}',
                commentStart: '{#',
                commentEnd: '#}',
            },
        });
    }
    return nunjucksEnv;
}
/**
 * Validates JSON arguments against the prompt's expected arguments
 * @param jsonArgs The JSON arguments to validate
 * @param prompt The prompt data containing expected arguments
 * @returns Object with validation results and sanitized arguments
 */
export function validateJsonArguments(jsonArgs, prompt) {
    const errors = [];
    const sanitizedArgs = {};
    // Check for unexpected properties
    const expectedArgNames = prompt.arguments.map((arg) => arg.name);
    const providedArgNames = Object.keys(jsonArgs);
    for (const argName of providedArgNames) {
        if (!expectedArgNames.includes(argName)) {
            errors.push(`Unexpected argument: ${argName}`);
        }
    }
    // Check for and sanitize expected arguments
    for (const arg of prompt.arguments) {
        const value = jsonArgs[arg.name];
        // All arguments are treated as optional now
        if (value !== undefined) {
            // Sanitize the value based on expected type
            // This is a simple implementation - expand as needed for your use case
            if (typeof value === 'string') {
                // Sanitize string inputs
                sanitizedArgs[arg.name] = value
                    .replace(/[<>]/g, '') // Remove potentially dangerous HTML characters
                    .trim();
            }
            else if (typeof value === 'number') {
                // Ensure it's a valid number
                sanitizedArgs[arg.name] = isNaN(value) ? 0 : value;
            }
            else if (typeof value === 'boolean') {
                sanitizedArgs[arg.name] = !!value; // Ensure boolean type
            }
            else if (Array.isArray(value)) {
                // For arrays, sanitize each element if they're strings
                sanitizedArgs[arg.name] = value.map((item) => typeof item === 'string' ? item.replace(/[<>]/g, '').trim() : item);
            }
            else if (value !== null && typeof value === 'object') {
                // For objects, convert to string for simplicity
                sanitizedArgs[arg.name] = JSON.stringify(value);
            }
            else {
                // For any other type, convert to string
                sanitizedArgs[arg.name] = String(value);
            }
        }
    }
    const result = {
        valid: errors.length === 0,
    };
    if (errors.length > 0) {
        result.errors = errors;
    }
    if (Object.keys(sanitizedArgs).length > 0) {
        result.sanitizedArgs = sanitizedArgs;
    }
    return result;
}
/**
 * Processes a template string by replacing placeholders with values using Nunjucks
 * @param template The template string with placeholders and potential Nunjucks logic
 * @param args The arguments to replace placeholders with
 * @param specialContext Special context values to replace first
 * @returns The processed template string
 */
export function processTemplate(template, args, specialContext = {}) {
    // Pre-escape any string values that might contain Nunjucks syntax
    const escapedArgs = {};
    for (const [key, value] of Object.entries(args)) {
        if (typeof value === 'string' &&
            (value.includes('{{') || value.includes('{%') || value.includes('{#'))) {
            escapedArgs[key] = escapeJsonForNunjucks(value);
        }
        else {
            // Pass non-string values (arrays, objects) directly to Nunjucks
            escapedArgs[key] = value;
        }
    }
    const context = { ...specialContext, ...escapedArgs };
    try {
        // Use Nunjucks to render the template with the combined context
        const env = getNunjucksEnv();
        const rendered = env.renderString(template, context);
        // Unescape any values that were escaped for Nunjucks
        let unescapedResult = rendered;
        for (const [key, value] of Object.entries(escapedArgs)) {
            if (typeof value === 'string' && value !== args[key]) {
                // This arg was escaped, so we need to unescape it in the result
                const originalValue = args[key];
                const escapedValue = value;
                unescapedResult = unescapedResult.replace(new RegExp(escapedValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), originalValue);
            }
        }
        return unescapedResult;
    }
    catch (error) {
        // Log the Nunjucks rendering error for debugging purposes.
        // The error will be re-thrown and should be handled by the calling function
        // (e.g., in TemplateProcessor) which can add more context like Prompt ID.
        if (error instanceof Error) {
            console.error('[Nunjucks Render Error] Failed to process template:', error.message);
            // Optionally, log error.stack for more detailed debugging if needed in development
            // if (process.env.NODE_ENV === 'development' && error.stack) {
            //   console.error(error.stack);
            // }
        }
        else {
            console.error('[Nunjucks Render Error] Failed to process template with an unknown error object:', error);
        }
        throw error; // Re-throw the original error
    }
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
export async function processTemplateWithRefs(template, args, specialContext = {}, resolver, options) {
    let resolvedTemplate = template;
    const scriptResults = new Map();
    const resolvedPromptIds = new Set();
    const inlineScriptResults = new Map();
    // 1. Resolve {{ref:...}} patterns first (prompt references)
    const promptResolver = resolver ?? options?.promptResolver;
    if (promptResolver) {
        const combinedContext = { ...specialContext, ...args };
        const preResolveResult = await promptResolver.preResolve(resolvedTemplate, combinedContext);
        resolvedTemplate = preResolveResult.resolvedTemplate;
        // Copy script results from referenced prompts
        for (const [key, value] of preResolveResult.scriptResults) {
            scriptResults.set(key, value);
        }
        // Copy resolved IDs
        for (const id of preResolveResult.resolvedPromptIds) {
            resolvedPromptIds.add(id);
        }
    }
    // 2. Resolve {{script:...}} patterns (inline script references)
    const scriptResolver = options?.scriptResolver;
    if (scriptResolver?.hasScriptReferences(resolvedTemplate)) {
        const combinedContext = { ...specialContext, ...args };
        const scriptResolveResult = await scriptResolver.preResolve(resolvedTemplate, combinedContext, options?.promptDir);
        resolvedTemplate = scriptResolveResult.resolvedTemplate;
        // Copy inline script results
        for (const [key, value] of scriptResolveResult.scriptResults) {
            inlineScriptResults.set(key, value);
        }
    }
    // 3. Process with standard Nunjucks template processing
    const content = processTemplate(resolvedTemplate, args, specialContext);
    return {
        content,
        scriptResults,
        resolvedPromptIds,
        inlineScriptResults: inlineScriptResults.size > 0 ? inlineScriptResults : undefined,
    };
}
//# sourceMappingURL=jsonUtils.js.map
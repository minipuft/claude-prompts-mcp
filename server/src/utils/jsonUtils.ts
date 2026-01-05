// @lifecycle canonical - JSON escaping/unescaping helpers for prompt templates.
// JSON utility functions

import * as path from 'node:path'; // Import path module
import { fileURLToPath } from 'url'; // For ES module __dirname equivalent

import nunjucks from 'nunjucks';

import type { PromptArgument } from '../types/index.js';

type PromptDefinition = { arguments: PromptArgument[] };
// JSON escaping utilities (moved here to avoid circular dependency)
function escapeJsonForNunjucks(jsonStr: string): string {
  return jsonStr
    .replace(/\{\{/g, '\\{\\{') // Escape Nunjucks variable syntax
    .replace(/\}\}/g, '\\}\\}') // Escape Nunjucks variable syntax
    .replace(/\{%/g, '\\{\\%') // Escape Nunjucks tag syntax
    .replace(/%\}/g, '\\%\\}') // Escape Nunjucks tag syntax
    .replace(/\{#/g, '\\{\\#') // Escape Nunjucks comment syntax
    .replace(/#\}/g, '\\#\\}'); // Escape Nunjucks comment syntax
}

function unescapeJsonFromNunjucks(escapedStr: string): string {
  return escapedStr
    .replace(/\\{\\{/g, '{{') // Unescape Nunjucks variable syntax
    .replace(/\\}\\}/g, '}}') // Unescape Nunjucks variable syntax
    .replace(/\\{\\%/g, '{%') // Unescape Nunjucks tag syntax
    .replace(/\\%\\}/g, '%}') // Unescape Nunjucks tag syntax
    .replace(/\\{\\#/g, '{#') // Unescape Nunjucks comment syntax
    .replace(/\\#\\}/g, '#}'); // Unescape Nunjucks comment syntax
}

// Lazy initialization to avoid Jest import.meta.url issues
let nunjucksEnv: nunjucks.Environment | null = null;

// Get prompt templates path (Jest-compatible version)
// Uses __dirname in Jest/CommonJS, import.meta.url in ES modules
function getPromptTemplatesPath(): string {
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
  } catch (error) {
    // Fallback for any environment where import.meta is not available
    // Use process.cwd() as last resort
    return path.resolve(process.cwd(), 'server/prompts');
  }
}

// Initialize Nunjucks environment (called lazily)
function getNunjucksEnv(): nunjucks.Environment {
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
export function validateJsonArguments(
  jsonArgs: any,
  prompt: PromptDefinition
): {
  valid: boolean;
  errors?: string[];
  sanitizedArgs?: Record<string, string | number | boolean | null | any[]>;
} {
  const errors: string[] = [];
  const sanitizedArgs: Record<string, string | number | boolean | null | any[]> = {};

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
      } else if (typeof value === 'number') {
        // Ensure it's a valid number
        sanitizedArgs[arg.name] = isNaN(value) ? 0 : value;
      } else if (typeof value === 'boolean') {
        sanitizedArgs[arg.name] = !!value; // Ensure boolean type
      } else if (Array.isArray(value)) {
        // For arrays, sanitize each element if they're strings
        sanitizedArgs[arg.name] = value.map((item) =>
          typeof item === 'string' ? item.replace(/[<>]/g, '').trim() : item
        );
      } else if (value !== null && typeof value === 'object') {
        // For objects, convert to string for simplicity
        sanitizedArgs[arg.name] = JSON.stringify(value);
      } else {
        // For any other type, convert to string
        sanitizedArgs[arg.name] = String(value);
      }
    }
  }

  const result: {
    valid: boolean;
    errors?: string[];
    sanitizedArgs?: Record<string, string | number | boolean | null | any[]>;
  } = {
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
export function processTemplate(
  template: string,
  args: Record<string, any>,
  specialContext: Record<string, string> = {}
): string {
  // Pre-escape any string values that might contain Nunjucks syntax
  const escapedArgs: Record<string, any> = {};
  for (const [key, value] of Object.entries(args)) {
    if (
      typeof value === 'string' &&
      (value.includes('{{') || value.includes('{%') || value.includes('{#'))
    ) {
      escapedArgs[key] = escapeJsonForNunjucks(value);
    } else {
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
        unescapedResult = unescapedResult.replace(
          new RegExp(escapedValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
          originalValue
        );
      }
    }

    return unescapedResult;
  } catch (error) {
    // Log the Nunjucks rendering error for debugging purposes.
    // The error will be re-thrown and should be handled by the calling function
    // (e.g., in TemplateProcessor) which can add more context like Prompt ID.
    if (error instanceof Error) {
      console.error('[Nunjucks Render Error] Failed to process template:', error.message);
      // Optionally, log error.stack for more detailed debugging if needed in development
      // if (process.env.NODE_ENV === 'development' && error.stack) {
      //   console.error(error.stack);
      // }
    } else {
      console.error(
        '[Nunjucks Render Error] Failed to process template with an unknown error object:',
        error
      );
    }
    throw error; // Re-throw the original error
  }
}

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
  preResolve: (
    template: string,
    context: Record<string, unknown>,
    promptDir?: string
  ) => Promise<{
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
    preResolve: (
      template: string,
      context: Record<string, unknown>
    ) => Promise<{
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
export async function processTemplateWithRefs(
  template: string,
  args: Record<string, unknown>,
  specialContext: Record<string, string> = {},
  resolver?: {
    preResolve: (
      template: string,
      context: Record<string, unknown>
    ) => Promise<{
      resolvedTemplate: string;
      scriptResults: Map<string, unknown>;
      resolvedPromptIds: Set<string>;
    }>;
  },
  options?: ProcessTemplateOptions
): Promise<ProcessTemplateWithRefsResult> {
  let resolvedTemplate = template;
  const scriptResults = new Map<string, unknown>();
  const resolvedPromptIds = new Set<string>();
  const inlineScriptResults = new Map<string, unknown>();

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
    const scriptResolveResult = await scriptResolver.preResolve(
      resolvedTemplate,
      combinedContext,
      options?.promptDir
    );
    resolvedTemplate = scriptResolveResult.resolvedTemplate;

    // Copy inline script results
    for (const [key, value] of scriptResolveResult.scriptResults) {
      inlineScriptResults.set(key, value);
    }
  }

  // 3. Process with standard Nunjucks template processing
  const content = processTemplate(resolvedTemplate, args as Record<string, any>, specialContext);

  return {
    content,
    scriptResults,
    resolvedPromptIds,
    inlineScriptResults: inlineScriptResults.size > 0 ? inlineScriptResults : undefined,
  };
}

// @lifecycle canonical - Resolves {{script:id}} references during template processing.
/**
 * Script Reference Resolver
 *
 * Resolves {{script:id}} template references by:
 * 1. Detecting script reference patterns in templates
 * 2. Validating script is pre-registered (security)
 * 3. Parsing inline arguments
 * 4. Executing via ScriptExecutor
 * 5. Extracting .field if specified
 * 6. Replacing placeholder with JSON output (or throwing on error)
 *
 * Syntax variants:
 * - {{script:analyzer}}                    - Execute, inline full JSON
 * - {{script:analyzer.row_count}}          - Access specific field
 * - {{script:analyzer file='data.csv'}}    - Pass inline arguments
 */

import { parseInlineScriptArgs } from './internal/inline-arg-parser.js';
import {
  InvalidFieldAccessError,
  InvalidScriptIdError,
  InvalidScriptOutputError,
  ScriptExecutionFailedError,
  ScriptNotRegisteredError,
} from './script-reference-errors.js';
import { DEFAULT_SCRIPT_RESOLUTION_OPTIONS } from './script-reference-types.js';

import type {
  DetectedScriptReference,
  ScriptPreResolveResult,
  ScriptResolutionDiagnostics,
  ScriptResolutionOptions,
} from './script-reference-types.js';
import type { Logger } from '../../logging/index.js';
import type { ScriptExecutionResult, LoadedScriptTool } from '../../scripts/types.js';

/**
 * Regex pattern to match {{script:id}}, {{script:id.field}}, {{script:id args}} references.
 *
 * Captures:
 * - Group 1: Script ID (alphanumeric with underscores and hyphens)
 * - Group 2: Optional field access (after dot)
 * - Group 3: Optional inline arguments string (key='val' pairs)
 */
const SCRIPT_REFERENCE_PATTERN =
  /\{\{script:([a-zA-Z0-9_-]+)(?:\.([a-zA-Z0-9_]+))?((?:\s+[a-zA-Z_][a-zA-Z0-9_]*=(?:'[^']*'|"[^"]*"|\d+(?:\.\d+)?|true|false))*)\s*\}\}/g;

/**
 * Interface for script loader (injected dependency).
 * Abstracts the script discovery mechanism.
 */
export interface IScriptLoader {
  /**
   * Check if a script exists and is loadable.
   */
  scriptExists(scriptId: string, promptDir?: string): boolean;

  /**
   * Load a script definition by ID.
   */
  loadScript(scriptId: string, promptDir?: string): LoadedScriptTool | undefined;

  /**
   * Get paths that were searched for diagnostics.
   */
  getSearchedPaths(scriptId: string, promptDir?: string): string[];
}

/**
 * Interface for script executor (injected dependency).
 */
export interface IScriptExecutorService {
  execute(
    request: {
      toolId: string;
      promptId: string;
      inputs: Record<string, unknown>;
      timeout?: number;
    },
    tool: LoadedScriptTool
  ): Promise<ScriptExecutionResult>;
}

/**
 * Resolves {{script:id}} references in templates.
 */
export class ScriptReferenceResolver {
  private readonly options: Required<ScriptResolutionOptions>;

  constructor(
    private readonly logger: Logger,
    private readonly scriptLoader: IScriptLoader,
    private readonly scriptExecutor: IScriptExecutorService,
    options?: ScriptResolutionOptions
  ) {
    this.options = { ...DEFAULT_SCRIPT_RESOLUTION_OPTIONS, ...options };
  }

  /**
   * Pre-resolve all {{script:...}} patterns in a template before Nunjucks processing.
   *
   * @param template - Template string potentially containing {{script:...}} patterns
   * @param context - Context variables (passed to scripts as additional inputs)
   * @param promptDir - Optional prompt directory for prompt-local script lookup
   * @returns Template with references replaced and script results
   */
  async preResolve(
    template: string,
    context: Record<string, unknown>,
    promptDir?: string
  ): Promise<ScriptPreResolveResult> {
    const startTime = Date.now();
    const diagnostics: ScriptResolutionDiagnostics = {
      scriptsResolved: 0,
      warnings: [],
      resolutionTimeMs: 0,
    };
    const allScriptResults = new Map<string, ScriptExecutionResult>();

    // Detect all script references in the template
    const references = this.detectScriptReferences(template);

    if (references.length === 0) {
      diagnostics.resolutionTimeMs = Date.now() - startTime;
      return {
        resolvedTemplate: template,
        scriptResults: allScriptResults,
        diagnostics,
      };
    }

    this.logger.debug(
      `[ScriptReferenceResolver] Found ${references.length} script reference(s) to resolve`
    );

    // Cache for script execution results within this resolution (avoids redundant executions)
    const executionCache = new Map<
      string,
      { output: string; executionResult: ScriptExecutionResult }
    >();

    // Resolve references from end to start to maintain correct indices
    let resolvedTemplate = template;
    const sortedRefs = [...references].sort((a, b) => b.startIndex - a.startIndex);

    for (const ref of sortedRefs) {
      // Build cache key from script ID, field access, and inline args
      const cacheKey = this.buildCacheKey(ref);

      // Check cache for duplicate references
      let result = executionCache.get(cacheKey);
      if (result === undefined) {
        // Execute and cache the result
        result = await this.resolveScriptReference(ref, context, promptDir);
        executionCache.set(cacheKey, result);
        diagnostics.scriptsResolved++;
      }

      // Replace the reference with resolved content
      resolvedTemplate =
        resolvedTemplate.slice(0, ref.startIndex) +
        result.output +
        resolvedTemplate.slice(ref.endIndex);

      // Store script result
      allScriptResults.set(ref.scriptId, result.executionResult);
    }

    diagnostics.resolutionTimeMs = Date.now() - startTime;

    this.logger.debug(
      `[ScriptReferenceResolver] Resolved ${diagnostics.scriptsResolved} script(s) in ${diagnostics.resolutionTimeMs}ms`
    );

    return {
      resolvedTemplate,
      scriptResults: allScriptResults,
      diagnostics,
    };
  }

  /**
   * Build a cache key for script execution results.
   * Same script + field access + inline args = same cache key.
   */
  private buildCacheKey(ref: DetectedScriptReference): string {
    const parts = [ref.scriptId];
    if (ref.fieldAccess !== undefined) {
      parts.push(`.${ref.fieldAccess}`);
    }
    if (ref.inlineArgs !== undefined) {
      parts.push(JSON.stringify(ref.inlineArgs));
    }
    return parts.join('');
  }

  /**
   * Resolve a single script reference.
   *
   * @param ref - Detected script reference
   * @param context - Context variables
   * @param promptDir - Optional prompt directory for prompt-local lookup
   * @returns Resolved output string and execution result
   */
  private async resolveScriptReference(
    ref: DetectedScriptReference,
    context: Record<string, unknown>,
    promptDir?: string
  ): Promise<{ output: string; executionResult: ScriptExecutionResult }> {
    // 1. Validate script ID (security)
    this.validateScriptId(ref.scriptId);

    // 2. Check script is pre-registered
    if (!this.scriptLoader.scriptExists(ref.scriptId, promptDir)) {
      const searchedPaths = this.scriptLoader.getSearchedPaths(ref.scriptId, promptDir);
      throw new ScriptNotRegisteredError(ref.scriptId, searchedPaths);
    }

    // 3. Load script definition
    const tool = this.scriptLoader.loadScript(ref.scriptId, promptDir);
    if (tool === undefined) {
      const searchedPaths = this.scriptLoader.getSearchedPaths(ref.scriptId, promptDir);
      throw new ScriptNotRegisteredError(ref.scriptId, searchedPaths);
    }

    // 4. Merge inline args with context
    const inputs: Record<string, unknown> = {
      ...context,
      ...(ref.inlineArgs ?? {}),
    };

    // 5. Execute script
    this.logger.debug(`[ScriptReferenceResolver] Executing script ${ref.scriptId}`);

    const executionResult = await this.scriptExecutor.execute(
      {
        toolId: tool.id,
        promptId: tool.promptId,
        inputs,
        timeout: this.options.scriptTimeout,
      },
      tool
    );

    // 6. Handle execution failure (blocking)
    if (!executionResult.success) {
      throw new ScriptExecutionFailedError(
        ref.scriptId,
        executionResult.exitCode,
        executionResult.stderr,
        executionResult.error !== undefined && executionResult.error !== ''
          ? new Error(executionResult.error)
          : undefined
      );
    }

    // 7. Parse output (must be JSON for field access)
    let parsedOutput: unknown = executionResult.output;

    // If output is a wrapped string { output: "..." }, unwrap it
    if (
      typeof parsedOutput === 'object' &&
      parsedOutput !== null &&
      'output' in parsedOutput &&
      Object.keys(parsedOutput as object).length === 1
    ) {
      // Try to parse the inner output as JSON
      const innerOutput = (parsedOutput as { output: string }).output;
      if (typeof innerOutput === 'string') {
        try {
          parsedOutput = JSON.parse(innerOutput);
        } catch {
          // Keep as is if not valid JSON
        }
      }
    }

    // 8. Handle field access
    let outputValue: unknown = parsedOutput;
    if (ref.fieldAccess !== undefined && ref.fieldAccess !== '') {
      if (typeof parsedOutput !== 'object' || parsedOutput === null) {
        throw new InvalidScriptOutputError(
          ref.scriptId,
          executionResult.stdout,
          'Output must be a JSON object for field access'
        );
      }

      const obj = parsedOutput as Record<string, unknown>;
      if (!(ref.fieldAccess in obj)) {
        const availableFields = Object.keys(obj);
        throw new InvalidFieldAccessError(ref.scriptId, ref.fieldAccess, availableFields);
      }

      outputValue = obj[ref.fieldAccess];
    }

    // 9. Format output as string
    const output = this.formatOutput(outputValue);

    return { output, executionResult };
  }

  /**
   * Detect all {{script:...}} patterns in a template.
   */
  detectScriptReferences(template: string): DetectedScriptReference[] {
    const references: DetectedScriptReference[] = [];
    let match: RegExpExecArray | null;

    // Reset regex state
    SCRIPT_REFERENCE_PATTERN.lastIndex = 0;

    while ((match = SCRIPT_REFERENCE_PATTERN.exec(template)) !== null) {
      const scriptId = match[1];
      if (scriptId === undefined) continue;

      const fieldAccess = match[2];
      const argsString = match[3];

      references.push({
        fullMatch: match[0],
        scriptId,
        fieldAccess: fieldAccess ?? undefined,
        inlineArgs:
          argsString !== undefined && argsString !== ''
            ? parseInlineScriptArgs(argsString)
            : undefined,
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    }

    return references;
  }

  /**
   * Check if a template contains any {{script:...}} patterns.
   */
  hasScriptReferences(template: string): boolean {
    SCRIPT_REFERENCE_PATTERN.lastIndex = 0;
    return SCRIPT_REFERENCE_PATTERN.test(template);
  }

  /**
   * Validate script ID for security.
   * Rejects invalid characters and path traversal attempts.
   */
  private validateScriptId(id: string): void {
    // Must match alphanumeric with underscores and hyphens
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new InvalidScriptIdError(
        id,
        'Script ID must contain only alphanumeric characters, underscores, and hyphens'
      );
    }

    // Reject path traversal attempts
    if (id.includes('..') || id.includes('/') || id.includes('\\')) {
      throw new InvalidScriptIdError(id, 'Path traversal patterns not allowed in script ID');
    }
  }

  /**
   * Format output value as a string for template insertion.
   */
  private formatOutput(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    // Objects and arrays: JSON stringify
    return this.options.prettyPrint ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  }
}

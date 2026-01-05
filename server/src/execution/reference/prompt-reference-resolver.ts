// @lifecycle canonical - Resolves {{ref:prompt_id}} references during template processing.
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

import {
  CircularReferenceError,
  MaxDepthExceededError,
  PromptNotFoundError,
  ReferenceRenderError,
  ScriptExecutionError,
} from './errors.js';
import { DEFAULT_RESOLUTION_OPTIONS } from './types.js';
import { processTemplate } from '../../utils/jsonUtils.js';

import type {
  DetectedReference,
  PreResolveResult,
  ReferenceResolutionOptions,
  ReferenceResolutionResult,
  ResolutionDiagnostics,
} from './types.js';
import type { Logger } from '../../logging/index.js';
import type {
  ScriptExecutionResult,
  ToolDetectionMatch,
  LoadedScriptTool,
} from '../../scripts/types.js';
import type { ConvertedPrompt } from '../types.js';

/**
 * Regex pattern to match {{ref:prompt_id}} references.
 * Captures the prompt ID from the reference.
 */
const REFERENCE_PATTERN = /\{\{ref:([a-zA-Z0-9_-]+)\}\}/g;

/**
 * Interface for script detection service (injected dependency).
 */
export interface IToolDetectionService {
  detectTools(
    rawInput: string,
    args: Record<string, unknown>,
    availableTools: LoadedScriptTool[]
  ): ToolDetectionMatch[];
}

/**
 * Interface for script executor (injected dependency).
 */
export interface IScriptExecutor {
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
 * Resolves {{ref:prompt_id}} references in templates.
 */
export class PromptReferenceResolver {
  private readonly options: Required<ReferenceResolutionOptions>;

  constructor(
    private readonly logger: Logger,
    private readonly prompts: ConvertedPrompt[],
    private readonly toolDetectionService?: IToolDetectionService,
    private readonly scriptExecutor?: IScriptExecutor,
    options?: ReferenceResolutionOptions
  ) {
    this.options = { ...DEFAULT_RESOLUTION_OPTIONS, ...options };
  }

  /**
   * Pre-resolve all {{ref:...}} patterns in a template before Nunjucks processing.
   *
   * @param template - Template string potentially containing {{ref:...}} patterns
   * @param context - Context variables available for referenced prompts
   * @param resolutionChain - Chain of prompt IDs for cycle detection (internal use)
   * @returns Template with references replaced and script results
   */
  async preResolve(
    template: string,
    context: Record<string, unknown>,
    resolutionChain: string[] = []
  ): Promise<PreResolveResult> {
    const startTime = Date.now();
    const diagnostics: ResolutionDiagnostics = {
      referencesResolved: 0,
      scriptsExecuted: 0,
      warnings: [],
      resolutionTimeMs: 0,
    };
    const allScriptResults = new Map<string, ScriptExecutionResult>();
    const allResolvedIds = new Set<string>();

    // Detect all references in the template
    const references = this.detectReferences(template);

    if (references.length === 0) {
      diagnostics.resolutionTimeMs = Date.now() - startTime;
      return {
        resolvedTemplate: template,
        scriptResults: allScriptResults,
        resolvedPromptIds: allResolvedIds,
        diagnostics,
      };
    }

    this.logger.debug(
      `[PromptReferenceResolver] Found ${references.length} reference(s) to resolve`
    );

    // Resolve references from end to start to maintain correct indices
    let resolvedTemplate = template;
    const sortedRefs = [...references].sort((a, b) => b.startIndex - a.startIndex);

    for (const ref of sortedRefs) {
      try {
        const result = await this.resolveReference(ref.promptId, context, resolutionChain);

        // Replace the reference with resolved content
        resolvedTemplate =
          resolvedTemplate.slice(0, ref.startIndex) +
          result.content +
          resolvedTemplate.slice(ref.endIndex);

        // Merge script results with prefixed keys
        for (const [toolId, execResult] of result.scriptResults) {
          allScriptResults.set(`${ref.promptId}:${toolId}`, execResult);
          diagnostics.scriptsExecuted++;
        }

        // Track resolved IDs
        for (const id of result.resolvedPromptIds) {
          allResolvedIds.add(id);
        }

        diagnostics.referencesResolved++;
      } catch (error) {
        if (!this.options.throwOnMissing && error instanceof PromptNotFoundError) {
          diagnostics.warnings.push(`Reference to unknown prompt: ${ref.promptId}`);
          // Replace with empty string
          resolvedTemplate =
            resolvedTemplate.slice(0, ref.startIndex) + '' + resolvedTemplate.slice(ref.endIndex);
        } else {
          throw error;
        }
      }
    }

    diagnostics.resolutionTimeMs = Date.now() - startTime;

    this.logger.debug(
      `[PromptReferenceResolver] Resolved ${diagnostics.referencesResolved} reference(s) in ${diagnostics.resolutionTimeMs}ms`
    );

    return {
      resolvedTemplate,
      scriptResults: allScriptResults,
      resolvedPromptIds: allResolvedIds,
      diagnostics,
    };
  }

  /**
   * Resolve a single prompt reference.
   *
   * @param promptId - ID of the prompt to resolve
   * @param context - Context variables for the referenced prompt
   * @param resolutionChain - Chain of prompt IDs for cycle detection
   * @returns Resolved content and script results
   */
  async resolveReference(
    promptId: string,
    context: Record<string, unknown>,
    resolutionChain: string[] = []
  ): Promise<ReferenceResolutionResult> {
    // Check for circular reference
    if (resolutionChain.includes(promptId)) {
      throw new CircularReferenceError([...resolutionChain, promptId]);
    }

    // Check max depth
    if (resolutionChain.length >= this.options.maxDepth) {
      throw new MaxDepthExceededError(promptId, resolutionChain.length, this.options.maxDepth);
    }

    // Find the prompt
    const prompt = this.findPrompt(promptId);
    if (prompt === undefined) {
      throw new PromptNotFoundError(promptId);
    }

    const newChain = [...resolutionChain, promptId];
    const scriptResults = new Map<string, ScriptExecutionResult>();
    const resolvedPromptIds = new Set<string>([promptId]);

    // Execute scripts if enabled and available
    if (
      this.options.executeScripts === true &&
      prompt.scriptTools !== undefined &&
      prompt.scriptTools.length > 0
    ) {
      const execResults = await this.executeScriptsForPrompt(prompt, context);
      for (const [toolId, result] of execResults) {
        scriptResults.set(toolId, result);
      }
    }

    // Build context with script results
    const enrichedContext = this.buildEnrichedContext(context, scriptResults);

    // Render the referenced prompt's template
    let renderedContent: string;
    try {
      // First, recursively resolve any nested references in the prompt's template
      const nestedResult = await this.preResolve(
        prompt.userMessageTemplate,
        enrichedContext,
        newChain
      );

      // Merge nested script results
      for (const [key, value] of nestedResult.scriptResults) {
        scriptResults.set(key, value);
      }
      for (const id of nestedResult.resolvedPromptIds) {
        resolvedPromptIds.add(id);
      }

      // Then render with Nunjucks
      renderedContent = processTemplate(nestedResult.resolvedTemplate, enrichedContext);
    } catch (error) {
      if (error instanceof CircularReferenceError || error instanceof MaxDepthExceededError) {
        throw error;
      }
      throw new ReferenceRenderError(
        promptId,
        error instanceof Error ? error : new Error(String(error))
      );
    }

    return {
      content: renderedContent,
      scriptResults,
      resolutionChain: newChain,
      resolvedPromptIds,
    };
  }

  /**
   * Detect all {{ref:...}} patterns in a template.
   */
  detectReferences(template: string): DetectedReference[] {
    const references: DetectedReference[] = [];
    let match: RegExpExecArray | null;

    // Reset regex state
    REFERENCE_PATTERN.lastIndex = 0;

    while ((match = REFERENCE_PATTERN.exec(template)) !== null) {
      const promptId = match[1];
      if (promptId === undefined) continue; // Should never happen with valid regex
      references.push({
        fullMatch: match[0],
        promptId,
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    }

    return references;
  }

  /**
   * Check if a template contains any {{ref:...}} patterns.
   */
  hasReferences(template: string): boolean {
    REFERENCE_PATTERN.lastIndex = 0;
    return REFERENCE_PATTERN.test(template);
  }

  /**
   * Find a prompt by ID in the registry.
   */
  private findPrompt(promptId: string): ConvertedPrompt | undefined {
    return this.prompts.find((p) => p.id === promptId);
  }

  /**
   * Execute scripts for a referenced prompt, respecting trigger configuration.
   */
  private async executeScriptsForPrompt(
    prompt: ConvertedPrompt,
    context: Record<string, unknown>
  ): Promise<Map<string, ScriptExecutionResult>> {
    const results = new Map<string, ScriptExecutionResult>();

    if (prompt.scriptTools === undefined || prompt.scriptTools.length === 0) {
      return results;
    }

    if (this.toolDetectionService === undefined || this.scriptExecutor === undefined) {
      this.logger.debug(
        `[PromptReferenceResolver] Script services not available, skipping script execution for ${prompt.id}`
      );
      return results;
    }

    // Detect which tools should run based on trigger config
    const matches = this.toolDetectionService.detectTools('', context, prompt.scriptTools);

    for (const match of matches) {
      const tool = prompt.scriptTools.find((t) => t.id === match.toolId);
      if (tool === undefined) continue;

      // Skip tools requiring confirmation (not auto-executed in references)
      if (match.requiresConfirmation === true) {
        this.logger.debug(
          `[PromptReferenceResolver] Skipping tool ${match.toolId} - requires confirmation`
        );
        continue;
      }

      try {
        this.logger.debug(
          `[PromptReferenceResolver] Executing script ${match.toolId} for ${prompt.id}`
        );
        const result = await this.scriptExecutor.execute(
          {
            toolId: match.toolId,
            promptId: prompt.id,
            inputs: match.extractedInputs,
            timeout: this.options.scriptTimeout,
          },
          tool
        );
        results.set(match.toolId, result);
      } catch (error) {
        throw new ScriptExecutionError(
          prompt.id,
          match.toolId,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }

    return results;
  }

  /**
   * Build enriched context with script results available as {{tool_<id>}} variables.
   */
  private buildEnrichedContext(
    baseContext: Record<string, unknown>,
    scriptResults: Map<string, ScriptExecutionResult>
  ): Record<string, unknown> {
    const enriched: Record<string, unknown> = { ...baseContext };

    for (const [toolId, result] of scriptResults) {
      // Make script output available as tool_<id> variable
      enriched[`tool_${toolId}`] = result.success ? result.output : null;
      // Also provide full result for advanced usage
      enriched[`tool_${toolId}_result`] = result;
    }

    return enriched;
  }
}

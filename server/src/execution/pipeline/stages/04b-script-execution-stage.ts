// @lifecycle canonical - Pipeline stage for script tool execution.
/**
 * Pipeline Stage 4b: Script Execution
 *
 * Detects and executes prompt-scoped script tools based on user input,
 * enriching the template context with script outputs.
 *
 * Position: After Planning Stage (04), before Gate Enhancement (05)
 *
 * Dependencies:
 * - context.parsedCommand (from ParsingStage)
 * - context.convertedPrompt (from ParsingStage)
 *
 * Output:
 * - context.state.scripts.results (Map<toolId, ScriptExecutionResult>)
 * - context.state.scripts.toolsSkipped (string[]) - Manual mode tools without explicit request
 * - context.state.scripts.toolsPendingConfirmation (string[]) - Confirm mode tools awaiting approval
 *
 * The script results are later merged into template context in ExecutionStage (09)
 * as {{tool_<id>}} variables.
 *
 * @see plans/script-tools-implementation.md for the full implementation plan
 */

import { BasePipelineStage } from '../stage.js';

import type { Logger } from '../../../logging/index.js';
import type { ToolDetectionService } from '../../../scripts/detection/tool-detection-service.js';
import type { ExecutionModeService } from '../../../scripts/execution/execution-mode-service.js';
import type { ScriptExecutor } from '../../../scripts/execution/script-executor.js';
import type {
  ScriptExecutionRequest,
  ScriptExecutionResult,
  LoadedScriptTool,
  ToolDetectionMatch,
} from '../../../scripts/types.js';
import type { ExecutionContext } from '../../context/execution-context.js';

/**
 * Pipeline Stage 4b: Script Execution
 *
 * Detects matching script tools from user input/args and executes them,
 * storing results in pipeline state for template rendering.
 *
 * This stage is a thin orchestration layer:
 * - ToolDetectionService handles detection and trigger types
 * - ExecutionModeService handles confirmation filtering (confirm: true)
 * - ScriptExecutor handles subprocess execution
 */
export class ScriptExecutionStage extends BasePipelineStage {
  readonly name = 'ScriptExecution';

  constructor(
    private readonly scriptExecutor: ScriptExecutor,
    private readonly toolDetectionService: ToolDetectionService,
    private readonly executionModeService: ExecutionModeService,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    // Get converted prompt with script tools
    const prompt = context.parsedCommand?.convertedPrompt;
    if (!prompt?.scriptTools?.length) {
      this.logExit({ skipped: 'No script tools available' });
      return;
    }

    // Detect matching tools (respects trigger types and per-tool confidence)
    const input = context.mcpRequest.command ?? '';
    const args = context.getPromptArgs();
    const matches = this.toolDetectionService.detectTools(input, args, prompt.scriptTools);

    if (matches.length === 0) {
      this.logExit({ detected: 0 });
      return;
    }

    // Initialize script state
    const scriptResults = new Map<string, ScriptExecutionResult>();
    const validationErrors: string[] = [];
    const validationWarnings: string[] = [];
    const autoApprovedTools: string[] = [];

    // Build tool map for lookups
    const toolMap = new Map(prompt.scriptTools.map((t) => [t.id, t]));

    // Separate autoApproveOnValid tools from normal confirmation flow
    const { autoApproveMatches, normalMatches } = this.separateAutoApproveTools(matches, toolMap);

    // Handle autoApproveOnValid tools: execute validation first, then decide
    const autoApproveReady: ToolDetectionMatch[] = [];
    for (const match of autoApproveMatches) {
      const tool = toolMap.get(match.toolId);
      if (!tool) continue;

      // Execute script to get validation result
      const result = await this.executeScriptTool(context, tool, match.extractedInputs);
      scriptResults.set(match.toolId, result);

      // Check validation output
      const validationResult = this.checkValidationOutput(result);

      if (validationResult.valid) {
        // Auto-approved! Add warnings if any
        if (validationResult.warnings.length > 0) {
          validationWarnings.push(...validationResult.warnings);
          context.diagnostics.info(
            this.name,
            `Tool '${tool.id}' validated with warnings: ${validationResult.warnings.join('; ')}`
          );
        }
        autoApprovedTools.push(match.toolId);
        autoApproveReady.push(match);
        context.diagnostics.info(this.name, `Tool '${tool.id}' auto-approved via validation`);
      } else {
        // Validation failed - block execution
        validationErrors.push(...validationResult.errors);
        context.diagnostics.warn(
          this.name,
          `Tool '${tool.id}' validation failed: ${validationResult.errors.join('; ')}`
        );
      }
    }

    // Filter normal tools by execution mode (auto/manual/confirm)
    const filterResult = this.executionModeService.filterByExecutionMode(
      normalMatches,
      prompt.scriptTools,
      prompt.id
    );

    const toolsSkipped = filterResult.skippedManual;
    const toolsPendingConfirmation = filterResult.pendingConfirmation.map((t) => t.toolId);

    // Log skipped and pending tools
    if (toolsSkipped.length > 0) {
      context.diagnostics.info(this.name, `Manual mode tools skipped: ${toolsSkipped.join(', ')}`);
    }
    if (toolsPendingConfirmation.length > 0) {
      context.diagnostics.info(
        this.name,
        `Confirm mode tools pending: ${toolsPendingConfirmation.join(', ')}`
      );
    }

    // Execute ready tools (normal flow - excludes already-executed autoApprove tools)
    await this.executeReadyTools(
      context,
      filterResult.readyForExecution,
      prompt.scriptTools,
      scriptResults
    );

    // Store results in pipeline state
    const scriptsState: NonNullable<typeof context.state.scripts> = {
      results: scriptResults,
    };
    if (toolsSkipped.length > 0) {
      scriptsState.toolsSkipped = toolsSkipped;
    }
    if (toolsPendingConfirmation.length > 0) {
      scriptsState.toolsPendingConfirmation = toolsPendingConfirmation;
    }
    if (filterResult.requiresConfirmation) {
      scriptsState.confirmationRequired = this.executionModeService.buildConfirmationResponse(
        filterResult,
        prompt.id
      );
    }
    // Store validation state
    if (validationErrors.length > 0) {
      scriptsState.validationErrors = validationErrors;
    }
    if (validationWarnings.length > 0) {
      scriptsState.validationWarnings = validationWarnings;
    }
    if (autoApprovedTools.length > 0) {
      scriptsState.autoApprovedTools = autoApprovedTools;
    }
    context.state.scripts = scriptsState;

    this.logExit({
      executed: scriptResults.size,
      skipped: toolsSkipped.length,
      pending: toolsPendingConfirmation.length,
      autoApproved: autoApprovedTools.length,
      validationFailed: validationErrors.length > 0,
      successful: Array.from(scriptResults.values()).filter((r) => r.success).length,
    });
  }

  /**
   * Separate tools with autoApproveOnValid from normal confirmation flow.
   */
  private separateAutoApproveTools(
    matches: ToolDetectionMatch[],
    toolMap: Map<string, LoadedScriptTool>
  ): { autoApproveMatches: ToolDetectionMatch[]; normalMatches: ToolDetectionMatch[] } {
    const autoApproveMatches: ToolDetectionMatch[] = [];
    const normalMatches: ToolDetectionMatch[] = [];

    for (const match of matches) {
      const tool = toolMap.get(match.toolId);
      if (tool?.execution?.autoApproveOnValid === true) {
        autoApproveMatches.push(match);
      } else {
        normalMatches.push(match);
      }
    }

    return { autoApproveMatches, normalMatches };
  }

  /**
   * Check script output for validation result.
   * Expected format: { valid: boolean, warnings?: string[], errors?: string[] }
   *
   * IMPORTANT: Scripts may exit with non-zero code when validation fails,
   * but still output valid JSON with detailed error messages. We must check
   * the output first before falling back to exit code errors.
   */
  private checkValidationOutput(result: ScriptExecutionResult): {
    valid: boolean;
    warnings: string[];
    errors: string[];
  } {
    // Try to parse output for validation fields first, even on non-zero exit
    // Validation scripts typically output JSON to stdout and exit with code 1 on failure
    const output = result.output as Record<string, unknown> | null;

    if (output !== null && typeof output === 'object') {
      // We have valid JSON output - extract validation fields
      const valid = output['valid'] === true;
      const warnings = Array.isArray(output['warnings']) ? (output['warnings'] as string[]) : [];
      const errors = Array.isArray(output['errors'])
        ? (output['errors'] as string[])
        : valid
          ? []
          : ['Validation failed'];

      return { valid, warnings, errors };
    }

    // No valid JSON output - fall back to execution status
    if (!result.success) {
      return {
        valid: false,
        warnings: [],
        errors: [result.error ?? `Script execution failed with exit code ${result.exitCode}`],
      };
    }

    // Success but no JSON output
    return { valid: false, warnings: [], errors: ['Script did not return valid JSON output'] };
  }

  /**
   * Execute tools that are ready for execution.
   */
  private async executeReadyTools(
    context: ExecutionContext,
    matches: ToolDetectionMatch[],
    tools: LoadedScriptTool[],
    results: Map<string, ScriptExecutionResult>
  ): Promise<void> {
    const toolMap = new Map(tools.map((t) => [t.id, t]));

    for (const match of matches) {
      const tool = toolMap.get(match.toolId);
      if (!tool) {
        context.diagnostics.warn(this.name, `Tool not found: ${match.toolId}`);
        continue;
      }

      // Log confirmation bypass if applicable
      if (match.requiresConfirmation && match.explicitRequest) {
        this.executionModeService.logManualOverride(tool.id);
      }

      const result = await this.executeScriptTool(context, tool, match.extractedInputs);
      results.set(match.toolId, result);

      // Record diagnostic
      if (result.success) {
        context.diagnostics.info(this.name, `Script tool executed: ${match.toolId}`, {
          durationMs: result.durationMs,
          exitCode: result.exitCode,
        });
      } else {
        context.diagnostics.warn(this.name, `Script tool failed: ${match.toolId}`, {
          error: result.error,
          exitCode: result.exitCode,
        });
      }
    }
  }

  /**
   * Execute a single script tool.
   * Thin wrapper that delegates to ScriptExecutor service.
   */
  private async executeScriptTool(
    context: ExecutionContext,
    tool: LoadedScriptTool,
    inputs: Record<string, unknown>
  ): Promise<ScriptExecutionResult> {
    const prompt = context.parsedCommand?.convertedPrompt;
    const request: ScriptExecutionRequest = {
      toolId: tool.id,
      promptId: prompt?.id ?? tool.promptId,
      inputs,
    };
    // Only add timeout if defined
    if (tool.timeout !== undefined) {
      request.timeout = tool.timeout;
    }
    return this.scriptExecutor.execute(request, tool);
  }
}

/**
 * Factory function for creating the stage with dependencies.
 */
export function createScriptExecutionStage(
  scriptExecutor: ScriptExecutor,
  toolDetectionService: ToolDetectionService,
  executionModeService: ExecutionModeService,
  logger: Logger
): ScriptExecutionStage {
  return new ScriptExecutionStage(
    scriptExecutor,
    toolDetectionService,
    executionModeService,
    logger
  );
}

// @lifecycle canonical - Normalizes incoming execution requests before parsing.
import { BasePipelineStage } from '../stage.js';

import type { ToolResponse } from '../../../types/index.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
import { McpToolRequestValidator } from '../../validation/request-validator.js';
import { detectToolRoutingCommand } from '../../../mcp-tools/prompt-engine/utils/tool-routing.js';
import type { ChainManagementService } from '../../../mcp-tools/prompt-engine/core/chain-management.js';

type ToolRouter = (targetTool: string, params: Record<string, any>, originalCommand: string) => Promise<ToolResponse>;

/**
 * Canonical Pipeline Stage 0.1: Request Normalization
 *
 * Validates MCP tool requests, captures session metadata, and routes
 * management/help/list commands before the parsing stages execute.
 *
 * Dependencies: None (always runs first)
 * Output: Normalized request metadata or early ToolResponse
 * Can Early Exit: Yes
 */
export class RequestNormalizationStage extends BasePipelineStage {
  readonly name = 'RequestNormalization';

  constructor(
    private readonly chainManagementService: ChainManagementService | null,
    private readonly toolRouter: ToolRouter | null,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    if (!(await this.validateRequest(context))) {
      this.logExit({ skipped: 'Request validation failed' });
      return;
    }

    const command = context.mcpRequest.command?.trim() ?? '';
    const hasResumeIdentifier = this.hasResumeIdentifier(context);

    if (!command && !hasResumeIdentifier) {
      context.setResponse(
        this.buildErrorResponse(
          `❌ Error: Missing required parameters.

To execute a new prompt:
  • Provide 'command' parameter
  • Example: { command: ">>my_prompt arg:'value'" }
  • Or with operators: { command: "my_prompt --> my_prompt2" }

To continue an existing chain:
  • Provide 'chain_id' parameter (with optional 'user_response' and 'gate_verdict')
  • Example: { chain_id: "chain-my_prompt#1", user_response: "Step 1 complete" }
  • For gate reviews: { chain_id: "chain-my_prompt#1", gate_verdict: "GATE_REVIEW: PASS - explanation" } — include user_response only if you reran the step

Note: When continuing a chain, the 'command' parameter is optional - the system will restore the execution plan from the chain session.`
        )
      );
      this.logExit({ skipped: 'Missing command and resume identifiers' });
      return;
    }

    if (context.mcpRequest.force_restart && context.mcpRequest.chain_id) {
      context.setResponse(
        this.buildErrorResponse(`❌ Error: Conflicting parameters detected.


'force_restart=true' cannot be used together with 'chain_id'.

- Use 'force_restart=true' to start a new chain execution
- Use 'chain_id' to continue an existing chain execution
- Remove one of these parameters and try again`)
      );
      this.logExit({ skipped: 'Restart conflict' });
      return;
    }

    if (!this.captureRequestMetadata(context)) {
      this.logExit({ skipped: 'Invalid chain URI' });
      return;
    }

    if (command && (await this.tryHandleChainCommand(command, context))) {
      return;
    }

    if (command && (await this.tryRouteCommand(command, context))) {
      return;
    }

    context.metadata['normalizedCommand'] = command || undefined;
    context.metadata['requestNormalizationComplete'] = true;

    this.logExit({
      normalizedCommand: command || '<resume-only>',
      resumeSessionId: context.metadata['resumeSessionId'],
      resumeChainId: context.metadata['resumeChainId'],
    });
  }

  private async validateRequest(context: ExecutionContext): Promise<boolean> {
    try {
      McpToolRequestValidator.validatePartial(context.mcpRequest);
      return true;
    } catch (error) {
      const message =
        error instanceof Error
          ? `❌ Error: ${error.message}`
          : '❌ Error: Invalid MCP tool request payload';
      context.setResponse(this.buildErrorResponse(message));
      return false;
    }
  }

  private hasResumeIdentifier(context: ExecutionContext): boolean {
    return Boolean(context.mcpRequest.chain_id || context.mcpRequest.user_response);
  }

  private captureRequestMetadata(context: ExecutionContext): boolean {
    context.metadata['canonicalPipeline'] = true;

    if (context.mcpRequest.chain_id) {
      context.metadata['resumeChainId'] = context.mcpRequest.chain_id;
      context.metadata['explicitChainResume'] = true;
    }

    context.metadata['requestedGateOverrides'] = {
      apiValidation: context.mcpRequest.api_validation === true,
      qualityGates: context.mcpRequest.quality_gates,
      customChecks: context.mcpRequest.custom_checks,
      temporaryGateCount: context.mcpRequest.temporary_gates?.length ?? 0,
      gateScope: context.mcpRequest.gate_scope,
    };

    if (typeof context.mcpRequest.timeout === 'number') {
      context.metadata['requestedTimeoutMs'] = context.mcpRequest.timeout;
    }

    if (context.mcpRequest.options) {
      context.metadata['requestOptions'] = { ...context.mcpRequest.options };
    }

    return true;
  }

  private async tryHandleChainCommand(command: string, context: ExecutionContext): Promise<boolean> {
    if (!this.chainManagementService) {
      return false;
    }

    try {
      const response = await this.chainManagementService.tryHandleCommand(command);
      if (response) {
        context.setResponse(response);
        this.logExit({ handledBy: 'chain-management' });
        return true;
      }
      return false;
    } catch (error) {
      this.logger.warn('[RequestNormalizationStage] Chain management handling failed', { error });
      return false;
    }
  }

  private async tryRouteCommand(command: string, context: ExecutionContext): Promise<boolean> {
    if (!this.toolRouter) {
      return false;
    }

    const routing = detectToolRoutingCommand(command);
    if (!routing.requiresRouting || !routing.targetTool || !routing.translatedParams) {
      return false;
    }

    try {
      const response = await this.toolRouter(
        routing.targetTool,
        routing.translatedParams,
        routing.originalCommand ?? command
      );
      context.setResponse(response);
      this.logExit({ handledBy: 'tool-routing', target: routing.targetTool });
      return true;
    } catch (error) {
      const message =
        error instanceof Error
          ? `Tool routing failed (${routing.targetTool}): ${error.message}`
          : `Tool routing failed (${routing.targetTool})`;
      context.setResponse(this.buildErrorResponse(`❌ Error: ${message}`));
      return true;
    }
  }

  private buildErrorResponse(message: string): ToolResponse {
    return {
      content: [
        {
          type: 'text',
          text: message,
        },
      ],
      isError: true,
    };
  }
}

// @lifecycle canonical - Unified resource manager router.
/**
 * Resource Manager Router
 *
 * Routes resource_manager requests to the appropriate handler
 * based on the resource_type parameter.
 */

import {
  CROSS_WORKSPACE_READ_ACTIONS,
  PROMPT_ONLY_ACTIONS,
  FRAMEWORK_ONLY_ACTIONS,
  DESTRUCTIVE_ACTIONS,
  HANDLER_OWNED_CONFIRMATION,
} from './types.js';

import type { Logger, ToolResponse } from '#shared/types/index.js';
import type {
  ResourceManagerInput,
  ResourceManagerDependencies,
  PromptResourceHandlerPort,
  ResourceType,
  ResourceAction,
  ActionValidationResult,
} from './types.js';
import type {
  FrameworkManagerActionId,
  FrameworkManagerInput,
} from '../../framework-manager/core/types.js';
import type { FrameworkToolHandler } from '../../framework-manager/index.js';
import type { GateManagerActionId, GateManagerInput } from '../../gate-manager/core/types.js';
import type { GateToolHandler } from '../../gate-manager/index.js';

import { resolveRequestIdentity } from '#shared/utils/request-identity-resolver.js';
import { resolveContinuityScopeId } from '#shared/utils/request-identity-scope.js';

/**
 * ResourceManagerRouter routes requests to the appropriate handler
 */
export class ResourceManagerRouter {
  private readonly logger: Logger;
  private readonly promptResourceHandler: PromptResourceHandlerPort;
  private readonly gateManager: GateToolHandler;
  private readonly frameworkManager: FrameworkToolHandler;

  constructor(deps: ResourceManagerDependencies) {
    this.logger = deps.logger;
    this.promptResourceHandler = deps.promptResourceHandler;
    this.gateManager = deps.gateManager;
    this.frameworkManager = deps.frameworkManager;

    this.logger.debug('ResourceManagerRouter initialized');
  }

  /**
   * Handle a resource_manager request
   */
  async handleAction(
    args: ResourceManagerInput,
    context: Record<string, unknown>
  ): Promise<ToolResponse> {
    const { resource_type, action } = args;

    // Note: resource_type and action are validated by Zod schema before reaching here.
    // The types guarantee they are present and valid.

    // Validate action is valid for this specific resource_type
    const validationResult = this.validateActionForResourceType(resource_type, action);
    if (!validationResult.valid) {
      return this.createErrorResponse(validationResult.error ?? 'Invalid action');
    }

    // One confirmation guard for every destructive action, ahead of dispatch. Deliberately above
    // the resource_type switch: a per-handler check is a check each new handler must remember.
    // HANDLER_OWNED_CONFIRMATION names the pairs whose own refusal says more than this one can.
    if (
      DESTRUCTIVE_ACTIONS.has(action) &&
      !HANDLER_OWNED_CONFIRMATION.has(`${resource_type}:${action}`) &&
      args.confirm !== true
    ) {
      return this.createErrorResponse(
        `⚠️ '${action}' is destructive and requires confirmation.\n\n` +
          `To ${action} ${resource_type} '${args.id ?? '<id>'}', re-send the same call with confirm: true.` +
          (action === 'delete'
            ? `\n\nDeletion cannot be undone — rollback cannot restore a deleted ${resource_type}.`
            : '')
      );
    }

    // Reading another workspace's version history is legitimate debugging; writing with it is not.
    // Refused here rather than per-type, and refused rather than ignored: silently scoping the
    // parameter back to local would leave the caller believing they had restored the other
    // workspace's version.
    if (args.source_workspace !== undefined && !CROSS_WORKSPACE_READ_ACTIONS.has(action)) {
      return this.createErrorResponse(
        `'source_workspace' is a read-only parameter — valid on ${[...CROSS_WORKSPACE_READ_ACTIONS].join(' and ')}, not on '${action}'.\n\n` +
          `A snapshot recorded in another workspace describes files that may not exist here, and ` +
          `version numbering is per-workspace, so writing across that boundary would interleave ` +
          `two histories. Use action:"history" or action:"compare" with 'source_workspace' to ` +
          `inspect it, then apply the change in that workspace.`
      );
    }

    this.logger.debug(`[ResourceManager] Routing ${resource_type}:${action}`, {
      resource_type,
      action,
      id: args.id,
    });

    // Extract tenant scope from MCP SDK extra and enrich context for sub-managers
    const identity = resolveRequestIdentity(context);
    const scopeId = resolveContinuityScopeId(identity);
    const enrichedContext = scopeId !== 'default' ? { ...context, _scopeId: scopeId } : context;

    // Route to appropriate handler
    try {
      switch (resource_type) {
        case 'prompt':
          return await this.routeToPromptResource(args, enrichedContext);
        case 'gate':
          return await this.routeToGateManager(args, enrichedContext);
        case 'framework':
          return await this.routeToFrameworkManager(args, enrichedContext);
        default:
          return this.createErrorResponse(`Unknown resource_type: ${resource_type}`);
      }
    } catch (error) {
      this.logger.error('[ResourceManager] Error routing request', {
        resource_type,
        action,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.createErrorResponse(
        `Error processing ${resource_type} ${action}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Validate that an action is valid for a resource type
   */
  private validateActionForResourceType(
    resourceType: ResourceType,
    action: ResourceAction
  ): ActionValidationResult {
    // Check prompt-only actions
    if (PROMPT_ONLY_ACTIONS.includes(action) && resourceType !== 'prompt') {
      return {
        valid: false,
        error: `Action "${action}" is only valid for resource_type: "prompt"`,
      };
    }

    // Check framework-only actions
    if (FRAMEWORK_ONLY_ACTIONS.includes(action) && resourceType !== 'framework') {
      return {
        valid: false,
        error: `Action "${action}" is only valid for resource_type: "framework"`,
      };
    }

    return { valid: true };
  }

  /**
   * Route to prompt resource service
   */
  private async routeToPromptResource(
    args: ResourceManagerInput,
    context: Record<string, unknown>
  ): Promise<ToolResponse> {
    // Transform args to prompt resource format
    // Action is validated before reaching here, so cast is safe
    const promptArgs: Record<string, unknown> = {
      action: args.action,
      id: args.id,
      name: args.name,
      description: args.description,
      category: args.category,
      user_message_template: args.user_message_template,
      system_message: args.system_message,
      arguments: args.arguments,
      // Pass-through, no renaming (mcp-contracts.md): the processor reads `argument_updates`,
      // `patch`, and `dry_run` under the names the caller sent.
      argument_updates: args.argument_updates,
      patch: args.patch,
      dry_run: args.dry_run,
      chain_steps: args.chain_steps,
      chain_step_operation: args.chain_step_operation,
      chain_step_index: args.chain_step_index,
      chain_step_data: args.chain_step_data,
      chain_step_order: args.chain_step_order,
      tools: args.tools,
      gate_configuration: args.gate_configuration,
      // OQ-P7-8. Pass-through, no renaming: `UPDATE_FIELDS` owns the single snake_case →
      // camelCase mapping these take on their way into the YAML, so a second translation here
      // would be the hidden router transformation mcp-contracts.md bans.
      injection: args.injection,
      register_with_mcp: args.register_with_mcp,
      mcp_prompt_mode: args.mcp_prompt_mode,
      subagent_model: args.subagent_model,
      agent_type: args.agent_type,
      execution_hint: args.execution_hint,
      filter: args.filter,
      format: args.format,
      detail: args.detail,
      search_query: args.search_query,
      confirm: args.confirm,
      reason: args.reason,
      // Versioning parameters (pass through directly - canonical names)
      version: args.version,
      from_version: args.from_version,
      to_version: args.to_version,
      skip_version: args.skip_version,
      limit: args.limit,
      source_workspace: args.source_workspace,
    };

    return await this.promptResourceHandler.handleAction(
      promptArgs as Parameters<typeof this.promptResourceHandler.handleAction>[0],
      context
    );
  }

  /**
   * Route to gate manager
   */
  private async routeToGateManager(
    args: ResourceManagerInput,
    context: Record<string, unknown>
  ): Promise<ToolResponse> {
    // Transform args to gate_manager format
    // Note: gate_type -> type transformation
    // Handler performs its own validation, so we cast the transformed object
    const gateArgs: GateManagerInput = {
      action: args.action as GateManagerActionId,
    };

    if (args.id) gateArgs.id = args.id;
    if (args.name) gateArgs.name = args.name;
    if (args.gate_type) gateArgs.type = args.gate_type;
    if (args.description) gateArgs.description = args.description;
    if (args.guidance) gateArgs.guidance = args.guidance;
    if (args.pass_criteria !== undefined) {
      const normalizedPassCriteria: NonNullable<GateManagerInput['pass_criteria']> = (
        args.pass_criteria ?? []
      ).map((criteria) => {
        if (typeof criteria === 'string') {
          return { required_patterns: [criteria] };
        }
        return criteria;
      });
      gateArgs.pass_criteria = normalizedPassCriteria;
    }
    if (args.activation) {
      gateArgs.activation = args.activation;
    }
    if (args.retry_config !== undefined) {
      const retryConfig: NonNullable<GateManagerInput['retry_config']> = {};

      if (args.retry_config.max_attempts !== undefined) {
        retryConfig.max_attempts = args.retry_config.max_attempts;
      }

      if (args.retry_config.improvement_hints !== undefined) {
        const improvementHints = args.retry_config.improvement_hints;
        retryConfig.improvement_hints =
          typeof improvementHints === 'boolean' ? improvementHints : improvementHints.length > 0;
      }

      if (args.retry_config.preserve_context !== undefined) {
        retryConfig.preserve_context = args.retry_config.preserve_context;
      }

      gateArgs.retry_config = retryConfig;
    }
    if (args.enabled_only !== undefined) {
      gateArgs.enabled_only = args.enabled_only;
    }
    if (args.confirm !== undefined) {
      gateArgs.confirm = args.confirm;
    }
    if (args.dry_run !== undefined) {
      gateArgs.dry_run = args.dry_run;
    }
    if (args.source_workspace !== undefined) {
      gateArgs.source_workspace = args.source_workspace;
    }
    if (args.reason) {
      gateArgs.reason = args.reason;
    }

    // Versioning parameters (pass through directly - canonical names)
    if (args.version !== undefined) {
      gateArgs.version = args.version;
    }
    if (args.from_version !== undefined) {
      gateArgs.from_version = args.from_version;
    }
    if (args.to_version !== undefined) {
      gateArgs.to_version = args.to_version;
    }
    if (args.skip_version !== undefined) {
      gateArgs.skip_version = args.skip_version;
    }
    if (args.limit !== undefined) {
      gateArgs.limit = args.limit;
    }

    return await this.gateManager.handleAction(gateArgs, context);
  }

  /**
   * Route to framework manager
   */
  private async routeToFrameworkManager(
    args: ResourceManagerInput,
    context: Record<string, unknown>
  ): Promise<ToolResponse> {
    // Transform args to framework_manager format
    // Handler performs its own validation, so we cast the transformed object
    const frameworkArgs: FrameworkManagerInput = {
      action: args.action as FrameworkManagerActionId,
    };

    if (args.id) frameworkArgs.id = args.id;
    if (args.name) frameworkArgs.name = args.name;
    if (args.framework) frameworkArgs.framework = args.framework;
    if (args.description) frameworkArgs.description = args.description;
    if (args.system_prompt_guidance) {
      frameworkArgs.system_prompt_guidance = args.system_prompt_guidance;
    }
    if (args.phases !== undefined) {
      const normalizedPhases: NonNullable<FrameworkManagerInput['phases']> = (args.phases ?? [])
        .filter((phase) => Boolean(phase?.id && phase?.name))
        .map((phase) => ({
          id: phase.id,
          name: phase.name,
          description: phase.description ?? '',
          ...(phase.prompts ? { prompts: phase.prompts } : {}),
        }));

      frameworkArgs.phases = normalizedPhases;
    }
    if (args.gates) {
      frameworkArgs.gates = args.gates;
    }
    if (args.tool_descriptions !== undefined) {
      const normalizedDescriptions: NonNullable<FrameworkManagerInput['tool_descriptions']> = {};

      for (const [toolId, value] of Object.entries(args.tool_descriptions ?? {})) {
        if (typeof value === 'string') {
          normalizedDescriptions[toolId] = { description: value };
          continue;
        }

        normalizedDescriptions[toolId] = {
          ...(value.description !== undefined ? { description: value.description } : {}),
          ...(value.parameters !== undefined ? { parameters: value.parameters } : {}),
        };
      }

      frameworkArgs.tool_descriptions = normalizedDescriptions;
    }
    if (args.enabled !== undefined) {
      frameworkArgs.enabled = args.enabled;
    }
    if (args.enabled_only !== undefined) {
      frameworkArgs.enabled_only = args.enabled_only;
    }
    if (args.persist !== undefined) {
      frameworkArgs.persist = args.persist;
    }
    if (args.confirm !== undefined) {
      frameworkArgs.confirm = args.confirm;
    }
    if (args.dry_run !== undefined) {
      frameworkArgs.dry_run = args.dry_run;
    }
    if (args.source_workspace !== undefined) {
      frameworkArgs.source_workspace = args.source_workspace;
    }
    if (args.reason) {
      frameworkArgs.reason = args.reason;
    }

    // Advanced framework parameters (pass-through)
    // NOTE: `framework_gates` here is a framework authoring payload (array of FrameworkGate).
    // The identically-named key inside a *prompt's* `gate_configuration` is an unrelated boolean
    // toggle — same token, different concept.
    if (args.framework_gates) {
      frameworkArgs.framework_gates = args.framework_gates;
    }
    if (args.template_suggestions) {
      frameworkArgs.template_suggestions = args.template_suggestions;
    }
    if (args.framework_elements) {
      frameworkArgs.framework_elements = args.framework_elements;
    }
    if (args.argument_suggestions) {
      frameworkArgs.argument_suggestions = args.argument_suggestions;
    }
    if (args.judge_prompt) {
      frameworkArgs.judge_prompt = args.judge_prompt;
    }

    // Advanced phases parameters (pass-through)
    if (args.processing_steps) {
      frameworkArgs.processing_steps = args.processing_steps;
    }
    if (args.execution_steps) {
      frameworkArgs.execution_steps = args.execution_steps;
    }
    if (args.execution_type_enhancements) {
      frameworkArgs.execution_type_enhancements = args.execution_type_enhancements;
    }
    if (args.template_enhancements) {
      frameworkArgs.template_enhancements = args.template_enhancements;
    }
    if (args.execution_flow) {
      frameworkArgs.execution_flow = args.execution_flow;
    }
    if (args.quality_indicators) {
      frameworkArgs.quality_indicators = args.quality_indicators;
    }

    // Versioning parameters (pass through directly - canonical names)
    if (args.version !== undefined) {
      frameworkArgs.version = args.version;
    }
    if (args.from_version !== undefined) {
      frameworkArgs.from_version = args.from_version;
    }
    if (args.to_version !== undefined) {
      frameworkArgs.to_version = args.to_version;
    }
    if (args.skip_version !== undefined) {
      frameworkArgs.skip_version = args.skip_version;
    }
    if (args.limit !== undefined) {
      frameworkArgs.limit = args.limit;
    }

    return await this.frameworkManager.handleAction(frameworkArgs, context);
  }

  /**
   * Create an error response
   */
  private createErrorResponse(text: string): ToolResponse {
    return {
      content: [{ type: 'text', text: `❌ ${text}` }],
      isError: true,
    };
  }
}

/**
 * Create a ResourceManagerRouter instance
 */
export function createResourceManagerRouter(
  deps: ResourceManagerDependencies
): ResourceManagerRouter {
  return new ResourceManagerRouter(deps);
}

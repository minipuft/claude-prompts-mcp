// @lifecycle canonical - Unified resource manager router.
/**
 * Resource Manager Router
 *
 * Routes resource_manager requests to the appropriate handler
 * based on the resource_type parameter.
 */

import { describeParameterRefusal } from './parameter-ownership.js';
import {
  CROSS_WORKSPACE_READ_ACTIONS,
  PROMPT_ONLY_ACTIONS,
  FRAMEWORK_ONLY_ACTIONS,
  DESTRUCTIVE_ACTIONS,
  HANDLER_OWNED_CONFIRMATION,
} from './types.js';
import { describePreviewRefusal } from '../../shared/preview-action.js';

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
  CategoryManagerActionId,
  CategoryManagerInput,
} from '../../category-manager/core/types.js';
import type { CategoryToolHandler } from '../../category-manager/index.js';
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
  private readonly categoryManager: CategoryToolHandler;

  constructor(deps: ResourceManagerDependencies) {
    this.logger = deps.logger;
    this.promptResourceHandler = deps.promptResourceHandler;
    this.gateManager = deps.gateManager;
    this.frameworkManager = deps.frameworkManager;
    this.categoryManager = deps.categoryManager;

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

    // Two per-type refusals, both about a parameter this resource type does not read, both ahead
    // of dispatch so no write or version snapshot precedes them.
    //
    // `describeParameterRefusal` owns the general case: one flat schema serves four resource
    // types, so every parameter is accepted for every type at the boundary and only the router
    // decides which ones a handler ever sees. Each branch below forwards a subset; before this
    // guard the rest were dropped silently and the handler still answered success — `framework`
    // + `unset` saved a version and changed nothing.
    //
    // `describePreviewRefusal` is the special case its table cannot express: `preview_action` is
    // valid for every type, and what varies is which OPERATIONS each type can preview. It runs
    // second because "you sent a parameter this type ignores" is the coarser correction.
    const requestRefusal =
      describeParameterRefusal(resource_type, args) ?? describePreviewRefusal(resource_type, args);
    if (requestRefusal !== null) {
      return this.createErrorResponse(requestRefusal);
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
        case 'category':
          return await this.routeToCategoryManager(args, enrichedContext);
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
      // `patch`, and `preview_action` under the names the caller sent.
      argument_updates: args.argument_updates,
      patch: args.patch,
      preview_action: args.preview_action,
      unset: args.unset,
      expected_version: args.expected_version,
      chain_steps: args.chain_steps,
      chain_step_operation: args.chain_step_operation,
      chain_step_index: args.chain_step_index,
      chain_step_data: args.chain_step_data,
      chain_step_order: args.chain_step_order,
      edges: args.edges,
      tools: args.tools,
      tool_operation: args.tool_operation,
      tool_ids: args.tool_ids,
      gate_configuration: args.gate_configuration,
      composer: args.composer,
      // OQ-P7-8. Pass-through, no renaming: `UPDATE_FIELDS` owns the single snake_case →
      // camelCase mapping these take on their way into the YAML, so a second translation here
      // would be the hidden router transformation mcp-contracts.md bans.
      injection: args.injection,
      register_with_mcp: args.register_with_mcp,
      mcp_prompt_mode: args.mcp_prompt_mode,
      subagent_model: args.subagent_model,
      agent_type: args.agent_type,
      full_restart: args.full_restart,
      // Read by `guide`. Forwarded under the caller's names like every field above.
      goal: args.goal,
      include_legacy: args.include_legacy,
      execution_hint: args.execution_hint,
      filter: args.filter,
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
    // Pass-through, no renaming (P4.10): `type` and `gate_type` are two different gate.yaml
    // keys and each tool parameter now carries the name of the key it writes. Until P4.10 the
    // parameter `gate_type` was rewritten to `type` here, which left the real `gate_type` key
    // unauthorable because its name was taken.
    // Handler performs its own validation, so we cast the transformed object
    const gateArgs: GateManagerInput = {
      action: args.action as GateManagerActionId,
    };

    if (args.id) gateArgs.id = args.id;
    if (args.name) gateArgs.name = args.name;
    if (args.type) gateArgs.type = args.type;
    if (args.gate_type) gateArgs.gate_type = args.gate_type;
    if (args.severity) gateArgs.severity = args.severity;
    // snake_case tool parameter → the gate.yaml key's own camelCase spelling. The YAML key is
    // `enforcementMode`; every tool parameter is the snake_case form of its key, so the mapping
    // lands here rather than diverging the published name from the file it writes.
    if (args.enforcement_mode) gateArgs.enforcementMode = args.enforcement_mode;
    if (args.description) gateArgs.description = args.description;
    if (args.subject) gateArgs.subject = args.subject;
    if (args.guidance) gateArgs.guidance = args.guidance;
    if (args.pass_criteria !== undefined) {
      // A bare string only ever existed to populate `required_patterns`, which is gone
      // (B9: never had an evaluator). The MCP schema now rejects bare strings at the
      // boundary (`gatePassCriteriaSchema`, resource-manager.schema.ts), so this filter is
      // type-level safety only — it should never drop a value a validated caller sent.
      const normalizedPassCriteria: NonNullable<GateManagerInput['pass_criteria']> = (
        args.pass_criteria ?? []
      ).filter(
        (criteria): criteria is NonNullable<GateManagerInput['pass_criteria']>[number] =>
          typeof criteria !== 'string'
      );
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
    if (args.preview_action !== undefined) {
      gateArgs.preview_action = args.preview_action as 'delete' | 'rollback';
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
    if (args.preview_action !== undefined) {
      frameworkArgs.preview_action = args.preview_action as 'delete' | 'rollback';
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
   * Route to category manager
   */
  private async routeToCategoryManager(
    args: ResourceManagerInput,
    context: Record<string, unknown>
  ): Promise<ToolResponse> {
    // Pass-through, no renaming, with ONE mapping: `register_with_mcp` / `mcp_prompt_mode` are
    // the snake_case tool parameters for the `category.yaml` keys `registerWithMcp` /
    // `mcpPromptMode`, exactly as `enforcement_mode` is for the gate key `enforcementMode` ten
    // lines up. The mapping lands here rather than diverging the published parameter name from
    // the file key it writes.
    const categoryArgs: CategoryManagerInput = {
      action: args.action as CategoryManagerActionId,
    };

    if (args.id) categoryArgs.id = args.id;
    if (args.name) categoryArgs.name = args.name;
    if (args.description) categoryArgs.description = args.description;
    if (args.register_with_mcp !== undefined) {
      categoryArgs.registerWithMcp = args.register_with_mcp;
    }
    if (args.mcp_prompt_mode !== undefined) {
      categoryArgs.mcpPromptMode = args.mcp_prompt_mode;
    }
    if (args.confirm !== undefined) {
      categoryArgs.confirm = args.confirm;
    }
    if (args.preview_action !== undefined) {
      categoryArgs.preview_action = args.preview_action as 'delete' | 'rollback';
    }
    if (args.source_workspace !== undefined) {
      categoryArgs.source_workspace = args.source_workspace;
    }
    if (args.reason) {
      categoryArgs.reason = args.reason;
    }

    // Versioning parameters (pass through directly - canonical names)
    if (args.version !== undefined) {
      categoryArgs.version = args.version;
    }
    if (args.from_version !== undefined) {
      categoryArgs.from_version = args.from_version;
    }
    if (args.to_version !== undefined) {
      categoryArgs.to_version = args.to_version;
    }
    if (args.skip_version !== undefined) {
      categoryArgs.skip_version = args.skip_version;
    }
    if (args.limit !== undefined) {
      categoryArgs.limit = args.limit;
    }

    return await this.categoryManager.handleAction(categoryArgs, context);
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

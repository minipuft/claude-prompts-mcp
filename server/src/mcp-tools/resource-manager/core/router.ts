// @lifecycle canonical - Unified resource manager router.
/**
 * Resource Manager Router
 *
 * Routes resource_manager requests to the appropriate handler
 * based on the resource_type parameter.
 */

import { PROMPT_ONLY_ACTIONS, METHODOLOGY_ONLY_ACTIONS } from './types.js';

import type {
  ResourceManagerInput,
  ResourceManagerDependencies,
  ResourceType,
  ResourceAction,
  ActionValidationResult,
} from './types.js';
import type { Logger } from '../../../logging/index.js';
import type { PromptManagerActionId } from '../../../tooling/action-metadata/definitions/prompt-manager.js';
import type { ToolResponse } from '../../../types/index.js';
import type {
  FrameworkManagerActionId,
  FrameworkManagerInput,
} from '../../framework-manager/core/types.js';
import type { ConsolidatedFrameworkManager } from '../../framework-manager/index.js';
import type { GateManagerActionId, GateManagerInput } from '../../gate-manager/core/types.js';
import type { ConsolidatedGateManager } from '../../gate-manager/index.js';
import type { ConsolidatedPromptManager } from '../../prompt-manager/index.js';

/**
 * ResourceManagerRouter routes requests to the appropriate handler
 */
export class ResourceManagerRouter {
  private readonly logger: Logger;
  private readonly promptManager: ConsolidatedPromptManager;
  private readonly gateManager: ConsolidatedGateManager;
  private readonly frameworkManager: ConsolidatedFrameworkManager;

  constructor(deps: ResourceManagerDependencies) {
    this.logger = deps.logger;
    this.promptManager = deps.promptManager;
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

    this.logger.debug(`[ResourceManager] Routing ${resource_type}:${action}`, {
      resource_type,
      action,
      id: args.id,
    });

    // Route to appropriate handler
    try {
      switch (resource_type) {
        case 'prompt':
          return await this.routeToPromptManager(args, context);
        case 'gate':
          return await this.routeToGateManager(args, context);
        case 'methodology':
          return await this.routeToFrameworkManager(args, context);
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

    // Check methodology-only actions
    if (METHODOLOGY_ONLY_ACTIONS.includes(action) && resourceType !== 'methodology') {
      return {
        valid: false,
        error: `Action "${action}" is only valid for resource_type: "methodology"`,
      };
    }

    return { valid: true };
  }

  /**
   * Route to prompt manager
   */
  private async routeToPromptManager(
    args: ResourceManagerInput,
    context: Record<string, unknown>
  ): Promise<ToolResponse> {
    // Transform args to prompt_manager format
    // Action is validated before reaching here, so cast is safe
    const promptArgs: Record<string, unknown> = {
      action: args.action as PromptManagerActionId,
      id: args.id,
      name: args.name,
      description: args.description,
      category: args.category,
      user_message_template: args.user_message_template,
      system_message: args.system_message,
      arguments: args.arguments,
      chain_steps: args.chain_steps,
      tools: args.tools,
      gate_configuration: args.gate_configuration,
      execution_hint: args.execution_hint,
      section: args.section,
      section_content: args.section_content,
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
    };

    return await this.promptManager.handleAction(
      promptArgs as Parameters<typeof this.promptManager.handleAction>[0],
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
    if (args.methodology) frameworkArgs.methodology = args.methodology;
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
    if (args.reason) {
      frameworkArgs.reason = args.reason;
    }

    // Advanced methodology parameters (pass-through)
    if (args.methodology_gates) {
      frameworkArgs.methodology_gates = args.methodology_gates;
    }
    if (args.template_suggestions) {
      frameworkArgs.template_suggestions = args.template_suggestions;
    }
    if (args.methodology_elements) {
      frameworkArgs.methodology_elements = args.methodology_elements;
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

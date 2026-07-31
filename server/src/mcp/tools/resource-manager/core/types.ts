// @lifecycle canonical - Types for unified resource manager.
/**
 * Unified Resource Manager Types
 *
 * Defines the types for the unified resource_manager MCP tool
 * that routes to prompt, gate, and framework handlers.
 */

import type { Logger, ToolResponse } from '../../../../shared/types/index.js';
import type {
  FrameworkManagerInput,
  FrameworkGate,
  TemplateSuggestion,
  FrameworkElements,
  ArgumentSuggestion,
  ProcessingStep,
  ExecutionStep,
  ExecutionTypeEnhancements,
  TemplateEnhancements,
  ExecutionFlow,
  QualityIndicators,
} from '../../framework-manager/core/types.js';
import type { FrameworkToolHandler } from '../../framework-manager/index.js';
import type { GateManagerInput } from '../../gate-manager/core/types.js';
import type { GateToolHandler } from '../../gate-manager/index.js';
import type { CheckpointToolHandler } from '../checkpoint/index.js';

/**
 * Script tool definition for inline tool creation
 */
export interface ToolDefinitionInput {
  /** Tool identifier (becomes directory name) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Tool description */
  description?: string;
  /** Script content (written to script.py/js/sh) */
  script: string;
  /** Script runtime: python, node, shell, or auto (default: auto) */
  runtime?: 'python' | 'node' | 'shell' | 'auto';
  /** JSON Schema for input validation */
  schema?: Record<string, unknown>;
  /** Trigger mode: schema_match (default), explicit, always, never */
  trigger?: 'schema_match' | 'explicit' | 'always' | 'never';
  /** Require user confirmation before execution */
  confirm?: boolean;
  /** Strict mode: require ALL params vs ANY params */
  strict?: boolean;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

/**
 * Resource types supported by the unified manager
 */
export type ResourceType = 'prompt' | 'gate' | 'framework' | 'checkpoint';

/**
 * All possible actions across resource types
 */
export type ResourceAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'list'
  | 'inspect'
  | 'reload'
  | 'analyze_type' // prompt only
  | 'analyze_gates' // prompt only
  | 'guide' // prompt only
  | 'switch' // framework only
  | 'history' // versioning (all types)
  | 'rollback' // versioning (all types) + checkpoint
  | 'compare' // versioning (all types)
  | 'clear'; // checkpoint only

/**
 * Actions specific to certain resource types
 */
export const PROMPT_ONLY_ACTIONS: ResourceAction[] = ['analyze_type', 'analyze_gates', 'guide'];
export const FRAMEWORK_ONLY_ACTIONS: ResourceAction[] = ['switch'];
export const CHECKPOINT_ONLY_ACTIONS: ResourceAction[] = ['clear'];
export const VERSIONING_ACTIONS: ResourceAction[] = ['history', 'rollback', 'compare'];
export const COMMON_ACTIONS: ResourceAction[] = [
  'create',
  'update',
  'delete',
  'list',
  'inspect',
  'reload',
  'history',
  'rollback',
  'compare',
];

/**
 * Unified input for the resource_manager tool
 */
type GatePassCriteria = NonNullable<GateManagerInput['pass_criteria']>[number];
type FrameworkPhase = NonNullable<FrameworkManagerInput['phases']>[number];
type FrameworkToolDescriptions = NonNullable<FrameworkManagerInput['tool_descriptions']>;

export interface ResourceManagerInput {
  // Router parameter (REQUIRED - validated by Zod schema)
  resource_type: ResourceType;

  // Action (REQUIRED - validated by Zod schema)
  action: ResourceAction;

  // Common parameters
  id?: string;
  name?: string;
  description?: string;
  enabled_only?: boolean;
  confirm?: boolean;
  reason?: string;

  // Prompt-specific parameters
  category?: string;
  user_message_template?: string;
  system_message?: string;
  arguments?: Array<{
    name: string;
    type?: string;
    description?: string;
    required?: boolean;
  }>;
  chain_steps?: Array<Record<string, unknown>>;
  /** [Prompt] Step-level operation for chain updates (default: replace entire array) */
  chain_step_operation?: 'add' | 'remove' | 'reorder' | 'replace';
  /** [Prompt] Target index for add (insertion point) or remove (step to delete) */
  chain_step_index?: number;
  /** [Prompt] Step definition for add operation */
  chain_step_data?: Record<string, unknown>;
  /** [Prompt] New index order for reorder operation */
  chain_step_order?: number[];
  /** [Prompt] Script tools to create with the prompt */
  tools?: ToolDefinitionInput[];
  gate_configuration?: {
    include?: string[];
    exclude?: string[];
    framework_gates?: boolean;
  };
  execution_hint?: 'single' | 'chain';
  is_chain?: boolean;
  full_restart?: boolean;
  filter?: string;
  format?: 'table' | 'json' | 'text';
  detail?: 'summary' | 'full';
  search_query?: string;

  // Gate-specific parameters
  gate_type?: 'validation' | 'guidance';
  guidance?: string;
  pass_criteria?: Array<string | GatePassCriteria>;
  activation?: {
    prompt_categories?: string[];
    frameworks?: string[];
    explicit_request?: boolean;
  };
  retry_config?: {
    max_attempts?: number;
    improvement_hints?: boolean | string[];
    preserve_context?: boolean;
  };

  // Framework-specific parameters
  framework?: string;
  system_prompt_guidance?: string;
  phases?: FrameworkPhase[];
  gates?: {
    include?: string[];
    exclude?: string[];
  };
  tool_descriptions?: Record<string, string | FrameworkToolDescriptions[string]>;
  enabled?: boolean;
  persist?: boolean;

  // Advanced framework parameters (not advertised for token efficiency)
  methodology_gates?: FrameworkGate[];
  template_suggestions?: TemplateSuggestion[];
  methodology_elements?: FrameworkElements;
  argument_suggestions?: ArgumentSuggestion[];
  judge_prompt?: string;

  // Advanced phases parameters
  processing_steps?: ProcessingStep[];
  execution_steps?: ExecutionStep[];
  execution_type_enhancements?: ExecutionTypeEnhancements;
  template_enhancements?: TemplateEnhancements;
  execution_flow?: ExecutionFlow;
  quality_indicators?: QualityIndicators;

  // Versioning parameters
  /** [Versioning] Target version for rollback action */
  version?: number;
  /** [Versioning] Starting version for compare action */
  from_version?: number;
  /** [Versioning] Ending version for compare action */
  to_version?: number;
  /** [Versioning] Max versions to return in history. Default: 10 */
  limit?: number;
  /** [Versioning] Skip auto-versioning for this update */
  skip_version?: boolean;
}

/**
 * Interface for prompt resource service (breaks concrete import cycle).
 * The concrete PromptResourceHandler in ../prompt/ implements this.
 */
export interface PromptResourceHandlerPort {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleAction(args: { action: string; [key: string]: any }, extra: any): Promise<ToolResponse>;
}

/**
 * Dependencies for the ResourceManagerRouter
 */
export interface ResourceManagerDependencies {
  logger: Logger;
  promptResourceHandler: PromptResourceHandlerPort;
  gateManager: GateToolHandler;
  frameworkManager: FrameworkToolHandler;
  checkpointManager?: CheckpointToolHandler;
}

/**
 * Validation result for action/resource_type combination
 */
export interface ActionValidationResult {
  valid: boolean;
  error?: string;
}

// @lifecycle canonical - Type definitions for chain operator execution
import type { PendingGateReview } from '#shared/types/chain-execution.js';
import type { FrameworkExecutionContext } from '../../frameworks/types/index.js';
import type { ConvertedPrompt, ExecutionPlan } from '../types.js';

/**
 * Represents a single step in a chain execution workflow.
 *
 * This interface captures all metadata needed to render and execute a chain step,
 * including prompt identification, arguments, gate criteria, and execution context.
 */
export interface ChainStepPrompt {
  readonly stepNumber: number;
  /**
   * Stable node identity, minted at parse time and frozen for the run.
   *
   * Still optional (P3 D10): making it required reddened 40 duck-typed fixture literals across
   * 7 test files, past the tier's escape-hatch threshold. Every production construction site
   * sets it; `SessionManagementStage.buildChainNodes` warns and falls back to sequential ids
   * when a parsed chain reaches the store without one, which is the detector this type-level
   * requirement would otherwise have been.
   */
  readonly nodeId?: string;
  readonly promptId: string;
  readonly args: Record<string, unknown>;
  readonly inlineGateCriteria?: readonly string[];
  inlineGateIds?: string[];
  convertedPrompt?: ConvertedPrompt; // Optional - looked up if not provided
  metadata?: Record<string, unknown>; // For storing step-specific data like gate instructions
  executionPlan?: ExecutionPlan;
  frameworkContext?: FrameworkExecutionContext;
  /** Map step results to semantic names (e.g., { "research": "step1_result" }) */
  inputMapping?: Record<string, string>;
  /** Name this step's output for downstream steps */
  outputMapping?: Record<string, string>;
  /** Number of retry attempts on failure (default: 0) */
  retries?: number;
  /** True if this step should be delegated to a sub-agent via Task tool */
  delegated?: boolean;
  /** Override agent type for delegation (default: 'chain-executor') */
  agentType?: string;
  /** Capability hint for delegation model selection (step-level override) */
  subagentModel?: 'heavy' | 'standard' | 'fast';
}

/**
 * Base interface for all chain step execution inputs.
 *
 * Provides common fields shared across different execution types (normal vs gate review).
 */
interface BaseChainStepExecutionInput {
  readonly stepPrompts: readonly ChainStepPrompt[];
  readonly chainContext?: Record<string, unknown>;
  readonly additionalGateIds?: readonly string[];
  readonly inlineGuidanceText?: string;
}

/**
 * Normal step execution input (non-review).
 *
 * Used when executing a standard chain step with template rendering and context injection.
 */
export interface NormalStepInput extends BaseChainStepExecutionInput {
  readonly executionType: 'normal';
  readonly currentStepIndex: number;
}

/**
 * Gate review step execution input.
 *
 * Used when rendering a synthetic quality gate validation step with review guidance.
 */
export interface GateReviewInput extends BaseChainStepExecutionInput {
  readonly executionType: 'gate_review';
  readonly pendingGateReview: PendingGateReview;
}

/**
 * Discriminated union for chain step execution inputs.
 *
 * Enables type-safe handling of both normal execution and gate review scenarios
 * using the `executionType` discriminator field.
 */
export type ChainStepExecutionInput = NormalStepInput | GateReviewInput;

/**
 * Result of rendering a chain step for execution.
 *
 * Contains all information needed to present the step to the user or LLM,
 * including the rendered content, step metadata, and call-to-action guidance.
 */
export interface ChainStepRenderResult {
  stepNumber: number;
  totalSteps: number;
  promptId: string;
  promptName: string;
  content: string;
  callToAction: string;
  /** True when the next step in the chain is delegated to a sub-agent */
  nextStepDelegated?: boolean;
}

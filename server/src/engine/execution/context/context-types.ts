// @lifecycle canonical - Type definitions for execution context structures.
/**
 * Execution Context Type Definitions
 *
 * Contains interfaces used by ExecutionContext for pipeline state management.
 * Separated from the class implementation to enable clean imports without
 * circular dependencies.
 */

import type { PendingGateReview } from '#shared/types/chain-execution.js';
import type { DeclaredRunBudget } from '#shared/types/chain-session.js';
import type { ChainStepPrompt } from '../operators/types.js';
import type { CommandParseResult } from '../parsers/command-parser.js';
import type { ConvertedPrompt, ExecutionModifiers } from '../types.js';

/**
 * Named inline gate from symbolic syntax (e.g., `:: security:"no secrets"`)
 * Also supports shell verification gates (e.g., `:: verify:"npm test"`)
 */
export interface NamedInlineGate {
  /** Explicit gate ID from symbolic syntax */
  gateId: string;
  /** Criteria associated with this named gate */
  criteria: string[];
  /** Shell verification config for Ralph Wiggum loops (when using `:: verify:"command"`) */
  shellVerify?: {
    command: string;
    timeout?: number;
    workingDir?: string;
  };
}

/**
 * Parsed command representation shared between parsing and planning stages.
 */
export interface ParsedCommand extends CommandParseResult {
  commandType?: 'single' | 'chain';
  convertedPrompt?: ConvertedPrompt;
  promptArgs?: Record<string, unknown>;
  /** Anonymous inline criteria (merged from `:: "criteria"` without explicit ID) */
  inlineGateCriteria?: string[];
  inlineGateIds?: string[];
  /** Named inline gates with explicit IDs from symbolic syntax (e.g., `:: id:"criteria"`) */
  namedInlineGates?: NamedInlineGate[];
  chainId?: string;
  steps?: ChainStepPrompt[];
  modifiers?: ExecutionModifiers;
  styleSelection?: string;
  /**
   * Run-level budget declared by a submitted Workflow IR (P6 Tier 5). Rides the parsed command
   * because that is what `SessionManagementStage.buildSessionBlueprint` clones into the run's
   * residual document — so the cap survives the call that declared it and is readable on every
   * later step of the run without a column, a `createSession` parameter, or a second store.
   *
   * Absent on every other submission path. Absence means "server defaults", never "zero".
   */
  budget?: DeclaredRunBudget;
}

/**
 * Session state propagated through the pipeline.
 */
export interface SessionContext {
  sessionId: string;
  chainId?: string;
  isChainExecution: boolean;
  /**
   * Derived 1-based position of the run. Kept as an integer because rendering, injection
   * targeting and the completion latch are all positional; `currentNodeId` is the identity
   * the store actually addresses by.
   */
  currentStep?: number;
  /** Stable node id the run is standing at. `null` once the run passed its terminal node. */
  currentNodeId?: string | null;
  totalSteps?: number;
  pendingReview?: PendingGateReview;
  /** Result status from the previous step (for injection condition evaluation) */
  previousStepResult?: 'success' | 'failure' | 'skipped';
  /** Quality score from the previous step (0-100, if gate evaluation provided one) */
  previousStepQualityScore?: number;
}

/**
 * Holds raw execution results before formatting into ToolResponse objects.
 */
export interface ExecutionResults {
  content: unknown;
  metadata?: Record<string, unknown>;
  generatedAt?: number;
}

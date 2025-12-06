// @lifecycle canonical - Type definitions for chain sessions.
import type { ParsedCommand } from '../execution/context/execution-context.js';
import type { ExecutionPlan } from '../execution/types.js';
import type {
  ChainState,
  PendingGateReview,
  StepMetadata,
  StepState,
} from '../mcp-tools/prompt-engine/core/types.js';

export type ChainSessionLifecycle = 'legacy' | 'canonical';

export interface SessionBlueprint {
  parsedCommand: ParsedCommand;
  executionPlan: ExecutionPlan;
  gateInstructions?: string;
}

export interface ChainSession {
  sessionId: string;
  chainId: string;
  state: ChainState;
  currentStepId?: string;
  executionOrder: number[];
  startTime: number;
  lastActivity: number;
  originalArgs: Record<string, any>;
  /**
   * Pending gate review awaiting user verdict.
   * @remarks Infrastructure for pause/resume validation. APIs implemented but not yet auto-triggered.
   * Planned for future semantic layer gate enforcement.
   */
  pendingGateReview?: PendingGateReview;
  blueprint?: SessionBlueprint;
  lifecycle?: ChainSessionLifecycle;
}

export interface GateReviewOutcomeUpdate {
  verdict: 'PASS' | 'FAIL';
  rationale?: string;
  rawVerdict: string;
  reviewer?: string;
}

export interface ChainSessionSummary {
  sessionId: string;
  chainId: string;
  currentStep: number;
  totalSteps: number;
  pendingReview: boolean;
  lastActivity: number;
  startTime: number;
  promptName?: string;
  promptId?: string;
}

export interface PersistedChainRunRegistry {
  version?: number;
  runs?: Record<string, any>;
  runMapping?: Record<string, string[]>;
  baseRunMapping?: Record<string, string[]>;
  runToBase?: Record<string, string>;
  /** Legacy keys preserved for backward compatibility */
  sessions?: Record<string, any>;
  chainMapping?: Record<string, string[]>;
  baseChainMapping?: Record<string, string[]>;
  runChainToBase?: Record<string, string>;
}

export interface ChainSessionLookupOptions {
  includeLegacy?: boolean;
}

export interface ChainSessionService {
  createSession(
    sessionId: string,
    chainId: string,
    totalSteps: number,
    originalArgs?: Record<string, any>,
    options?: { blueprint?: SessionBlueprint }
  ): Promise<ChainSession>;
  getSession(sessionId: string): ChainSession | undefined;
  hasActiveSession(sessionId: string): boolean;
  hasActiveSessionForChain(chainId: string): boolean;
  getActiveSessionForChain(chainId: string): ChainSession | undefined;
  getSessionByChainIdentifier(
    chainId: string,
    options?: ChainSessionLookupOptions
  ): ChainSession | undefined;
  getLatestSessionForBaseChain(chainId: string): ChainSession | undefined;
  getRunHistory(baseChainId: string): string[];
  getChainContext(sessionId: string): Record<string, any>;
  getOriginalArgs(sessionId: string): Record<string, any>;
  getSessionBlueprint(sessionId: string): SessionBlueprint | undefined;
  updateSessionBlueprint(sessionId: string, blueprint: SessionBlueprint): void;
  getInlineGateIds(sessionId: string): string[] | undefined;
  setPendingGateReview(sessionId: string, review: PendingGateReview): Promise<void>;
  getPendingGateReview(sessionId: string): PendingGateReview | undefined;
  clearPendingGateReview(sessionId: string): Promise<void>;
  isRetryLimitExceeded(sessionId: string): boolean;
  resetRetryCount(sessionId: string): Promise<void>;
  recordGateReviewOutcome(
    sessionId: string,
    outcome: GateReviewOutcomeUpdate
  ): Promise<'cleared' | 'pending'>;
  clearSessionsForChain(chainId: string): Promise<void>;
  listActiveSessions(limit?: number): ChainSessionSummary[];
  updateSessionState(
    sessionId: string,
    stepNumber: number,
    stepResult: string,
    metadata?: Record<string, any>
  ): Promise<boolean>;
  setStepState(
    sessionId: string,
    stepNumber: number,
    state: StepState,
    isPlaceholder?: boolean
  ): boolean;
  getStepState(sessionId: string, stepNumber: number): StepMetadata | undefined;
  transitionStepState(
    sessionId: string,
    stepNumber: number,
    newState: StepState,
    isPlaceholder?: boolean
  ): Promise<boolean>;
  isStepComplete(sessionId: string, stepNumber: number): boolean;
  completeStep(
    sessionId: string,
    stepNumber: number,
    options?: { preservePlaceholder?: boolean; metadata?: Record<string, any> }
  ): Promise<boolean>;
  cleanup(): Promise<void>;
}

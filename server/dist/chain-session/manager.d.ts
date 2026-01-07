/**
 * Chain Session Manager
 *
 * Manages chain execution sessions, providing the bridge between MCP session IDs
 * and the persisted chain state/step capture utilities. This enables stateful
 * chain execution across multiple MCP tool calls.
 *
 * CRITICAL: Uses file-based persistence to survive STDIO transport's ephemeral processes.
 * Sessions are saved to disk after every change and loaded on initialization.
 */
import { type ChainRunRegistry } from './run-registry.js';
import { Logger } from '../logging/index.js';
import { PendingGateReview, StepMetadata, StepState } from '../mcp-tools/prompt-engine/core/types.js';
import { ArgumentHistoryTracker, TextReferenceManager } from '../text-references/index.js';
import type { ChainSession, ChainSessionLookupOptions, ChainSessionService, ChainSessionSummary, GateReviewOutcomeUpdate, SessionBlueprint } from './types.js';
interface ChainSessionManagerOptions {
    serverRoot: string;
    defaultSessionTimeoutMs?: number;
    reviewSessionTimeoutMs?: number;
    cleanupIntervalMs?: number;
}
/**
 * Chain Session Manager class
 *
 * Coordinates session state between MCP protocol, step capture, and execution context tracking.
 * Provides session-aware context retrieval for chain execution.
 */
export declare class ChainSessionManager implements ChainSessionService {
    private logger;
    private textReferenceManager;
    private argumentHistoryTracker?;
    private activeSessions;
    private chainSessionMapping;
    private baseChainMapping;
    private runChainToBase;
    private readonly runRegistry;
    private readonly serverRoot;
    private readonly defaultSessionTimeoutMs;
    private readonly reviewSessionTimeoutMs;
    private readonly cleanupIntervalMs;
    private cleanupIntervalHandle?;
    constructor(logger: Logger, textReferenceManager: TextReferenceManager, options: ChainSessionManagerOptions, argumentHistoryTracker?: ArgumentHistoryTracker, sessionStore?: ChainRunRegistry);
    /**
     * Initialize the manager asynchronously
     */
    private initialize;
    /**
     * Fire-and-forget cleanup scheduler (unref to avoid blocking shutdown)
     */
    private startCleanupScheduler;
    /**
     * Load sessions from file (for STDIO transport persistence)
     */
    private loadSessions;
    /**
     * Save sessions to file (for STDIO transport persistence)
     */
    private saveSessions;
    private serializeSessions;
    private persistSessions;
    private persistSessionsAsync;
    /**
     * Create a new chain session
     */
    createSession(sessionId: string, chainId: string, totalSteps: number, originalArgs?: Record<string, any>, options?: {
        blueprint?: SessionBlueprint;
    }): Promise<ChainSession>;
    /**
     * Get session by ID
     */
    getSession(sessionId: string): ChainSession | undefined;
    /**
     * Set step state for a specific step
     */
    setStepState(sessionId: string, stepNumber: number, state: StepState, isPlaceholder?: boolean): boolean;
    /**
     * Get step state for a specific step
     */
    getStepState(sessionId: string, stepNumber: number): StepMetadata | undefined;
    /**
     * Transition step to a new state
     */
    transitionStepState(sessionId: string, stepNumber: number, newState: StepState, isPlaceholder?: boolean): Promise<boolean>;
    /**
     * Check if a step is complete (not a placeholder and in COMPLETED state)
     */
    isStepComplete(sessionId: string, stepNumber: number): boolean;
    /**
     * Update session state after step rendering or completion
     * IMPORTANT: This method now handles both rendering (template storage) and completion
     */
    updateSessionState(sessionId: string, stepNumber: number, stepResult: string, stepMetadata?: Record<string, any>): Promise<boolean>;
    /**
     * Update an existing step result (e.g., replace placeholder with LLM output)
     */
    updateStepResult(sessionId: string, stepNumber: number, stepResult: string, stepMetadata?: Record<string, any>): Promise<boolean>;
    /**
     * Mark a step as COMPLETED and advance the step counter
     * This should be called AFTER the step response has been captured and validated
     */
    completeStep(sessionId: string, stepNumber: number, options?: {
        preservePlaceholder?: boolean;
    }): Promise<boolean>;
    /**
     * Advance to the next step after gate validation passes.
     * This should be called ONLY when:
     * - Gate review passes (PASS verdict)
     * - No gates are configured for this step
     * - Enforcement mode is advisory/informational (non-blocking)
     *
     * @param sessionId - The session identifier
     * @param stepNumber - The step that was completed (will advance to stepNumber + 1)
     * @returns true if advanced successfully, false if session not found
     */
    advanceStep(sessionId: string, stepNumber: number): Promise<boolean>;
    /**
     * Persist a step result to storage and optional tracking systems.
     */
    private persistStepResult;
    /**
     * Get chain context for session - this is the critical method for fixing contextData
     */
    getChainContext(sessionId: string): Record<string, any>;
    /**
     * Get original arguments for session
     */
    getOriginalArgs(sessionId: string): Record<string, any>;
    getSessionBlueprint(sessionId: string): SessionBlueprint | undefined;
    updateSessionBlueprint(sessionId: string, blueprint: SessionBlueprint): void;
    getInlineGateIds(sessionId: string): string[] | undefined;
    setPendingGateReview(sessionId: string, review: PendingGateReview): Promise<void>;
    getPendingGateReview(sessionId: string): PendingGateReview | undefined;
    /**
     * Check if the retry limit has been exceeded for a pending gate review.
     * Returns true if attemptCount >= maxAttempts.
     * @remarks Uses DEFAULT_RETRY_LIMIT (2) when maxAttempts not specified.
     */
    isRetryLimitExceeded(sessionId: string): boolean;
    /**
     * Reset the retry count for a pending gate review.
     * Used when user chooses to retry after retry exhaustion.
     */
    resetRetryCount(sessionId: string): Promise<void>;
    clearPendingGateReview(sessionId: string): Promise<void>;
    recordGateReviewOutcome(sessionId: string, outcome: GateReviewOutcomeUpdate): Promise<'cleared' | 'pending'>;
    /**
     * Check if session exists and is active
     */
    hasActiveSession(sessionId: string): boolean;
    /**
     * Check if chain has any active sessions
     */
    hasActiveSessionForChain(chainId: string): boolean;
    getRunHistory(baseChainId: string): string[];
    getLatestSessionForBaseChain(baseChainId: string): ChainSession | undefined;
    getSessionByChainIdentifier(chainId: string, options?: ChainSessionLookupOptions): ChainSession | undefined;
    listActiveSessions(limit?: number): ChainSessionSummary[];
    /**
     * Get active session for chain (returns first active session)
     */
    getActiveSessionForChain(chainId: string): ChainSession | undefined;
    /**
     * Clear session
     */
    clearSession(sessionId: string): Promise<boolean>;
    /**
     * Clear all sessions for a chain
     */
    clearSessionsForChain(chainId: string): Promise<void>;
    /**
     * Cleanup stale sessions (older than 24 hours)
     */
    cleanupStaleSessions(): Promise<number>;
    private registerRunHistory;
    private pruneExcessRuns;
    private removeRunChainSessions;
    private removeSessionArtifacts;
    private removeRunFromBaseTracking;
    private extractBaseChainId;
    private getRunNumber;
    private ensureRunMappingConsistency;
    /**
     * Get session statistics
     */
    getSessionStats(): {
        totalSessions: number;
        totalChains: number;
        averageStepsPerChain: number;
        oldestSessionAge: number;
    };
    /**
     * Validate session integrity
     */
    validateSession(sessionId: string): {
        valid: boolean;
        issues: string[];
    };
    /**
     * Cleanup the chain session manager and persist state
     * Prevents async handle leaks by finalizing all file operations
     */
    cleanup(): Promise<void>;
    private isDormantSession;
    private promoteSessionLifecycle;
    private getDormantSessionForChain;
    private getDormantSessionForBaseChain;
    private buildChainMetadata;
    private collectInlineGateIds;
    private getCurrentStepArgs;
    private cloneBlueprint;
}
export type { ChainSession, ChainSessionService, ChainSessionSummary, SessionBlueprint, } from './types.js';
/**
 * Create and configure a chain session manager
 */
export declare function createChainSessionManager(logger: Logger, textReferenceManager: TextReferenceManager, serverRoot: string, options?: Omit<ChainSessionManagerOptions, 'serverRoot'>, argumentHistoryTracker?: ArgumentHistoryTracker): ChainSessionManager;

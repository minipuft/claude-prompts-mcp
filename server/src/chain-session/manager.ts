// @lifecycle canonical - Manages chain session persistence and lifecycle promotion.
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

import * as path from 'path';

import { FileBackedChainRunRegistry, type ChainRunRegistry } from './run-registry.js';
import { Logger } from '../logging/index.js';
import {
  GateReviewHistoryEntry,
  PendingGateReview,
  StepMetadata,
  StepState,
} from '../mcp-tools/prompt-engine/core/types.js';
import { ArgumentHistoryTracker, TextReferenceManager } from '../text-references/index.js';

import type {
  ChainSession,
  ChainSessionLookupOptions,
  ChainSessionService,
  ChainSessionSummary,
  GateReviewOutcomeUpdate,
  PersistedChainRunRegistry,
  SessionBlueprint,
} from './types.js';
import type { ParsedCommand } from '../execution/context/execution-context.js';
import type { GateReviewPrompt } from '../execution/types.js';

interface ChainSessionManagerOptions {
  serverRoot: string;
  defaultSessionTimeoutMs?: number;
  reviewSessionTimeoutMs?: number;
  cleanupIntervalMs?: number;
}

const DEFAULT_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REVIEW_SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_RUN_HISTORY = 10;
const CHAIN_RUN_STORE_VERSION = 2;

/**
 * Chain Session Manager class
 *
 * Coordinates session state between MCP protocol, step capture, and execution context tracking.
 * Provides session-aware context retrieval for chain execution.
 */
export class ChainSessionManager implements ChainSessionService {
  private logger: Logger;
  private textReferenceManager: TextReferenceManager;
  private argumentHistoryTracker?: ArgumentHistoryTracker;
  private activeSessions: Map<string, ChainSession> = new Map();
  private chainSessionMapping: Map<string, Set<string>> = new Map(); // chainId -> sessionIds
  private baseChainMapping: Map<string, string[]> = new Map(); // baseChainId -> ordered runIds
  private runChainToBase: Map<string, string> = new Map(); // runChainId -> baseChainId
  private readonly runRegistry: ChainRunRegistry;
  private readonly serverRoot: string;
  private readonly defaultSessionTimeoutMs: number;
  private readonly reviewSessionTimeoutMs: number;
  private readonly cleanupIntervalMs: number;
  private cleanupIntervalHandle?: NodeJS.Timeout;

  constructor(
    logger: Logger,
    textReferenceManager: TextReferenceManager,
    options: ChainSessionManagerOptions,
    argumentHistoryTracker?: ArgumentHistoryTracker,
    sessionStore?: ChainRunRegistry
  ) {
    this.logger = logger;
    this.textReferenceManager = textReferenceManager;
    if (argumentHistoryTracker !== undefined) {
      this.argumentHistoryTracker = argumentHistoryTracker;
    }
    this.serverRoot = options.serverRoot;
    this.defaultSessionTimeoutMs = options.defaultSessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
    this.reviewSessionTimeoutMs =
      options.reviewSessionTimeoutMs ?? DEFAULT_REVIEW_SESSION_TIMEOUT_MS;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;

    // Set up file-based persistence path - use server root instead of process.cwd()
    const runtimeStateDir = path.join(this.serverRoot, 'runtime-state');
    const chainRunsFilePath = path.join(runtimeStateDir, 'chain-run-registry.json');
    const legacyRunsPath = path.join(runtimeStateDir, 'chain-run-history.json');
    const legacySessionsPath = path.join(runtimeStateDir, 'chain-sessions.json');
    this.runRegistry =
      sessionStore ??
      new FileBackedChainRunRegistry(chainRunsFilePath, this.logger, {
        fallbackPaths: [legacyRunsPath, legacySessionsPath],
      });

    this.logger.debug('ChainSessionManager initialized with text reference manager integration');

    // Initialize asynchronously
    this.initialize();
    this.startCleanupScheduler();
  }

  /**
   * Initialize the manager asynchronously
   */
  private async initialize(): Promise<void> {
    try {
      await this.runRegistry.ensureInitialized();
      await this.loadSessions();
    } catch (error) {
      this.logger.warn(
        `Failed to initialize ChainSessionManager: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Fire-and-forget cleanup scheduler (unref to avoid blocking shutdown)
   */
  private startCleanupScheduler(): void {
    if (this.cleanupIntervalHandle) {
      this.cleanupIntervalHandle.unref();
      return;
    }

    this.cleanupIntervalHandle = setInterval(() => {
      this.cleanupStaleSessions().catch((error) => {
        this.logger.warn(
          `Failed to run scheduled session cleanup: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
    }, this.cleanupIntervalMs);

    this.cleanupIntervalHandle.unref();
  }

  /**
   * Load sessions from file (for STDIO transport persistence)
   */
  private async loadSessions(): Promise<void> {
    try {
      const parsed = await this.runRegistry.load();

      const persistedSessions = parsed.runs ?? parsed.sessions ?? {};
      const persistedChainMapping = parsed.runMapping ?? parsed.chainMapping ?? {};
      const persistedBaseMapping = parsed.baseRunMapping ?? parsed.baseChainMapping ?? {};

      // Restore activeSessions Map
      for (const [sessionId, session] of Object.entries(persistedSessions)) {
        const chainSession = session as ChainSession;

        // Deserialize stepStates Map from array format
        if (chainSession.state.stepStates && Array.isArray(chainSession.state.stepStates)) {
          chainSession.state.stepStates = new Map(chainSession.state.stepStates as any);
        } else if (!chainSession.state.stepStates) {
          chainSession.state.stepStates = new Map();
        }

        // All persisted sessions become dormant until explicitly resumed
        chainSession.lifecycle = 'dormant';
        this.activeSessions.set(sessionId, chainSession);
      }

      // Restore chainSessionMapping Map
      for (const [chainId, sessionIds] of Object.entries(persistedChainMapping)) {
        this.chainSessionMapping.set(chainId, new Set(sessionIds));
      }

      this.baseChainMapping.clear();
      this.runChainToBase.clear();
      for (const [baseChainId, runChainIds] of Object.entries(persistedBaseMapping)) {
        this.baseChainMapping.set(baseChainId, [...runChainIds]);
      }

      if (parsed.runToBase ?? parsed.runChainToBase) {
        const runToBaseRecord = parsed.runToBase ?? parsed.runChainToBase;
        for (const [runChainId, baseChainId] of Object.entries(runToBaseRecord ?? {})) {
          if (typeof baseChainId === 'string') {
            this.runChainToBase.set(runChainId, baseChainId);
          }
        }
      }

      this.ensureRunMappingConsistency();

      this.logger?.debug?.(
        `Loaded ${this.activeSessions.size} persisted chain runs from session store`
      );
    } catch (error) {
      this.logger?.warn(
        `Failed to load persisted sessions: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Save sessions to file (for STDIO transport persistence)
   */
  private async saveSessions(): Promise<void> {
    await this.persistSessions();
  }

  private serializeSessions(): PersistedChainRunRegistry {
    const serializedSessions: Record<string, any> = {};
    for (const [sessionId, session] of this.activeSessions) {
      const sessionCopy: any = JSON.parse(JSON.stringify(session));
      sessionCopy.lifecycle = session.lifecycle ?? 'canonical';
      if (session.state?.stepStates instanceof Map) {
        sessionCopy.state = sessionCopy.state ?? {};
        sessionCopy.state.stepStates = Array.from(session.state.stepStates.entries());
      }
      serializedSessions[sessionId] = sessionCopy;
    }

    return {
      version: CHAIN_RUN_STORE_VERSION,
      runs: serializedSessions,
      runMapping: Object.fromEntries(
        Array.from(this.chainSessionMapping.entries()).map(([chainId, sessionIds]) => [
          chainId,
          Array.from(sessionIds),
        ])
      ),
      baseRunMapping: Object.fromEntries(
        Array.from(this.baseChainMapping.entries()).map(([baseChainId, runIds]) => [
          baseChainId,
          [...runIds],
        ])
      ),
      runToBase: Object.fromEntries(this.runChainToBase.entries()),
    };
  }

  private async persistSessions(): Promise<void> {
    try {
      const data = this.serializeSessions();
      await this.runRegistry.save(data);
    } catch (error) {
      this.logger?.error(
        `Failed to save sessions: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private persistSessionsAsync(context: string): void {
    this.saveSessions().catch((error) => {
      this.logger?.warn?.(
        `[ChainSessionManager] Failed to persist sessions (${context}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
  }

  /**
   * Create a new chain session
   */
  async createSession(
    sessionId: string,
    chainId: string,
    totalSteps: number,
    originalArgs: Record<string, any> = {},
    options?: { blueprint?: SessionBlueprint }
  ): Promise<ChainSession> {
    const session: ChainSession = {
      sessionId,
      chainId,
      state: {
        // Chain sessions track steps using 1-based indexing to align with pipeline expectations
        currentStep: totalSteps > 0 ? 1 : 0,
        totalSteps,
        lastUpdated: Date.now(),
        stepStates: new Map<number, StepMetadata>(),
      },
      executionOrder: [],
      startTime: Date.now(),
      lastActivity: Date.now(),
      originalArgs,
      ...(options?.blueprint !== undefined && {
        blueprint: this.cloneBlueprint(options.blueprint),
      }),
      lifecycle: 'canonical',
    };

    this.activeSessions.set(sessionId, session);

    // Track chain to session mapping
    if (!this.chainSessionMapping.has(chainId)) {
      this.chainSessionMapping.set(chainId, new Set());
    }
    this.chainSessionMapping.get(chainId)!.add(sessionId);

    const baseChainId = this.registerRunHistory(chainId);
    this.pruneExcessRuns(baseChainId);

    // Persist to file
    await this.saveSessions();

    if (this.logger) {
      this.logger.debug(
        `Created chain session ${sessionId} for chain ${chainId} with ${totalSteps} steps`
      );
    }
    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): ChainSession | undefined {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      if (
        session.state.totalSteps > 0 &&
        (!session.state.currentStep || session.state.currentStep < 1)
      ) {
        session.state.currentStep = 1;
      }
      session.lastActivity = Date.now();
      this.promoteSessionLifecycle(session, 'session-id lookup');
    }
    return session;
  }

  /**
   * Set step state for a specific step
   */
  setStepState(
    sessionId: string,
    stepNumber: number,
    state: StepState,
    isPlaceholder: boolean = false
  ): boolean {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.logger?.warn(
        `[StepLifecycle] Cannot set step state for non-existent session: ${sessionId}`
      );
      return false;
    }

    if (!session.state.stepStates) {
      session.state.stepStates = new Map<number, StepMetadata>();
    }

    const existing = session.state.stepStates.get(stepNumber);
    const now = Date.now();

    const metadata: StepMetadata = {
      state,
      isPlaceholder,
      ...(existing?.renderedAt !== undefined
        ? { renderedAt: existing.renderedAt }
        : state === StepState.RENDERED
          ? { renderedAt: now }
          : {}),
      ...(state === StepState.RESPONSE_CAPTURED
        ? { respondedAt: now }
        : existing?.respondedAt !== undefined
          ? { respondedAt: existing.respondedAt }
          : {}),
      ...(state === StepState.COMPLETED
        ? { completedAt: now }
        : existing?.completedAt !== undefined
          ? { completedAt: existing.completedAt }
          : {}),
    };

    session.state.stepStates.set(stepNumber, metadata);

    this.logger?.debug(
      `[StepLifecycle] Step ${stepNumber} state set to ${state} (placeholder: ${isPlaceholder})`
    );
    return true;
  }

  /**
   * Get step state for a specific step
   */
  getStepState(sessionId: string, stepNumber: number): StepMetadata | undefined {
    const session = this.activeSessions.get(sessionId);
    if (!session?.state.stepStates) {
      return undefined;
    }
    return session.state.stepStates.get(stepNumber);
  }

  /**
   * Transition step to a new state
   */
  async transitionStepState(
    sessionId: string,
    stepNumber: number,
    newState: StepState,
    isPlaceholder: boolean = false
  ): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.logger?.warn(
        `[StepLifecycle] Cannot transition step state for non-existent session: ${sessionId}`
      );
      return false;
    }

    const currentMetadata = this.getStepState(sessionId, stepNumber);
    const currentState = currentMetadata?.state;

    // Log state transition
    this.logger?.debug(
      `[StepLifecycle] Transitioning step ${stepNumber} from ${
        currentState || 'NONE'
      } to ${newState}`
    );

    // Set the new state
    this.setStepState(sessionId, stepNumber, newState, isPlaceholder);

    // Persist to file
    await this.saveSessions();

    return true;
  }

  /**
   * Check if a step is complete (not a placeholder and in COMPLETED state)
   */
  isStepComplete(sessionId: string, stepNumber: number): boolean {
    const metadata = this.getStepState(sessionId, stepNumber);
    return metadata?.state === StepState.COMPLETED && !metadata.isPlaceholder;
  }

  /**
   * Update session state after step rendering or completion
   * IMPORTANT: This method now handles both rendering (template storage) and completion
   */
  async updateSessionState(
    sessionId: string,
    stepNumber: number,
    stepResult: string,
    stepMetadata?: Record<string, any>
  ): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      if (this.logger) {
        this.logger.warn(`Attempted to update non-existent session: ${sessionId}`);
      }
      return false;
    }

    const metadataRecord = {
      ...(stepMetadata || {}),
      isPlaceholder: stepMetadata?.['isPlaceholder'] ?? false,
      storedAt: Date.now(),
    };

    const isPlaceholder = metadataRecord.isPlaceholder;

    // Determine the appropriate state based on whether this is a placeholder
    const stepState = isPlaceholder ? StepState.RENDERED : StepState.RESPONSE_CAPTURED;

    // Update step state tracking
    this.setStepState(sessionId, stepNumber, stepState, isPlaceholder);

    // NOTE: Step advancement is now handled by advanceStep() which should be called
    // ONLY after gate validation passes (or if no gates are configured).
    // This prevents the bug where retry would skip to the next step.
    this.logger?.debug(
      `[StepLifecycle] Step ${stepNumber} ${isPlaceholder ? 'rendered as placeholder' : 'response captured'}, ` +
        `currentStep remains ${session.state.currentStep} (advancement deferred to advanceStep())`
    );

    session.state.lastUpdated = Date.now();
    session.lastActivity = Date.now();

    this.persistStepResult(
      session,
      stepNumber,
      stepResult,
      metadataRecord,
      metadataRecord.isPlaceholder
    );

    // Persist to file
    await this.saveSessions();

    return true;
  }

  /**
   * Update an existing step result (e.g., replace placeholder with LLM output)
   */
  async updateStepResult(
    sessionId: string,
    stepNumber: number,
    stepResult: string,
    stepMetadata?: Record<string, any>
  ): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      if (this.logger) {
        this.logger.warn(`Attempted to update result for non-existent session: ${sessionId}`);
      }
      return false;
    }

    const existingMetadata =
      this.textReferenceManager.getChainStepMetadata(session.chainId, stepNumber) || {};

    const mergedMetadata = {
      ...existingMetadata,
      ...(stepMetadata || {}),
      isPlaceholder: stepMetadata?.['isPlaceholder'] ?? false,
      updatedAt: Date.now(),
    };

    const isPlaceholder = mergedMetadata.isPlaceholder;

    // Update step state: if we're replacing a placeholder with real content, transition to RESPONSE_CAPTURED
    if (!isPlaceholder) {
      this.setStepState(sessionId, stepNumber, StepState.RESPONSE_CAPTURED, false);
      this.logger?.debug(
        `[StepLifecycle] Step ${stepNumber} updated with real response, state transitioned to RESPONSE_CAPTURED`
      );
    }

    this.persistStepResult(
      session,
      stepNumber,
      stepResult,
      mergedMetadata,
      mergedMetadata.isPlaceholder
    );

    session.lastActivity = Date.now();
    session.state.lastUpdated = Date.now();

    await this.saveSessions();
    return true;
  }

  /**
   * Mark a step as COMPLETED and advance the step counter
   * This should be called AFTER the step response has been captured and validated
   */
  async completeStep(
    sessionId: string,
    stepNumber: number,
    options?: { preservePlaceholder?: boolean }
  ): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.logger?.warn(
        `[StepLifecycle] Cannot complete step for non-existent session: ${sessionId}`
      );
      return false;
    }

    const existingMetadata = this.getStepState(sessionId, stepNumber);
    const preservePlaceholder = Boolean(options?.preservePlaceholder);
    const isPlaceholder = preservePlaceholder ? Boolean(existingMetadata?.isPlaceholder) : false;

    // Transition to COMPLETED state while respecting placeholder metadata when requested
    this.setStepState(sessionId, stepNumber, StepState.COMPLETED, isPlaceholder);

    // NOTE: Step advancement is now handled by advanceStep() which should be called
    // ONLY after gate validation passes. This prevents the retry-skip bug.
    this.logger?.debug(
      `[StepLifecycle] Step ${stepNumber} marked COMPLETED${isPlaceholder ? ' (placeholder)' : ''}, ` +
        `currentStep remains ${session.state.currentStep} (call advanceStep() to advance)`
    );

    session.state.lastUpdated = Date.now();
    session.lastActivity = Date.now();

    await this.saveSessions();
    return true;
  }

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
  async advanceStep(sessionId: string, stepNumber: number): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.logger?.warn(
        `[StepLifecycle] Cannot advance step for non-existent session: ${sessionId}`
      );
      return false;
    }

    // Only advance if we're at or before this step (prevent double-advancement)
    if (session.state.currentStep > stepNumber) {
      this.logger?.debug(
        `[StepLifecycle] Step ${stepNumber} already passed, currentStep is ${session.state.currentStep}`
      );
      return true;
    }

    session.state.currentStep = stepNumber + 1;
    if (!session.executionOrder.includes(stepNumber)) {
      session.executionOrder.push(stepNumber);
    }

    session.state.lastUpdated = Date.now();
    session.lastActivity = Date.now();

    this.logger?.debug(
      `[StepLifecycle] Advanced from step ${stepNumber} to step ${session.state.currentStep}`
    );

    await this.saveSessions();
    return true;
  }

  /**
   * Persist a step result to storage and optional tracking systems.
   */
  private persistStepResult(
    session: ChainSession,
    stepNumber: number,
    stepResult: string,
    metadata: Record<string, any>,
    isPlaceholder: boolean
  ): void {
    const metadataPayload = {
      ...metadata,
      isPlaceholder,
    };

    this.textReferenceManager.storeChainStepResult(
      session.chainId,
      stepNumber,
      stepResult,
      metadataPayload
    );

    if (this.argumentHistoryTracker && !isPlaceholder) {
      try {
        this.argumentHistoryTracker.trackExecution({
          promptId: session.chainId,
          sessionId: session.sessionId,
          originalArgs: session.originalArgs || {},
          stepNumber,
          stepResult,
          metadata: {
            executionType: 'chain',
            chainId: session.chainId,
            ...metadataPayload,
          },
        });
      } catch (error) {
        this.logger?.error('[ChainSessionManager] Failed to track argument history entry', {
          chainId: session.chainId,
          stepNumber,
          error,
        });
      }
    }
  }

  /**
   * Get chain context for session - this is the critical method for fixing contextData
   */
  getChainContext(sessionId: string): Record<string, any> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.logger.debug(`No session found for ${sessionId}, returning empty context`);
      return {};
    }

    // Get chain variables from text reference manager (single source of truth)
    const chainVariables = this.textReferenceManager.buildChainVariables(session.chainId);

    // Get original arguments + previous results from ArgumentHistoryTracker (with graceful fallback)
    let argumentContext = {};
    let reviewContext:
      | {
          originalArgs: Record<string, unknown>;
          previousResults: Record<number, string>;
          currentStep?: number;
          totalSteps?: number;
        }
      | undefined;
    if (this.argumentHistoryTracker) {
      try {
        reviewContext = this.argumentHistoryTracker.buildReviewContext(
          sessionId,
          session.state.currentStep
        );
        argumentContext = reviewContext.originalArgs;
      } catch (error) {
        // Fallback to session's originalArgs if tracker fails
        this.logger.debug(
          `Failed to get arguments from ArgumentHistoryTracker, using session originalArgs: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        argumentContext = session.originalArgs;
      }
    } else {
      // Fallback to session's originalArgs if tracker not available
      argumentContext = session.originalArgs;
    }

    // Merge with session-specific context
    const contextData: Record<string, any> = {
      // Core session info
      chain_run_id: sessionId,
      chain_id: session.chainId,
      current_step: session.state.currentStep,
      total_steps: session.state.totalSteps,
      execution_order: session.executionOrder,

      // Chain variables (step results, etc.) from TextReferenceManager
      ...chainVariables,

      // Original arguments - NOW INCLUDED!
      ...argumentContext,
    };

    if (reviewContext && Object.keys(reviewContext.previousResults).length > 0) {
      contextData['previous_step_results'] = { ...reviewContext.previousResults };
    }

    const currentStepArgs = this.getCurrentStepArgs(session);
    if (currentStepArgs && Object.keys(currentStepArgs).length > 0) {
      contextData['currentStepArgs'] = currentStepArgs;
      // Expose step arguments as {{input}} for template access
      contextData['input'] = currentStepArgs;
    }

    const chainMetadata = this.buildChainMetadata(session);
    if (chainMetadata) {
      contextData['chain_metadata'] = chainMetadata;
    }

    this.logger.debug(
      `Retrieved context for session ${sessionId}: ${
        Object.keys(contextData).length
      } context variables (including ${Object.keys(argumentContext).length} original arguments)`
    );
    return contextData;
  }

  /**
   * Get original arguments for session
   */
  getOriginalArgs(sessionId: string): Record<string, any> {
    const session = this.activeSessions.get(sessionId);
    return session?.originalArgs || {};
  }

  getSessionBlueprint(sessionId: string): SessionBlueprint | undefined {
    const session = this.activeSessions.get(sessionId);
    if (!session?.blueprint) {
      return undefined;
    }
    return this.cloneBlueprint(session.blueprint);
  }

  updateSessionBlueprint(sessionId: string, blueprint: SessionBlueprint): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      if (this.logger) {
        this.logger.warn(
          `[ChainSessionManager] Attempted to update blueprint for non-existent session: ${sessionId}`
        );
      }
      return;
    }

    session.blueprint = this.cloneBlueprint(blueprint);
    this.saveSessions().catch((error) => {
      if (this.logger) {
        this.logger.error(
          `[ChainSessionManager] Failed to persist blueprint for ${sessionId}`,
          error
        );
      }
    });
  }

  getInlineGateIds(sessionId: string): string[] | undefined {
    const session = this.activeSessions.get(sessionId);
    if (!session?.blueprint?.parsedCommand) {
      return undefined;
    }

    const inlineIds = this.collectInlineGateIds(session.blueprint.parsedCommand);
    return inlineIds.length > 0 ? inlineIds : undefined;
  }

  async setPendingGateReview(sessionId: string, review: PendingGateReview): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      if (this.logger) {
        this.logger.warn(
          `Attempted to set pending gate review for non-existent session: ${sessionId}`
        );
      }
      return;
    }

    session.pendingGateReview = {
      ...review,
      gateIds: [...review.gateIds],
      prompts: review.prompts.map((prompt) => {
        const mappedPrompt: GateReviewPrompt = {
          ...prompt,
        };
        if (prompt.explicitInstructions !== undefined) {
          mappedPrompt.explicitInstructions = [...prompt.explicitInstructions];
        }
        if (prompt.metadata !== undefined) {
          mappedPrompt.metadata = { ...prompt.metadata };
        }
        return mappedPrompt;
      }),
      ...(review.retryHints !== undefined && { retryHints: [...review.retryHints] }),
      ...(review.history !== undefined && {
        history: review.history.map((entry) => ({ ...entry })),
      }),
      ...(review.metadata !== undefined && { metadata: { ...review.metadata } }),
    };

    await this.saveSessions();
  }

  getPendingGateReview(sessionId: string): PendingGateReview | undefined {
    const session = this.activeSessions.get(sessionId);
    if (!session?.pendingGateReview) {
      return undefined;
    }

    const review = session.pendingGateReview;
    return {
      ...review,
      gateIds: [...review.gateIds],
      prompts: review.prompts.map((prompt) => {
        const mappedPrompt: GateReviewPrompt = {
          ...prompt,
        };
        if (prompt.explicitInstructions !== undefined) {
          mappedPrompt.explicitInstructions = [...prompt.explicitInstructions];
        }
        if (prompt.metadata !== undefined) {
          mappedPrompt.metadata = { ...prompt.metadata };
        }
        return mappedPrompt;
      }),
      ...(review.retryHints !== undefined && { retryHints: [...review.retryHints] }),
      ...(review.history !== undefined && {
        history: review.history.map((entry) => ({ ...entry })),
      }),
      ...(review.metadata !== undefined && { metadata: { ...review.metadata } }),
    };
  }

  /**
   * Check if the retry limit has been exceeded for a pending gate review.
   * Returns true if attemptCount >= maxAttempts.
   * @remarks Uses DEFAULT_RETRY_LIMIT (2) when maxAttempts not specified.
   */
  isRetryLimitExceeded(sessionId: string): boolean {
    const review = this.getPendingGateReview(sessionId);
    if (!review) {
      return false;
    }
    // Import would create circular dependency, so we inline the default (2)
    // This matches DEFAULT_RETRY_LIMIT from gates/constants.ts
    const maxAttempts = review.maxAttempts ?? 2;
    return (review.attemptCount ?? 0) >= maxAttempts;
  }

  /**
   * Reset the retry count for a pending gate review.
   * Used when user chooses to retry after retry exhaustion.
   */
  async resetRetryCount(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session?.pendingGateReview) {
      this.logger?.debug?.(
        `[ChainSessionManager] No pending gate review to reset for session: ${sessionId}`
      );
      return;
    }

    // Reset attempt count and log in history
    session.pendingGateReview.attemptCount = 0;
    session.pendingGateReview.history = session.pendingGateReview.history ?? [];
    session.pendingGateReview.history.push({
      timestamp: Date.now(),
      status: 'reset',
      reasoning: 'User requested retry after exhaustion',
    });

    await this.saveSessions();

    this.logger?.info?.(`[ChainSessionManager] Reset retry count for session: ${sessionId}`);
  }

  async clearPendingGateReview(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session?.pendingGateReview) {
      return;
    }

    delete session.pendingGateReview;
    await this.saveSessions();
  }

  async recordGateReviewOutcome(
    sessionId: string,
    outcome: GateReviewOutcomeUpdate
  ): Promise<'cleared' | 'pending'> {
    const session = this.activeSessions.get(sessionId);
    if (!session?.pendingGateReview) {
      this.logger?.warn(
        `[GateReview] Attempted to record verdict for non-existent session: ${sessionId}`
      );
      return 'pending';
    }

    const review = session.pendingGateReview;
    const timestamp = Date.now();

    review.history ??= [];
    const historyEntry: GateReviewHistoryEntry = {
      timestamp,
      status: outcome.verdict.toLowerCase(),
      ...(outcome.rationale !== undefined && { reasoning: outcome.rationale }),
      ...(outcome.reviewer !== undefined && { reviewer: outcome.reviewer }),
    };
    review.history.push(historyEntry);
    review.previousResponse = outcome.rawVerdict;
    review.attemptCount = (review.attemptCount ?? 0) + 1;

    if (outcome.verdict === 'PASS') {
      delete session.pendingGateReview;
      await this.saveSessions();
      this.logger?.info('[GateReview] Cleared pending review', {
        sessionId,
        gateIds: review.gateIds,
      });
      return 'cleared';
    }

    await this.saveSessions();
    this.logger?.info('[GateReview] Review failed, awaiting remediation', {
      sessionId,
      gateIds: review.gateIds,
    });
    return 'pending';
  }

  /**
   * Check if session exists and is active
   */
  hasActiveSession(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  /**
   * Check if chain has any active sessions
   */
  hasActiveSessionForChain(chainId: string): boolean {
    const sessionIds = this.chainSessionMapping.get(chainId);
    if (!sessionIds) {
      return false;
    }

    for (const sessionId of sessionIds) {
      const session = this.activeSessions.get(sessionId);
      if (session && !this.isDormantSession(session)) {
        return true;
      }
    }
    return false;
  }

  getRunHistory(baseChainId: string): string[] {
    const normalized = this.extractBaseChainId(baseChainId);
    const history = this.baseChainMapping.get(normalized);
    if (history && history.length > 0) {
      return [...history];
    }

    if (this.chainSessionMapping.has(normalized)) {
      return [normalized];
    }

    const fallbackRuns = Array.from(this.chainSessionMapping.keys()).filter(
      (chainId) => this.extractBaseChainId(chainId) === normalized
    );

    return fallbackRuns.sort((a, b) => {
      const runA = this.getRunNumber(a) ?? 0;
      const runB = this.getRunNumber(b) ?? 0;
      return runA - runB;
    });
  }

  getLatestSessionForBaseChain(baseChainId: string): ChainSession | undefined {
    const normalized = this.extractBaseChainId(baseChainId);
    const history = this.baseChainMapping.get(normalized);

    if (history && history.length > 0) {
      for (let idx = history.length - 1; idx >= 0; idx -= 1) {
        const runChainId = history[idx];
        if (runChainId === undefined) {
          continue;
        }
        const sessionIds = this.chainSessionMapping.get(runChainId);
        if (!sessionIds) {
          continue;
        }
        for (const sessionId of sessionIds) {
          const session = this.activeSessions.get(sessionId);
          if (session && !this.isDormantSession(session)) {
            return session;
          }
        }
      }
    }

    return this.getActiveSessionForChain(normalized);
  }

  getSessionByChainIdentifier(
    chainId: string,
    options?: ChainSessionLookupOptions
  ): ChainSession | undefined {
    const includeDormant = options?.includeDormant ?? false;
    const runSession = this.getActiveSessionForChain(chainId);
    if (runSession) {
      return runSession;
    }

    if (includeDormant) {
      const dormantRun = this.getDormantSessionForChain(chainId);
      if (dormantRun) {
        this.promoteSessionLifecycle(dormantRun, 'explicit chain resume');
        return dormantRun;
      }
    }

    const normalized = this.extractBaseChainId(chainId);
    const latestActive = this.getLatestSessionForBaseChain(normalized);
    if (latestActive) {
      return latestActive;
    }

    if (includeDormant) {
      const dormant = this.getDormantSessionForBaseChain(normalized);
      if (dormant) {
        this.promoteSessionLifecycle(dormant, 'explicit base chain resume');
        return dormant;
      }
    }

    return undefined;
  }

  listActiveSessions(limit: number = 50): ChainSessionSummary[] {
    const summaries: ChainSessionSummary[] = [];
    for (const session of this.activeSessions.values()) {
      if (this.isDormantSession(session)) {
        continue;
      }
      const promptName = session.blueprint?.parsedCommand?.convertedPrompt?.name;
      const promptId =
        session.blueprint?.parsedCommand?.convertedPrompt?.id ??
        session.blueprint?.parsedCommand?.promptId;
      const summary: ChainSessionSummary = {
        sessionId: session.sessionId,
        chainId: session.chainId,
        currentStep: session.state.currentStep,
        totalSteps: session.state.totalSteps,
        pendingReview: Boolean(session.pendingGateReview),
        lastActivity: session.lastActivity,
        startTime: session.startTime,
        ...(promptName !== undefined && { promptName }),
        ...(promptId !== undefined && { promptId }),
      };
      summaries.push(summary);
    }

    summaries.sort((a, b) => b.lastActivity - a.lastActivity);
    return limit > 0 ? summaries.slice(0, limit) : summaries;
  }

  /**
   * Get active session for chain (returns first active session)
   */
  getActiveSessionForChain(chainId: string): ChainSession | undefined {
    const sessionIds = this.chainSessionMapping.get(chainId);
    if (!sessionIds || sessionIds.size === 0) {
      return undefined;
    }

    // Return the most recently active session
    let mostRecentSession: ChainSession | undefined;
    let mostRecentActivity = 0;

    for (const sessionId of sessionIds) {
      const session = this.activeSessions.get(sessionId);
      if (session && !this.isDormantSession(session) && session.lastActivity > mostRecentActivity) {
        mostRecentSession = session;
        mostRecentActivity = session.lastActivity;
      }
    }

    return mostRecentSession;
  }

  /**
   * Clear session
   */
  async clearSession(sessionId: string): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return false;
    }

    this.removeSessionArtifacts(sessionId);

    // Remove from chain mapping
    const chainSessions = this.chainSessionMapping.get(session.chainId);
    if (chainSessions) {
      chainSessions.delete(sessionId);
      if (chainSessions.size === 0) {
        this.chainSessionMapping.delete(session.chainId);
        this.removeRunFromBaseTracking(session.chainId);
        this.textReferenceManager.clearChainStepResults(session.chainId);
      }
    }

    // Persist to file
    await this.saveSessions();

    if (this.logger) {
      this.logger.debug(`Cleared session ${sessionId} for chain ${session.chainId}`);
    }
    return true;
  }

  /**
   * Clear all sessions for a chain
   */
  async clearSessionsForChain(chainId: string): Promise<void> {
    const baseChainId = this.extractBaseChainId(chainId);
    const runChainIds = chainId === baseChainId ? [...this.getRunHistory(baseChainId)] : [chainId];

    if (runChainIds.length === 0 && this.chainSessionMapping.has(chainId)) {
      runChainIds.push(chainId);
    }

    for (const runChainId of runChainIds) {
      this.removeRunChainSessions(runChainId);
      this.textReferenceManager.clearChainStepResults(runChainId);
      this.removeRunFromBaseTracking(runChainId);
    }

    // Persist to file
    await this.saveSessions();

    if (this.logger) {
      this.logger.debug(`Cleared all sessions for chain ${chainId}`);
    }
  }

  /**
   * Cleanup stale sessions (older than 24 hours)
   */
  async cleanupStaleSessions(): Promise<number> {
    const now = Date.now();
    const reviewThreshold = now - this.reviewSessionTimeoutMs;
    const defaultThreshold = now - this.defaultSessionTimeoutMs;
    let cleaned = 0;

    const staleSessionIds: string[] = [];
    for (const [sessionId, session] of this.activeSessions) {
      const isReviewSession = session.chainId.startsWith('prompt-review-');
      const threshold = isReviewSession ? reviewThreshold : defaultThreshold;
      if (session.lastActivity < threshold) {
        staleSessionIds.push(sessionId);
      }
    }

    for (const sessionId of staleSessionIds) {
      const session = this.activeSessions.get(sessionId);
      await this.clearSession(sessionId);
      cleaned++;
      if (session?.chainId?.startsWith('prompt-review-')) {
        this.logger?.info('[GateReview] Cleaned abandoned prompt review session', {
          sessionId,
          chainId: session.chainId,
          lastActivity: session?.lastActivity,
        });
      }
    }

    if (cleaned > 0) {
      this.logger?.info(
        `Cleaned up ${cleaned} stale chain sessions (default timeout ${this.defaultSessionTimeoutMs}ms, review timeout ${this.reviewSessionTimeoutMs}ms)`
      );
    }

    return cleaned;
  }

  private registerRunHistory(chainId: string): string {
    const baseChainId = this.extractBaseChainId(chainId);
    const history = this.baseChainMapping.get(baseChainId) ?? [];

    const existingIndex = history.indexOf(chainId);
    if (existingIndex >= 0) {
      history.splice(existingIndex, 1);
    }

    history.push(chainId);
    this.baseChainMapping.set(baseChainId, history);
    this.runChainToBase.set(chainId, baseChainId);
    return baseChainId;
  }

  private pruneExcessRuns(baseChainId: string): void {
    const history = this.baseChainMapping.get(baseChainId);
    if (!history) {
      return;
    }

    while (history.length > MAX_RUN_HISTORY) {
      const removedChainId = history.shift();
      if (!removedChainId) {
        break;
      }

      const removedSessions = this.removeRunChainSessions(removedChainId);
      this.textReferenceManager.clearChainStepResults(removedChainId);
      this.removeRunFromBaseTracking(removedChainId);

      this.logger?.info(
        `Pruned oldest run ${removedChainId} for base ${baseChainId} (keeping ${MAX_RUN_HISTORY} runs)`,
        { removedSessions }
      );
    }

    if (history.length === 0) {
      this.baseChainMapping.delete(baseChainId);
    }
  }

  private removeRunChainSessions(chainId: string): string[] {
    const sessionIds = this.chainSessionMapping.get(chainId);
    const removedSessions: string[] = [];

    if (sessionIds) {
      for (const sessionId of sessionIds) {
        this.removeSessionArtifacts(sessionId);
        removedSessions.push(sessionId);
      }
      this.chainSessionMapping.delete(chainId);
    }

    return removedSessions;
  }

  private removeSessionArtifacts(sessionId: string): void {
    if (this.argumentHistoryTracker) {
      try {
        this.argumentHistoryTracker.clearSession(sessionId);
        this.logger.debug(`Cleared argument history for session ${sessionId}`);
      } catch (error) {
        this.logger.warn(
          `Failed to clear argument history for session ${sessionId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    this.activeSessions.delete(sessionId);
  }

  private removeRunFromBaseTracking(chainId: string): void {
    const baseChainId = this.runChainToBase.get(chainId) ?? this.extractBaseChainId(chainId);
    const history = this.baseChainMapping.get(baseChainId);
    if (history) {
      const filtered = history.filter((entry) => entry !== chainId);
      if (filtered.length > 0) {
        this.baseChainMapping.set(baseChainId, filtered);
      } else {
        this.baseChainMapping.delete(baseChainId);
      }
    }

    this.runChainToBase.delete(chainId);
  }

  private extractBaseChainId(chainId: string): string {
    return chainId.replace(/#\d+$/, '');
  }

  private getRunNumber(chainId: string): number | undefined {
    const match = chainId.match(/#(\d+)$/);
    if (!match) {
      return undefined;
    }
    const matchGroup = match[1];
    if (matchGroup === undefined) {
      return undefined;
    }
    return Number.parseInt(matchGroup, 10);
  }

  private ensureRunMappingConsistency(): void {
    for (const chainId of this.chainSessionMapping.keys()) {
      const baseChainId = this.extractBaseChainId(chainId);
      if (!this.baseChainMapping.has(baseChainId)) {
        this.baseChainMapping.set(baseChainId, []);
      }
      const history = this.baseChainMapping.get(baseChainId)!;
      if (!history.includes(chainId)) {
        history.push(chainId);
        history.sort((a, b) => {
          const runA = this.getRunNumber(a) ?? 0;
          const runB = this.getRunNumber(b) ?? 0;
          return runA - runB;
        });
      }

      if (!this.runChainToBase.has(chainId)) {
        this.runChainToBase.set(chainId, baseChainId);
      }
    }

    for (const [runChainId, baseChainId] of Array.from(this.runChainToBase.entries())) {
      if (!this.chainSessionMapping.has(runChainId)) {
        this.runChainToBase.delete(runChainId);
        const history = this.baseChainMapping.get(baseChainId);
        if (history) {
          const filtered = history.filter((entry) => entry !== runChainId);
          if (filtered.length > 0) {
            this.baseChainMapping.set(baseChainId, filtered);
          } else {
            this.baseChainMapping.delete(baseChainId);
          }
        }
      }
    }
  }

  /**
   * Get session statistics
   */
  getSessionStats(): {
    totalSessions: number;
    totalChains: number;
    averageStepsPerChain: number;
    oldestSessionAge: number;
  } {
    const totalSessions = this.activeSessions.size;
    const totalChains = this.chainSessionMapping.size;

    let totalSteps = 0;
    let oldestSessionTime = Date.now();

    for (const session of this.activeSessions.values()) {
      totalSteps += session.state.currentStep;
      if (session.startTime < oldestSessionTime) {
        oldestSessionTime = session.startTime;
      }
    }

    return {
      totalSessions,
      totalChains,
      averageStepsPerChain: totalChains > 0 ? totalSteps / totalChains : 0,
      oldestSessionAge: Date.now() - oldestSessionTime,
    };
  }

  /**
   * Validate session integrity
   */
  validateSession(sessionId: string): { valid: boolean; issues: string[] } {
    const session = this.activeSessions.get(sessionId);
    const issues: string[] = [];

    if (!session) {
      issues.push('Session not found');
      return { valid: false, issues };
    }

    // Check for stale session
    const hoursSinceActivity = (Date.now() - session.lastActivity) / 3600000;
    if (hoursSinceActivity > 1) {
      issues.push(`Session stale: ${hoursSinceActivity.toFixed(1)} hours since last activity`);
    }

    return { valid: issues.length === 0, issues };
  }

  /**
   * Cleanup the chain session manager and persist state
   * Prevents async handle leaks by finalizing all file operations
   */
  async cleanup(): Promise<void> {
    this.logger.info('Shutting down ChainSessionManager...');

    try {
      if (this.cleanupIntervalHandle !== undefined) {
        clearInterval(this.cleanupIntervalHandle);
        // Use Object.assign to safely clear the optional property
        Object.assign(this, { cleanupIntervalHandle: undefined });
        this.logger.debug('Chain session cleanup scheduler cleared');
      }

      // Perform final state save to persist any pending session data
      await this.saveSessions();
      this.logger.debug('Chain sessions persisted during cleanup');
    } catch (error) {
      this.logger.warn('Error persisting sessions during cleanup:', error);
    }

    // Clear in-memory state
    this.activeSessions.clear();
    this.chainSessionMapping.clear();
    this.baseChainMapping.clear();
    this.runChainToBase.clear();
    this.logger.debug('In-memory session state cleared');

    this.logger.info('ChainSessionManager cleanup complete');
  }

  private isDormantSession(session?: ChainSession | null): boolean {
    return session?.lifecycle === 'dormant';
  }

  private promoteSessionLifecycle(session: ChainSession, reason: string): void {
    if (session.lifecycle === 'canonical') {
      return;
    }
    session.lifecycle = 'canonical';
    this.logger?.debug?.(
      `[ChainSessionManager] Promoted session ${session.sessionId} to canonical (${reason})`
    );
    this.persistSessionsAsync('lifecycle-promotion');
  }

  private getDormantSessionForChain(chainId: string): ChainSession | undefined {
    const sessionIds = this.chainSessionMapping.get(chainId);
    if (!sessionIds) {
      return undefined;
    }

    for (const sessionId of sessionIds) {
      const session = this.activeSessions.get(sessionId);
      if (session && this.isDormantSession(session)) {
        return session;
      }
    }
    return undefined;
  }

  private getDormantSessionForBaseChain(baseChainId: string): ChainSession | undefined {
    const normalized = this.extractBaseChainId(baseChainId);
    const history = this.baseChainMapping.get(normalized) ?? [];
    for (let idx = history.length - 1; idx >= 0; idx -= 1) {
      const runChainId = history[idx];
      if (runChainId === undefined) {
        continue;
      }
      const dormantSession = this.getDormantSessionForChain(runChainId);
      if (dormantSession) {
        return dormantSession;
      }
    }

    return this.getDormantSessionForChain(normalized);
  }

  private buildChainMetadata(session: ChainSession): Record<string, any> | undefined {
    const blueprint = session.blueprint;
    const baseMetadata: Record<string, any> = {
      chainId: session.chainId,
      chainRunId: session.sessionId,
      totalSteps: session.state.totalSteps,
      currentStep: session.state.currentStep,
    };

    if (!blueprint) {
      return baseMetadata;
    }

    const parsed = blueprint.parsedCommand;
    const convertedPrompt = parsed?.convertedPrompt;
    const plan = blueprint.executionPlan;

    const metadata: Record<string, any> = {
      ...baseMetadata,
      promptId: convertedPrompt?.id ?? parsed?.promptId ?? session.chainId,
      name: convertedPrompt?.name ?? parsed?.promptId ?? session.chainId,
      description: convertedPrompt?.description,
      category: convertedPrompt?.category,
      gates: plan?.gates ?? [],
      strategy: plan?.strategy,
      inlineGateIds: this.collectInlineGateIds(parsed),
    };

    return metadata;
  }

  private collectInlineGateIds(parsedCommand?: ParsedCommand): string[] {
    if (!parsedCommand) {
      return [];
    }

    const ids = new Set<string>();

    const recordIds = (values?: string[]) => {
      if (!Array.isArray(values)) {
        return;
      }
      for (const id of values) {
        if (typeof id === 'string' && id.trim().length > 0) {
          ids.add(id);
        }
      }
    };

    recordIds(parsedCommand.inlineGateIds);

    if (Array.isArray(parsedCommand.steps)) {
      for (const step of parsedCommand.steps) {
        recordIds(step.inlineGateIds);
      }
    }

    return Array.from(ids);
  }

  private getCurrentStepArgs(session: ChainSession): Record<string, unknown> | undefined {
    const blueprintSteps = session.blueprint?.parsedCommand?.steps;
    if (!Array.isArray(blueprintSteps) || blueprintSteps.length === 0) {
      return undefined;
    }

    const currentStep =
      typeof session.state.currentStep === 'number' ? session.state.currentStep : 1;
    const maxIndex = blueprintSteps.length - 1;
    const resolvedIndex = Math.min(Math.max(currentStep - 1, 0), maxIndex);
    const args = blueprintSteps[resolvedIndex]?.args;
    if (!args || Object.keys(args).length === 0) {
      return undefined;
    }
    return { ...args };
  }

  private cloneBlueprint(blueprint: SessionBlueprint): SessionBlueprint {
    return JSON.parse(JSON.stringify(blueprint)) as SessionBlueprint;
  }
}

export type {
  ChainSession,
  ChainSessionService,
  ChainSessionSummary,
  SessionBlueprint,
} from './types.js';

/**
 * Create and configure a chain session manager
 */
export function createChainSessionManager(
  logger: Logger,
  textReferenceManager: TextReferenceManager,
  serverRoot: string,
  options?: Omit<ChainSessionManagerOptions, 'serverRoot'>,
  argumentHistoryTracker?: ArgumentHistoryTracker
): ChainSessionManager {
  const manager = new ChainSessionManager(
    logger,
    textReferenceManager,
    {
      serverRoot,
      ...options,
    },
    argumentHistoryTracker
  );
  return manager;
}

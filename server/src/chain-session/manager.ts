/**
 * Chain Session Manager
 *
 * Manages chain execution sessions, providing the bridge between MCP session IDs
 * and the chain state management in ConversationManager. This enables stateful
 * chain execution across multiple MCP tool calls.
 *
 * CRITICAL: Uses file-based persistence to survive STDIO transport's ephemeral processes.
 * Sessions are saved to disk after every change and loaded on initialization.
 */

import { promises as fs } from "fs";
import * as path from "path";
import { Logger } from "../logging/index.js";
import { ChainState } from "../mcp-tools/prompt-engine/core/types.js";
import { ConversationManager } from "../text-references/conversation.js";
import { TextReferenceManager } from "../text-references/index.js";

/**
 * Session information for chain execution
 */
export interface ChainSession {
  sessionId: string;
  chainId: string;
  state: ChainState;
  currentStepId?: string;
  executionOrder: number[];
  startTime: number;
  lastActivity: number;
  originalArgs: Record<string, any>;
}

/**
 * Chain Session Manager class
 *
 * Coordinates session state between MCP protocol and conversation manager.
 * Provides session-aware context retrieval for chain execution.
 */
export class ChainSessionManager {
  private logger: Logger;
  private conversationManager: ConversationManager;
  private textReferenceManager: TextReferenceManager;
  private activeSessions: Map<string, ChainSession> = new Map();
  private chainSessionMapping: Map<string, Set<string>> = new Map(); // chainId -> sessionIds
  private sessionsFilePath: string;

  constructor(
    logger: Logger,
    conversationManager: ConversationManager,
    textReferenceManager: TextReferenceManager
  ) {
    this.logger = logger;
    this.conversationManager = conversationManager;
    this.textReferenceManager = textReferenceManager;

    // Set up file-based persistence path
    const runtimeStateDir = path.join(process.cwd(), "runtime-state");
    this.sessionsFilePath = path.join(runtimeStateDir, "chain-sessions.json");

    // Integrate with conversation manager (with enhanced null checking for testing)
    try {
      if (
        conversationManager !== null &&
        conversationManager !== undefined &&
        conversationManager.setChainSessionManager &&
        typeof conversationManager.setChainSessionManager === "function"
      ) {
        conversationManager.setChainSessionManager(this);
      } else {
        if (this.logger) {
          this.logger.debug(
            "ConversationManager is null or missing setChainSessionManager method - running in test mode"
          );
        }
      }
    } catch (error) {
      // Handle any errors during integration (e.g., null references during testing)
      if (this.logger) {
        this.logger.debug(
          `Failed to integrate with conversation manager: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    if (this.logger) {
      this.logger.debug(
        "ChainSessionManager initialized with conversation and text reference manager integration"
      );
    }

    // Initialize asynchronously
    this.initialize();
  }

  /**
   * Initialize the manager asynchronously
   */
  private async initialize(): Promise<void> {
    try {
      // Ensure runtime-state directory exists
      const runtimeStateDir = path.join(process.cwd(), "runtime-state");
      await fs.mkdir(runtimeStateDir, { recursive: true });

      // Load persisted sessions from file
      await this.loadSessions();
    } catch (error) {
      if (this.logger) {
        this.logger.warn(
          `Failed to initialize ChainSessionManager: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  /**
   * Load sessions from file (for STDIO transport persistence)
   */
  private async loadSessions(): Promise<void> {
    try {
      try {
        await fs.access(this.sessionsFilePath);
      } catch {
        // File doesn't exist, which is fine
        if (this.logger) {
          this.logger.debug(
            `No persisted sessions file found at ${this.sessionsFilePath}`
          );
        }
        return;
      }

      const data = await fs.readFile(this.sessionsFilePath, "utf-8");
      const parsed = JSON.parse(data);

      // Restore activeSessions Map
      if (parsed.sessions) {
        for (const [sessionId, session] of Object.entries(parsed.sessions)) {
          this.activeSessions.set(sessionId, session as ChainSession);
        }
      }

      // Restore chainSessionMapping Map
      if (parsed.chainMapping) {
        for (const [chainId, sessionIds] of Object.entries(
          parsed.chainMapping
        )) {
          this.chainSessionMapping.set(
            chainId,
            new Set(sessionIds as string[])
          );
        }
      }

      if (this.logger) {
        this.logger.debug(
          `Loaded ${this.activeSessions.size} persisted sessions from ${this.sessionsFilePath}`
        );
      }
    } catch (error) {
      if (this.logger) {
        this.logger.warn(
          `Failed to load persisted sessions: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  /**
   * Save sessions to file (for STDIO transport persistence)
   */
  private async saveSessions(): Promise<void> {
    try {
      const data = {
        sessions: Object.fromEntries(this.activeSessions),
        chainMapping: Object.fromEntries(
          Array.from(this.chainSessionMapping.entries()).map(
            ([chainId, sessionIds]) => [chainId, Array.from(sessionIds)]
          )
        ),
      };

      await fs.writeFile(
        this.sessionsFilePath,
        JSON.stringify(data, null, 2),
        "utf-8"
      );
      if (this.logger) {
        this.logger.debug(
          `Saved ${this.activeSessions.size} sessions to ${this.sessionsFilePath}`
        );
      }
    } catch (error) {
      if (this.logger) {
        this.logger.error(
          `Failed to save sessions: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  /**
   * Create a new chain session
   */
  async createSession(
    sessionId: string,
    chainId: string,
    totalSteps: number,
    originalArgs: Record<string, any> = {}
  ): Promise<ChainSession> {
    const session: ChainSession = {
      sessionId,
      chainId,
      state: {
        currentStep: 0,
        totalSteps,
        lastUpdated: Date.now(),
      },
      executionOrder: [],
      startTime: Date.now(),
      lastActivity: Date.now(),
      originalArgs,
    };

    this.activeSessions.set(sessionId, session);

    // Track chain to session mapping
    if (!this.chainSessionMapping.has(chainId)) {
      this.chainSessionMapping.set(chainId, new Set());
    }
    this.chainSessionMapping.get(chainId)!.add(sessionId);

    // Sync with conversation manager
    this.conversationManager.setChainState(chainId, 0, totalSteps);

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
      session.lastActivity = Date.now();
    }
    return session;
  }

  /**
   * Update session state after step completion
   */
  async updateSessionState(
    sessionId: string,
    stepNumber: number,
    stepResult: string,
    stepMetadata?: any
  ): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      if (this.logger) {
        this.logger.warn(
          `Attempted to update non-existent session: ${sessionId}`
        );
      }
      return false;
    }

    // Update session state
    session.state.currentStep = stepNumber + 1; // Move to next step
    session.state.lastUpdated = Date.now();
    session.lastActivity = Date.now();
    session.executionOrder.push(stepNumber);

    // Store result in text reference manager (single source of truth)
    this.textReferenceManager.storeChainStepResult(
      session.chainId,
      stepNumber,
      stepResult,
      stepMetadata
    );

    // Update conversation manager state for coordination
    this.conversationManager.setChainState(
      session.chainId,
      session.state.currentStep,
      session.state.totalSteps
    );

    // Persist to file
    await this.saveSessions();

    if (this.logger) {
      this.logger.debug(
        `Updated session ${sessionId}: step ${stepNumber} completed, moved to step ${session.state.currentStep}`
      );
    }
    return true;
  }

  /**
   * Get chain context for session - this is the critical method for fixing contextData
   */
  getChainContext(sessionId: string): Record<string, any> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.logger.debug(
        `No session found for ${sessionId}, returning empty context`
      );
      return {};
    }

    // Get chain variables from text reference manager (single source of truth)
    const chainVariables = this.textReferenceManager.buildChainVariables(
      session.chainId
    );

    // Merge with session-specific context
    const contextData: Record<string, any> = {
      // Core session info
      session_id: sessionId,
      current_step: session.state.currentStep,
      total_steps: session.state.totalSteps,
      execution_order: session.executionOrder,

      // Chain variables (step results, etc.) from TextReferenceManager
      ...chainVariables,
    };

    this.logger.debug(
      `Retrieved context for session ${sessionId}: ${
        Object.keys(contextData).length
      } context variables`
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
    return sessionIds ? sessionIds.size > 0 : false;
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
      if (session && session.lastActivity > mostRecentActivity) {
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

    // Remove from chain mapping
    const chainSessions = this.chainSessionMapping.get(session.chainId);
    if (chainSessions) {
      chainSessions.delete(sessionId);
      if (chainSessions.size === 0) {
        this.chainSessionMapping.delete(session.chainId);
      }
    }

    // Remove session
    this.activeSessions.delete(sessionId);

    // Persist to file
    await this.saveSessions();

    if (this.logger) {
      this.logger.debug(
        `Cleared session ${sessionId} for chain ${session.chainId}`
      );
    }
    return true;
  }

  /**
   * Clear all sessions for a chain
   */
  async clearSessionsForChain(chainId: string): Promise<void> {
    const sessionIds = this.chainSessionMapping.get(chainId);
    if (!sessionIds) {
      return;
    }

    // Clear all sessions
    sessionIds.forEach((sessionId) => {
      this.activeSessions.delete(sessionId);
    });

    // Clear mapping
    this.chainSessionMapping.delete(chainId);

    // Clear step results from text reference manager
    this.textReferenceManager.clearChainStepResults(chainId);

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
    const twentyFourHoursAgo = Date.now() - 86400000; // 24 hours in milliseconds
    let cleaned = 0;

    // Collect stale session IDs first to avoid modifying Map during iteration
    const staleSessionIds: string[] = [];
    for (const [sessionId, session] of this.activeSessions) {
      if (session.lastActivity < twentyFourHoursAgo) {
        staleSessionIds.push(sessionId);
      }
    }

    // Clear stale sessions
    for (const sessionId of staleSessionIds) {
      await this.clearSession(sessionId);
      cleaned++;
    }

    if (cleaned > 0 && this.logger) {
      this.logger.info(
        `Cleaned up ${cleaned} stale chain sessions (>24 hours old)`
      );
    }

    return cleaned;
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
      issues.push("Session not found");
      return { valid: false, issues };
    }

    // Check if conversation manager has corresponding state
    const conversationState = this.conversationManager.getChainState(
      session.chainId
    );
    if (!conversationState) {
      issues.push("No corresponding conversation state found");
    } else {
      // Check state consistency
      if (conversationState.currentStep !== session.state.currentStep) {
        issues.push(
          `State mismatch: session=${session.state.currentStep}, conversation=${conversationState.currentStep}`
        );
      }
      if (conversationState.totalSteps !== session.state.totalSteps) {
        issues.push(
          `Step count mismatch: session=${session.state.totalSteps}, conversation=${conversationState.totalSteps}`
        );
      }
    }

    // Check for stale session
    const hoursSinceActivity = (Date.now() - session.lastActivity) / 3600000;
    if (hoursSinceActivity > 1) {
      issues.push(
        `Session stale: ${hoursSinceActivity.toFixed(
          1
        )} hours since last activity`
      );
    }

    return { valid: issues.length === 0, issues };
  }
}

/**
 * Create and configure a chain session manager
 */
export function createChainSessionManager(
  logger: Logger,
  conversationManager: ConversationManager,
  textReferenceManager: TextReferenceManager
): ChainSessionManager {
  const manager = new ChainSessionManager(
    logger,
    conversationManager,
    textReferenceManager
  );
  return manager;
}

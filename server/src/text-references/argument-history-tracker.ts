// @lifecycle canonical - Tracks argument history references.
/**
 * Argument History Tracker
 *
 * Tracks execution arguments and context independent of conversation history.
 * Provides execution context for gate reviews and chain execution.
 *
 * Key Features:
 * - Stores original arguments and step results per chain
 * - -entry limit per chain (FIFO cleanup)
 * - File persistence to runtime-state/argument-history.json
 * - Lightweight tracking (<ms overhead)
 * - Independent of semantic layer and conversation history
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { ArgumentHistoryEntry, ReviewContext, PersistedArgumentHistory } from './types.js';
import { Logger } from '../logging/index.js';
import { atomicWriteFileSync } from '../utils/atomic-file-write.js';

/**
 * ArgumentHistoryTracker Class
 *
 * Tracks execution arguments and step results for gate reviews and chain execution.
 * Operates independently of conversation history to ensure reliable execution context.
 */
export class ArgumentHistoryTracker {
  /** Chain ID to entries mapping */
  private chainHistory: Map<string, ArgumentHistoryEntry[]> = new Map();

  /** Session ID to chain ID mapping */
  private sessionToChain: Map<string, string> = new Map();

  /** Maximum entries per chain (FIFO cleanup) */
  private readonly maxEntriesPerChain: number;

  /** File path for persistence */
  private readonly persistencePath: string;

  /** Persistence enabled flag */
  private readonly persistenceEnabled: boolean;

  /**
   * Create an ArgumentHistoryTracker instance
   *
   * @param logger - Logger instance
   * @param maxEntriesPerChain - Maximum entries per chain (default: 50)
   * @param persistencePath - Path to persistence file (optional)
   */
  constructor(
    private logger: Logger,
    maxEntriesPerChain: number = 50,
    persistencePath?: string
  ) {
    this.maxEntriesPerChain = maxEntriesPerChain;
    this.persistencePath =
      persistencePath || path.join(process.cwd(), 'runtime-state', 'argument-history.json');
    this.persistenceEnabled = true;

    // Load persisted history if available
    if (this.persistenceEnabled) {
      this.loadFromFile();
    }

    this.logger.debug(
      `ArgumentHistoryTracker initialized (maxEntriesPerChain: ${this.maxEntriesPerChain}, persistence: ${this.persistenceEnabled})`
    );
  }

  /**
   * Track arguments for an execution
   *
   * Records original arguments and optional step results for later retrieval.
   * Automatically enforces max entries limit per chain (FIFO).
   *
   * @param options - Tracking options
   * @returns Unique entry ID
   */
  trackExecution(options: {
    promptId: string;
    sessionId?: string;
    originalArgs: Record<string, any>;
    stepNumber?: number;
    stepResult?: string;
    metadata?: Record<string, any>;
  }): string {
    const { promptId, sessionId, originalArgs, stepNumber, stepResult, metadata } = options;

    // Generate unique entry ID
    const entryId = `entry_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    // Determine chain ID (use sessionId if provided, otherwise promptId)
    const chainId = sessionId || promptId;

    // Create entry
    const entry: ArgumentHistoryEntry = {
      entryId,
      timestamp: Date.now(),
      promptId,
      originalArgs: { ...originalArgs }, // Defensive copy
    };

    if (sessionId !== undefined) {
      entry.sessionId = sessionId;
    }
    if (stepNumber !== undefined) {
      entry.stepNumber = stepNumber;
    }
    if (stepResult !== undefined) {
      entry.stepResult = stepResult;
    }
    if (metadata) {
      entry.metadata = { ...metadata };
    }

    // Get or create chain history
    if (!this.chainHistory.has(chainId)) {
      this.chainHistory.set(chainId, []);
    }

    const chainEntries = this.chainHistory.get(chainId)!;
    chainEntries.push(entry);

    // Enforce max entries limit (FIFO)
    if (chainEntries.length > this.maxEntriesPerChain) {
      const removed = chainEntries.shift();
      this.logger.debug(
        `Removed oldest entry ${removed?.entryId} from chain ${chainId} (limit: ${this.maxEntriesPerChain})`
      );
    }

    // Update session-to-chain mapping
    if (sessionId) {
      this.sessionToChain.set(sessionId, chainId);
    }

    this.logger.debug(
      `Tracked execution: chainId=${chainId}, promptId=${promptId}, step=${stepNumber}, entryId=${entryId}`
    );

    // Persist to file
    if (this.persistenceEnabled) {
      this.saveToFile();
    }

    return entryId;
  }

  /**
   * Get argument history for a specific chain
   *
   * @param chainId - Chain identifier (typically session ID)
   * @returns Array of argument history entries
   */
  getChainHistory(chainId: string): ArgumentHistoryEntry[] {
    const entries = this.chainHistory.get(chainId) || [];
    // Return defensive copy
    return entries.map((entry) => ({ ...entry }));
  }

  /**
   * Get argument history for a session
   *
   * Resolves session ID to chain ID and retrieves entries.
   *
   * @param sessionId - Session identifier
   * @returns Array of argument history entries
   */
  getSessionHistory(sessionId: string): ArgumentHistoryEntry[] {
    const chainId = this.sessionToChain.get(sessionId) || sessionId;
    return this.getChainHistory(chainId);
  }

  /**
   * Get latest arguments for a session
   *
   * Returns the most recent original arguments recorded for the session.
   * Useful for retrieving user-provided context.
   *
   * @param sessionId - Session identifier
   * @returns Latest original arguments or null if not found
   */
  getLatestArguments(sessionId: string): Record<string, any> | null {
    const history = this.getSessionHistory(sessionId);
    if (history.length === 0) {
      return null;
    }

    // Return the most recent entry's arguments
    const latestEntry = history[history.length - 1];
    if (!latestEntry) {
      return null;
    }
    return { ...latestEntry.originalArgs }; // Defensive copy
  }

  /**
   * Build execution context for gate review
   *
   * Constructs a ReviewContext containing original arguments and previous step results.
   * This provides complete execution context for gate reviews independent of conversation history.
   *
   * @param sessionId - Session identifier
   * @param currentStepNumber - Current step number (optional)
   * @returns ReviewContext with original args and previous results
   */
  buildReviewContext(sessionId: string, currentStepNumber?: number): ReviewContext {
    const history = this.getSessionHistory(sessionId);

    if (history.length === 0) {
      const reviewContext: ReviewContext = {
        originalArgs: {},
        previousResults: {},
      };
      if (currentStepNumber !== undefined) {
        reviewContext.currentStep = currentStepNumber;
      }
      return reviewContext;
    }

    // Extract original arguments from latest entry
    const latestEntry = history[history.length - 1];
    if (!latestEntry) {
      const reviewContext: ReviewContext = {
        originalArgs: {},
        previousResults: {},
      };
      if (currentStepNumber !== undefined) {
        reviewContext.currentStep = currentStepNumber;
      }
      return reviewContext;
    }
    const originalArgs = { ...latestEntry.originalArgs };

    // Build previous results map from step results
    const previousResults: Record<number, string> = {};
    let maxStepNumber = -1;

    history.forEach((entry) => {
      if (entry.stepNumber !== undefined && entry.stepResult) {
        previousResults[entry.stepNumber] = entry.stepResult;
        maxStepNumber = Math.max(maxStepNumber, entry.stepNumber);
      }
    });

    // Determine total steps (max step number + 1, assuming 1-indexed)
    const totalSteps = maxStepNumber >= 0 ? maxStepNumber + 1 : undefined;

    const reviewContext: ReviewContext = {
      originalArgs,
      previousResults,
    };
    if (currentStepNumber !== undefined) {
      reviewContext.currentStep = currentStepNumber;
    }
    if (totalSteps !== undefined) {
      reviewContext.totalSteps = totalSteps;
    }

    return reviewContext;
  }

  /**
   * Clear history for a specific session
   *
   * Removes all entries associated with the session.
   *
   * @param sessionId - Session identifier
   */
  clearSession(sessionId: string): void {
    const chainId = this.sessionToChain.get(sessionId);

    if (chainId) {
      this.chainHistory.delete(chainId);
      this.sessionToChain.delete(sessionId);
      this.logger.debug(`Cleared argument history for session ${sessionId} (chain ${chainId})`);

      if (this.persistenceEnabled) {
        this.saveToFile();
      }
    }
  }

  /**
   * Clear history for a specific chain
   *
   * Removes all entries associated with the chain.
   *
   * @param chainId - Chain identifier
   */
  clearChain(chainId: string): void {
    this.chainHistory.delete(chainId);

    // Remove session mappings pointing to this chain
    const sessionsToRemove: string[] = [];
    this.sessionToChain.forEach((cId, sId) => {
      if (cId === chainId) {
        sessionsToRemove.push(sId);
      }
    });
    sessionsToRemove.forEach((sId) => this.sessionToChain.delete(sId));

    this.logger.debug(`Cleared argument history for chain ${chainId}`);

    if (this.persistenceEnabled) {
      this.saveToFile();
    }
  }

  /**
   * Clear all history
   *
   * Removes all tracked entries and mappings.
   */
  clearAll(): void {
    this.chainHistory.clear();
    this.sessionToChain.clear();
    this.logger.info('Cleared all argument history');

    if (this.persistenceEnabled) {
      this.saveToFile();
    }
  }

  /**
   * Get statistics about tracked history
   *
   * @returns Statistics object
   */
  getStats(): {
    totalChains: number;
    totalEntries: number;
    totalSessions: number;
    averageEntriesPerChain: number;
  } {
    let totalEntries = 0;
    this.chainHistory.forEach((entries) => {
      totalEntries += entries.length;
    });

    const totalChains = this.chainHistory.size;
    const totalSessions = this.sessionToChain.size;
    const averageEntriesPerChain = totalChains > 0 ? totalEntries / totalChains : 0;

    return {
      totalChains,
      totalEntries,
      totalSessions,
      averageEntriesPerChain,
    };
  }

  /**
   * Check if a session has any tracked history
   *
   * @param sessionId - Session identifier
   * @returns True if history exists
   */
  hasSessionHistory(sessionId: string): boolean {
    const history = this.getSessionHistory(sessionId);
    return history.length > 0;
  }

  /**
   * Save argument history to file
   *
   * Persists current state to runtime-state/argument-history.json
   */
  private saveToFile(): void {
    try {
      // Convert Map to plain object for JSON serialization
      const chains: Record<string, ArgumentHistoryEntry[]> = {};
      this.chainHistory.forEach((entries, chainId) => {
        chains[chainId] = entries;
      });

      const sessionToChain: Record<string, string> = {};
      this.sessionToChain.forEach((chainId, sessionId) => {
        sessionToChain[sessionId] = chainId;
      });

      const persistedData: PersistedArgumentHistory = {
        version: '1.0.0',
        lastUpdated: Date.now(),
        chains,
        sessionToChain,
      };

      // Use atomic write to prevent data corruption from concurrent processes
      // Note: atomicWriteFileSync ensures directory exists as part of the atomic operation
      atomicWriteFileSync(this.persistencePath, JSON.stringify(persistedData, null, 2));

      this.logger.debug(`Saved argument history to ${this.persistencePath}`);
    } catch (error) {
      this.logger.error('Failed to save argument history to file:', error);
    }
  }

  /**
   * Load argument history from file
   *
   * Loads persisted state from runtime-state/argument-history.json
   */
  private loadFromFile(): void {
    try {
      if (!fs.existsSync(this.persistencePath)) {
        this.logger.debug(`No persisted argument history found at ${this.persistencePath}`);
        return;
      }

      const fileContent = fs.readFileSync(this.persistencePath, 'utf8');
      const persistedData: PersistedArgumentHistory = JSON.parse(fileContent);

      // Restore chain history
      this.chainHistory.clear();
      Object.entries(persistedData.chains).forEach(([chainId, entries]) => {
        this.chainHistory.set(chainId, entries);
      });

      // Restore session-to-chain mapping
      this.sessionToChain.clear();
      Object.entries(persistedData.sessionToChain).forEach(([sessionId, chainId]) => {
        this.sessionToChain.set(sessionId, chainId);
      });

      const stats = this.getStats();
      this.logger.info(
        `Loaded argument history from file: ${stats.totalChains} chains, ${stats.totalEntries} entries`
      );
    } catch (error) {
      this.logger.error('Failed to load argument history from file:', error);
    }
  }

  /**
   * Stop tracker and cleanup resources
   *
   * Performs final persistence before shutdown.
   */
  shutdown(): void {
    if (this.persistenceEnabled) {
      this.saveToFile();
    }
    this.logger.debug('ArgumentHistoryTracker shutdown complete');
  }
}

// @lifecycle canonical - Tracks argument history references.
/**
 * Argument History Tracker
 *
 * Tracks execution arguments and context independent of conversation history.
 * Provides execution context for gate reviews and chain execution.
 *
 * Key Features:
 * - Stores original arguments and step results per chain
 * - Entry limit per chain (FIFO cleanup)
 * - SQLite persistence via SqliteStateStore
 * - Lightweight tracking (<ms overhead)
 * - Independent of semantic layer and conversation history
 */
import { ArgumentHistoryEntry, ReviewContext, PersistedArgumentHistory } from './types.js';

import type { Logger } from '#shared/types/index.js';
import type { StateStore, StateStoreOptions } from '#shared/types/persistence.js';

const DEFAULT_STATE: PersistedArgumentHistory = {
  version: '1.0.0',
  lastUpdated: 0,
  chains: {},
  sessionToChain: {},
};

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

  /**
   * Scoped state store for persistence.
   *
   * Typed against the `shared/types` interface rather than `SqliteStateStore` itself: this file
   * is Layer 3 (`modules/`) and `modules-no-infra-static` forbids reaching into `infra/` for the
   * concrete store — static, dynamic, and type-only alike. The composition root builds the
   * concrete store and injects it, which is what that rule's comment prescribes.
   */
  private store?: StateStore<PersistedArgumentHistory>;

  /** Workspace scope stamped on every save and used to filter every load. */
  private scope?: StateStoreOptions;

  /** Whether initialization has completed */
  private initialized: boolean = false;

  /**
   * Create an ArgumentHistoryTracker instance.
   *
   * @param logger - Logger instance
   * @param maxEntriesPerChain - Maximum entries per chain (default: 50)
   * @param store - Optional state store (set later via setStateStore if not provided)
   * @param scope - Workspace scope for persistence
   */
  constructor(
    private logger: Logger,
    maxEntriesPerChain: number = 50,
    store?: StateStore<PersistedArgumentHistory>,
    scope?: StateStoreOptions
  ) {
    this.maxEntriesPerChain = maxEntriesPerChain;
    this.store = store;
    this.scope = scope;

    this.logger.debug(
      `ArgumentHistoryTracker initialized (maxEntriesPerChain: ${this.maxEntriesPerChain})`
    );
  }

  /** Late-bind the state store and its scope (setter injection, matching codebase convention). */
  setStateStore(store: StateStore<PersistedArgumentHistory>, scope?: StateStoreOptions): void {
    this.store = store;
    this.scope = scope;
  }

  /**
   * Initialize: load persisted data from database.
   * Must be called before first use.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.store) {
      await this.loadFromStore();
    }
    this.initialized = true;
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
  async trackExecution(options: {
    promptId: string;
    sessionId?: string;
    originalArgs: Record<string, any>;
    stepNumber?: number;
    stepResult?: string;
    metadata?: Record<string, any>;
  }): Promise<string> {
    // Auto-initialize if not yet ready (guards against fire-and-forget init race)
    if (!this.initialized) {
      await this.initialize();
    }

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

    // Persist to SQLite
    await this.saveToStore();

    return entryId;
  }

  /**
   * Get argument history for a specific chain
   */
  getChainHistory(chainId: string): ArgumentHistoryEntry[] {
    const entries = this.chainHistory.get(chainId) || [];
    return entries.map((entry) => ({ ...entry }));
  }

  /**
   * Get argument history for a session
   */
  getSessionHistory(sessionId: string): ArgumentHistoryEntry[] {
    const chainId = this.sessionToChain.get(sessionId) || sessionId;
    return this.getChainHistory(chainId);
  }

  /**
   * Get latest arguments for a session
   */
  getLatestArguments(sessionId: string): Record<string, any> | null {
    const history = this.getSessionHistory(sessionId);
    if (history.length === 0) {
      return null;
    }

    const latestEntry = history[history.length - 1];
    if (!latestEntry) {
      return null;
    }
    return { ...latestEntry.originalArgs };
  }

  /**
   * Build execution context for gate review
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

    const previousResults: Record<number, string> = {};
    let maxStepNumber = -1;

    history.forEach((entry) => {
      if (entry.stepNumber !== undefined && entry.stepResult) {
        previousResults[entry.stepNumber] = entry.stepResult;
        maxStepNumber = Math.max(maxStepNumber, entry.stepNumber);
      }
    });

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
   */
  async clearSession(sessionId: string): Promise<void> {
    const chainId = this.sessionToChain.get(sessionId);

    if (chainId) {
      this.chainHistory.delete(chainId);
      this.sessionToChain.delete(sessionId);
      this.logger.debug(`Cleared argument history for session ${sessionId} (chain ${chainId})`);
      await this.saveToStore();
    }
  }

  /**
   * Clear history for a specific chain
   */
  async clearChain(chainId: string): Promise<void> {
    this.chainHistory.delete(chainId);

    const sessionsToRemove: string[] = [];
    this.sessionToChain.forEach((cId, sId) => {
      if (cId === chainId) {
        sessionsToRemove.push(sId);
      }
    });
    sessionsToRemove.forEach((sId) => this.sessionToChain.delete(sId));

    this.logger.debug(`Cleared argument history for chain ${chainId}`);
    await this.saveToStore();
  }

  /**
   * Clear all history
   */
  async clearAll(): Promise<void> {
    this.chainHistory.clear();
    this.sessionToChain.clear();
    this.logger.info('Cleared all argument history');
    await this.saveToStore();
  }

  /**
   * Get statistics about tracked history
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
   */
  hasSessionHistory(sessionId: string): boolean {
    const history = this.getSessionHistory(sessionId);
    return history.length > 0;
  }

  /**
   * Save argument history to SQLite via DatabasePort.
   */
  private async saveToStore(): Promise<void> {
    if (!this.store) {
      return;
    }

    try {
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

      await this.store.save(persistedData, this.scope);
      this.logger.debug('Saved argument history to SQLite');
    } catch (error) {
      this.logger.error('Failed to save argument history:', error);
    }
  }

  /**
   * Load argument history from SQLite via DatabasePort.
   */
  private async loadFromStore(): Promise<void> {
    if (!this.store) {
      return;
    }

    try {
      // The store returns its configured default when no row matches this scope, so there is no
      // separate not-found branch: a workspace with no history loads an empty map rather than
      // another workspace's rows, which is the isolation the raw `tenant_id = 'default'` query
      // could not express.
      const persistedData: PersistedArgumentHistory = await this.store.load(this.scope);

      this.chainHistory.clear();
      Object.entries(persistedData.chains).forEach(([chainId, entries]) => {
        this.chainHistory.set(chainId, entries);
      });

      this.sessionToChain.clear();
      Object.entries(persistedData.sessionToChain).forEach(([sessionId, chainId]) => {
        this.sessionToChain.set(sessionId, chainId);
      });

      const stats = this.getStats();
      this.logger.info(
        `Loaded argument history: ${stats.totalChains} chains, ${stats.totalEntries} entries`
      );
    } catch (error) {
      this.logger.error('Failed to load argument history:', error);
    }
  }

  /**
   * Stop tracker and cleanup resources
   */
  async shutdown(): Promise<void> {
    await this.saveToStore();
    this.logger.debug('ArgumentHistoryTracker shutdown complete');
  }
}

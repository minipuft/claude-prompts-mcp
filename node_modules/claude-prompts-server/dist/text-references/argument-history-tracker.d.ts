import { ArgumentHistoryEntry, ReviewContext } from './types.js';
import { Logger } from '../logging/index.js';
/**
 * ArgumentHistoryTracker Class
 *
 * Tracks execution arguments and step results for gate reviews and chain execution.
 * Operates independently of conversation history to ensure reliable execution context.
 */
export declare class ArgumentHistoryTracker {
    private logger;
    /** Chain ID to entries mapping */
    private chainHistory;
    /** Session ID to chain ID mapping */
    private sessionToChain;
    /** Maximum entries per chain (FIFO cleanup) */
    private readonly maxEntriesPerChain;
    /** File path for persistence */
    private readonly persistencePath;
    /** Persistence enabled flag */
    private readonly persistenceEnabled;
    /**
     * Create an ArgumentHistoryTracker instance
     *
     * @param logger - Logger instance
     * @param maxEntriesPerChain - Maximum entries per chain (default: 50)
     * @param persistencePath - Path to persistence file (optional)
     */
    constructor(logger: Logger, maxEntriesPerChain?: number, persistencePath?: string);
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
    }): string;
    /**
     * Get argument history for a specific chain
     *
     * @param chainId - Chain identifier (typically session ID)
     * @returns Array of argument history entries
     */
    getChainHistory(chainId: string): ArgumentHistoryEntry[];
    /**
     * Get argument history for a session
     *
     * Resolves session ID to chain ID and retrieves entries.
     *
     * @param sessionId - Session identifier
     * @returns Array of argument history entries
     */
    getSessionHistory(sessionId: string): ArgumentHistoryEntry[];
    /**
     * Get latest arguments for a session
     *
     * Returns the most recent original arguments recorded for the session.
     * Useful for retrieving user-provided context.
     *
     * @param sessionId - Session identifier
     * @returns Latest original arguments or null if not found
     */
    getLatestArguments(sessionId: string): Record<string, any> | null;
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
    buildReviewContext(sessionId: string, currentStepNumber?: number): ReviewContext;
    /**
     * Clear history for a specific session
     *
     * Removes all entries associated with the session.
     *
     * @param sessionId - Session identifier
     */
    clearSession(sessionId: string): void;
    /**
     * Clear history for a specific chain
     *
     * Removes all entries associated with the chain.
     *
     * @param chainId - Chain identifier
     */
    clearChain(chainId: string): void;
    /**
     * Clear all history
     *
     * Removes all tracked entries and mappings.
     */
    clearAll(): void;
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
    };
    /**
     * Check if a session has any tracked history
     *
     * @param sessionId - Session identifier
     * @returns True if history exists
     */
    hasSessionHistory(sessionId: string): boolean;
    /**
     * Save argument history to file
     *
     * Persists current state to runtime-state/argument-history.json
     */
    private saveToFile;
    /**
     * Load argument history from file
     *
     * Loads persisted state from runtime-state/argument-history.json
     */
    private loadFromFile;
    /**
     * Stop tracker and cleanup resources
     *
     * Performs final persistence before shutdown.
     */
    shutdown(): void;
}

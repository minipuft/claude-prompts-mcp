/**
 * Pending Confirmation Tracker
 *
 * Enables "re-run to approve" workflow for script tools requiring confirmation.
 * Instead of explicit tool:<id> syntax, users can simply re-run the same command
 * to approve execution.
 *
 * Flow:
 * 1. First call: Tool requires confirmation → Record pending state → Show prompt
 * 2. Second call: Same tool with same inputs → Auto-approve → Execute
 *
 * Security:
 * - Pending confirmations expire after 5 minutes
 * - Input hash must match exactly (prevents approval of different operations)
 * - Cleared on approval (single-use)
 */
/**
 * Represents a pending confirmation waiting for user approval.
 */
export interface PendingConfirmation {
    /** Parent prompt ID */
    promptId: string;
    /** Tool ID awaiting confirmation */
    toolId: string;
    /** Hash of extracted inputs for comparison */
    inputsHash: string;
    /** When the confirmation was recorded */
    timestamp: number;
    /** When this pending confirmation expires (auto-cleanup) */
    expiresAt: number;
}
/**
 * Configuration for the tracker.
 */
export interface PendingConfirmationTrackerConfig {
    /** Time in ms before pending confirmations expire (default: 5 minutes) */
    expirationMs?: number;
    /** Enable debug logging */
    debug?: boolean;
}
/**
 * Pending Confirmation Tracker
 *
 * Tracks script tools awaiting user confirmation via re-run.
 *
 * @example
 * ```typescript
 * const tracker = new PendingConfirmationTracker();
 *
 * // First call - record pending
 * tracker.recordPending('create_methodology', 'methodology_builder', inputs);
 *
 * // Second call - check and auto-approve
 * if (tracker.checkAndClearPending('create_methodology', 'methodology_builder', inputs)) {
 *   // Auto-approved! Execute the tool
 * }
 * ```
 */
export declare class PendingConfirmationTracker {
    private readonly pending;
    private readonly expirationMs;
    private readonly debug;
    constructor(config?: PendingConfirmationTrackerConfig);
    /**
     * Record a pending confirmation for later auto-approval.
     *
     * Called when a tool requires confirmation and we want to enable
     * "re-run to approve" workflow.
     *
     * @param promptId - Parent prompt ID
     * @param toolId - Tool ID requiring confirmation
     * @param inputs - Extracted inputs (will be hashed for comparison)
     */
    recordPending(promptId: string, toolId: string, inputs: Record<string, unknown>): void;
    /**
     * Check if there's a pending confirmation that matches and clear it.
     *
     * Returns true if:
     * 1. A pending confirmation exists for this prompt+tool
     * 2. The inputs hash matches exactly
     * 3. The confirmation hasn't expired
     *
     * If true, the pending confirmation is cleared (single-use).
     *
     * @param promptId - Parent prompt ID
     * @param toolId - Tool ID to check
     * @param inputs - Current inputs to compare against pending
     * @returns true if auto-approved, false otherwise
     */
    checkAndClearPending(promptId: string, toolId: string, inputs: Record<string, unknown>): boolean;
    /**
     * Check if there's a pending confirmation (without clearing).
     *
     * @param promptId - Parent prompt ID
     * @param toolId - Tool ID to check
     * @returns true if pending exists and not expired
     */
    hasPending(promptId: string, toolId: string): boolean;
    /**
     * Clear all pending confirmations.
     * Useful for testing or explicit cleanup.
     */
    clear(): void;
    /**
     * Get count of active (non-expired) pending confirmations.
     */
    get size(): number;
    /**
     * Create a unique key for prompt+tool combination.
     */
    private makeKey;
    /**
     * Create a deterministic hash of inputs for comparison.
     * Uses stable JSON serialization to ensure consistent hashing.
     */
    private hashInputs;
    /**
     * Recursively sort object keys for deterministic serialization.
     */
    private sortObjectKeys;
    /**
     * Remove expired entries.
     */
    private cleanupExpired;
}
/**
 * Get the default PendingConfirmationTracker instance.
 * Creates one if it doesn't exist.
 */
export declare function getDefaultPendingConfirmationTracker(): PendingConfirmationTracker;
/**
 * Reset the default tracker (useful for testing).
 */
export declare function resetDefaultPendingConfirmationTracker(): void;

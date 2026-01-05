// @lifecycle canonical - Tracks pending confirmations for re-run auto-approval.
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

import { createHash } from 'crypto';

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

/** Default expiration: 5 minutes */
const DEFAULT_EXPIRATION_MS = 5 * 60 * 1000;

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
export class PendingConfirmationTracker {
  private readonly pending: Map<string, PendingConfirmation> = new Map();
  private readonly expirationMs: number;
  private readonly debug: boolean;

  constructor(config: PendingConfirmationTrackerConfig = {}) {
    this.expirationMs = config.expirationMs ?? DEFAULT_EXPIRATION_MS;
    this.debug = config.debug ?? false;

    if (this.debug) {
      // eslint-disable-next-line no-console
      console.error('[PendingConfirmationTracker] Initialized with expiration:', this.expirationMs);
    }
  }

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
  recordPending(promptId: string, toolId: string, inputs: Record<string, unknown>): void {
    const key = this.makeKey(promptId, toolId);
    const inputsHash = this.hashInputs(inputs);
    const now = Date.now();

    const pending: PendingConfirmation = {
      promptId,
      toolId,
      inputsHash,
      timestamp: now,
      expiresAt: now + this.expirationMs,
    };

    this.pending.set(key, pending);

    if (this.debug) {
      // eslint-disable-next-line no-console
      console.error(
        `[PendingConfirmationTracker] Recorded pending: ${key} (hash: ${inputsHash.slice(0, 8)}...)`
      );
    }

    // Cleanup expired entries on each record
    this.cleanupExpired();
  }

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
  checkAndClearPending(promptId: string, toolId: string, inputs: Record<string, unknown>): boolean {
    const key = this.makeKey(promptId, toolId);
    const pending = this.pending.get(key);

    if (pending === undefined) {
      if (this.debug) {
        // eslint-disable-next-line no-console
        console.error(`[PendingConfirmationTracker] No pending found for: ${key}`);
      }
      return false;
    }

    // Check expiration
    if (Date.now() > pending.expiresAt) {
      this.pending.delete(key);
      if (this.debug) {
        // eslint-disable-next-line no-console
        console.error(`[PendingConfirmationTracker] Pending expired for: ${key}`);
      }
      return false;
    }

    // Check inputs hash match
    const currentHash = this.hashInputs(inputs);
    if (currentHash !== pending.inputsHash) {
      if (this.debug) {
        // eslint-disable-next-line no-console
        console.error(`[PendingConfirmationTracker] Hash mismatch for: ${key}`);
        // eslint-disable-next-line no-console
        console.error(`  Expected: ${pending.inputsHash.slice(0, 8)}...`);
        // eslint-disable-next-line no-console
        console.error(`  Got: ${currentHash.slice(0, 8)}...`);
      }
      return false;
    }

    // Match! Clear and return true
    this.pending.delete(key);
    if (this.debug) {
      // eslint-disable-next-line no-console
      console.error(`[PendingConfirmationTracker] Auto-approved: ${key}`);
    }
    return true;
  }

  /**
   * Check if there's a pending confirmation (without clearing).
   *
   * @param promptId - Parent prompt ID
   * @param toolId - Tool ID to check
   * @returns true if pending exists and not expired
   */
  hasPending(promptId: string, toolId: string): boolean {
    const key = this.makeKey(promptId, toolId);
    const pending = this.pending.get(key);
    if (pending === undefined) return false;
    if (Date.now() > pending.expiresAt) {
      this.pending.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Clear all pending confirmations.
   * Useful for testing or explicit cleanup.
   */
  clear(): void {
    this.pending.clear();
    if (this.debug) {
      // eslint-disable-next-line no-console
      console.error('[PendingConfirmationTracker] Cleared all pending');
    }
  }

  /**
   * Get count of active (non-expired) pending confirmations.
   */
  get size(): number {
    this.cleanupExpired();
    return this.pending.size;
  }

  /**
   * Create a unique key for prompt+tool combination.
   */
  private makeKey(promptId: string, toolId: string): string {
    return `${promptId}:${toolId}`;
  }

  /**
   * Create a deterministic hash of inputs for comparison.
   * Uses stable JSON serialization to ensure consistent hashing.
   */
  private hashInputs(inputs: Record<string, unknown>): string {
    // Sort keys for deterministic serialization
    const sorted = this.sortObjectKeys(inputs);
    const json = JSON.stringify(sorted);
    return createHash('sha256').update(json).digest('hex');
  }

  /**
   * Recursively sort object keys for deterministic serialization.
   */
  private sortObjectKeys(obj: unknown): unknown {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.sortObjectKeys(item));
    }
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = this.sortObjectKeys((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }

  /**
   * Remove expired entries.
   */
  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, pending] of this.pending.entries()) {
      if (now > pending.expiresAt) {
        this.pending.delete(key);
        if (this.debug) {
          // eslint-disable-next-line no-console
          console.error(`[PendingConfirmationTracker] Cleaned up expired: ${key}`);
        }
      }
    }
  }
}

// ============================================================================
// Default Instance Management (singleton pattern)
// ============================================================================

let defaultTracker: PendingConfirmationTracker | null = null;

/**
 * Get the default PendingConfirmationTracker instance.
 * Creates one if it doesn't exist.
 */
export function getDefaultPendingConfirmationTracker(): PendingConfirmationTracker {
  defaultTracker ??= new PendingConfirmationTracker();
  return defaultTracker;
}

/**
 * Reset the default tracker (useful for testing).
 */
export function resetDefaultPendingConfirmationTracker(): void {
  defaultTracker = null;
}

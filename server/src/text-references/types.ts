// @lifecycle canonical - Type definitions for text reference services.
/**
 * Argument History Tracking Types
 *
 * Provides execution context tracking independent of conversation history.
 * Tracks original arguments and step results for gate reviews and chain execution.
 */
/**
 * Argument History Entry - captures execution context at a point in time.
 */
export interface ArgumentHistoryEntry {
  /** Unique entry identifier */
  entryId: string;

  /** Timestamp when arguments were captured */
  timestamp: number;

  /** Session ID (chain execution identifier) */
  sessionId?: string;

  /** Prompt ID that was executed */
  promptId: string;

  /** Original arguments provided by user */
  originalArgs: Record<string, any>;

  /** Step number (for chain executions) */
  stepNumber?: number;

  /** Step result (if available) */
  stepResult?: string;

  /** Execution metadata */
  metadata?: {
    executionType?: 'single' | 'chain';
    chainId?: string;
    isPlaceholder?: boolean;
    frameworkUsed?: string;
    [key: string]: any;
  };
}

/**
 * Review Context - execution context for gate reviews
 *
 * Provides complete execution context independent of conversation history,
 * ensuring gate reviews always have access to original arguments and step results.
 */
export interface ReviewContext {
  /** Original arguments provided for execution */
  originalArgs: Record<string, any>;

  /** Previous step results indexed by step number */
  previousResults: Record<number, string>;

  /** Current step in chain (if applicable) */
  currentStep?: number;

  /** Total steps in chain (if applicable) */
  totalSteps?: number;
}

/**
 * Persisted Argument History Format
 *
 * File format for runtime-state/argument-history.json
 */
export interface PersistedArgumentHistory {
  /** Version for future compatibility */
  version: string;

  /** Last update timestamp */
  lastUpdated: number;

  /** Chain ID to entries mapping */
  chains: Record<string, ArgumentHistoryEntry[]>;

  /** Session ID to chain ID mapping */
  sessionToChain: Record<string, string>;
}

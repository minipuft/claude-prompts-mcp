/**
 * Gate Retry Config Resolver
 *
 * Extracts and merges retry configuration from multiple gate definitions.
 * Uses the most restrictive maxAttempts (lowest value) when multiple gates are involved.
 */
import type { GateLoader } from '../core/gate-loader.js';
import type { GateEnforcementMode } from '../types.js';
export interface ResolvedRetryConfig {
    /** Maximum retry attempts (lowest value from all gates) */
    maxAttempts: number;
    /** Whether to include improvement hints in retry prompts */
    improvementHints: boolean;
    /** Whether to preserve context between retry attempts */
    preserveContext: boolean;
    /** Collected improvement hints/criteria from failed gates */
    retryHints: string[];
}
/**
 * Resolve retry configuration from multiple gate definitions.
 * Uses the most restrictive maxAttempts (lowest value wins).
 *
 * @param gateIds - Array of gate IDs to load retry config from
 * @param gateLoader - GateLoader instance for loading gate definitions
 * @returns Merged retry configuration
 */
export declare function resolveRetryConfig(gateIds: string[], gateLoader: GateLoader): Promise<ResolvedRetryConfig>;
/**
 * Build retry guidance text for display in gate review prompts.
 * Shows attempt progress and improvement suggestions.
 *
 * @param attemptCount - Current attempt number
 * @param maxAttempts - Maximum allowed attempts
 * @param retryHints - Array of improvement hints
 * @param lastFeedback - Feedback from the last failed attempt
 * @returns Formatted retry guidance text
 */
export declare function buildRetryGuidance(attemptCount: number, maxAttempts: number, retryHints?: string[], lastFeedback?: string): string;
/**
 * Determine the effective enforcement mode from multiple gate definitions.
 * Uses the most restrictive mode (blocking > advisory > informational).
 *
 * @param gateIds - Array of gate IDs to check
 * @param gateLoader - GateLoader instance for loading gate definitions
 * @returns The most restrictive enforcement mode from all gates
 */
export declare function resolveEnforcementMode(gateIds: string[], gateLoader: GateLoader): Promise<GateEnforcementMode>;

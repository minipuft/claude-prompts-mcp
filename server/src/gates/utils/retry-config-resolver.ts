// @lifecycle canonical - Resolves retry configuration from gate definitions.
/**
 * Gate Retry Config Resolver
 *
 * Extracts and merges retry configuration from multiple gate definitions.
 * Uses the most restrictive maxAttempts (lowest value) when multiple gates are involved.
 */

import { DEFAULT_GATE_RETRY_CONFIG } from '../constants.js';
import { SEVERITY_TO_ENFORCEMENT } from '../types.js';

import type { GateLoader } from '../core/gate-loader.js';
import type { GateEnforcementMode, GateSeverity } from '../types.js';

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
export async function resolveRetryConfig(
  gateIds: string[],
  gateLoader: GateLoader
): Promise<ResolvedRetryConfig> {
  if (gateIds.length === 0) {
    return {
      maxAttempts: DEFAULT_GATE_RETRY_CONFIG.max_attempts,
      improvementHints: DEFAULT_GATE_RETRY_CONFIG.improvement_hints,
      preserveContext: DEFAULT_GATE_RETRY_CONFIG.preserve_context,
      retryHints: [],
    };
  }

  const gates = await Promise.all(gateIds.map((id) => gateLoader.loadGate(id)));

  // Find most restrictive maxAttempts (lowest value wins)
  let minMaxAttempts = Infinity;
  let anyImprovementHints = false;
  let anyPreserveContext = false;
  const retryHints: string[] = [];

  for (const gate of gates) {
    if (!gate) continue;

    const retryConfig = gate.retry_config;
    const maxAttempts = retryConfig?.max_attempts ?? DEFAULT_GATE_RETRY_CONFIG.max_attempts;

    if (maxAttempts < minMaxAttempts) {
      minMaxAttempts = maxAttempts;
    }

    // Collect improvement hints from gate guidance if enabled
    if (retryConfig?.improvement_hints !== false) {
      anyImprovementHints = true;

      // Use gate guidance or description as improvement hints
      if (gate.guidance) {
        // Extract key points from guidance (split by newlines or bullet points)
        const guidanceLines = gate.guidance
          .split(/[\n•-]/)
          .map((line) => line.trim())
          .filter((line) => line.length > 10 && line.length < 200);

        if (guidanceLines.length > 0) {
          retryHints.push(`**${gate.name}:**`);
          for (const line of guidanceLines.slice(0, 3)) {
            retryHints.push(`- ${line}`);
          }
        }
      } else if (gate.description) {
        retryHints.push(`**${gate.name}:** ${gate.description}`);
      }
    }

    if (retryConfig?.preserve_context !== false) {
      anyPreserveContext = true;
    }
  }

  return {
    maxAttempts: minMaxAttempts === Infinity ? DEFAULT_GATE_RETRY_CONFIG.max_attempts : minMaxAttempts,
    improvementHints: anyImprovementHints,
    preserveContext: anyPreserveContext,
    retryHints: retryHints.length > 0 ? retryHints : [],
  };
}

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
export function buildRetryGuidance(
  attemptCount: number,
  maxAttempts: number,
  retryHints?: string[],
  lastFeedback?: string
): string {
  const lines: string[] = [
    `**Attempt ${attemptCount + 1} of ${maxAttempts}**`,
  ];

  if (retryHints && retryHints.length > 0) {
    lines.push('', '**Consider these improvements:**');
    lines.push(...retryHints.slice(0, 10)); // Limit to top 10 hints
  }

  if (lastFeedback && lastFeedback.trim().length > 0) {
    lines.push('', `**Previous feedback:** ${lastFeedback}`);
  }

  return lines.join('\n');
}

/**
 * Enforcement mode priority (most restrictive first)
 */
const ENFORCEMENT_PRIORITY: Record<GateEnforcementMode, number> = {
  blocking: 0,
  advisory: 1,
  informational: 2,
};

/**
 * Determine the effective enforcement mode from multiple gate definitions.
 * Uses the most restrictive mode (blocking > advisory > informational).
 *
 * @param gateIds - Array of gate IDs to check
 * @param gateLoader - GateLoader instance for loading gate definitions
 * @returns The most restrictive enforcement mode from all gates
 */
export async function resolveEnforcementMode(
  gateIds: string[],
  gateLoader: GateLoader
): Promise<GateEnforcementMode> {
  if (gateIds.length === 0) {
    return 'blocking'; // Default to blocking when no gates specified
  }

  const gates = await Promise.all(gateIds.map((id) => gateLoader.loadGate(id)));

  let mostRestrictive: GateEnforcementMode = 'informational';

  for (const gate of gates) {
    if (!gate) continue;

    // Use explicit enforcementMode if set, otherwise derive from severity
    const mode: GateEnforcementMode =
      gate.enforcementMode ??
      SEVERITY_TO_ENFORCEMENT[(gate.severity ?? 'medium') as GateSeverity] ??
      'advisory';

    // Keep the most restrictive mode
    if (ENFORCEMENT_PRIORITY[mode] < ENFORCEMENT_PRIORITY[mostRestrictive]) {
      mostRestrictive = mode;
    }

    // Short-circuit if we hit the most restrictive possible
    if (mostRestrictive === 'blocking') {
      break;
    }
  }

  return mostRestrictive;
}

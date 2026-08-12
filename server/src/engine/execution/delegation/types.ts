// @lifecycle canonical - Strategy-based delegation rendering types.
/**
 * Delegation rendering types.
 *
 * These types define the semantic payload that flows from chain execution
 * into the DelegationRenderer. They are client-agnostic — the strategy
 * maps them to client-specific output.
 */
import type { VisibilityItem } from '#shared/types/chain-execution.js';
import type { RequestClientProfile } from '#shared/types/request-identity.js';

/** Semantic delegation data (client-agnostic). */
export interface DelegationPayload {
  readonly stepNumber: number;
  readonly totalSteps: number;
  readonly promptName: string;
  readonly agentType: string;
  readonly clientProfile?: RequestClientProfile;
  readonly subagentModel?: string;
  readonly gateCount: number;
  readonly hasGates: boolean;
}

/** Pre-computed execution context sections for sub-agent. */
export interface ExecutionEnvelope {
  readonly chainHistory?: string;
  readonly frameworkGuidance?: string;
  readonly gateInstructions?: string;
  /**
   * NAMES of the chain-run context items withheld from the delegated step (P5 Tier 3.2,
   * OQ-P5-3: names only, never values). The renderer prints these as one manifest line so a
   * sub-agent that is missing context can say so, rather than silently guessing.
   *
   * Typed as `VisibilityItem[]` rather than `string[]`: every value that reaches here comes
   * from a {@link VisibilityDecision}'s `manifest`, so widening to `string` would accept a
   * label no policy could ever produce. The renderer only ever joins them into text.
   */
  readonly withheldManifest?: readonly VisibilityItem[];
}

/** Rendering hints for CTA construction. */
export interface RenderingHints {
  readonly gateGuidanceEnabled: boolean;
  readonly frameworkInjectionEnabled: boolean;
}

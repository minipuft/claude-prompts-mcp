// @lifecycle canonical - Strategy-based delegation rendering types.
/**
 * Delegation rendering types.
 *
 * These types define the semantic payload that flows from chain execution
 * into the DelegationRenderer. They are client-agnostic — the strategy
 * maps them to client-specific output.
 */
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
}

/** Rendering hints for CTA construction. */
export interface RenderingHints {
  readonly gateGuidanceEnabled: boolean;
  readonly frameworkInjectionEnabled: boolean;
}

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
  /**
   * Host agent named by the author (step `agentType` > prompt `agentType`). Undefined when
   * neither declared one: each strategy then renders its host's own default (Claude Code
   * `general-purpose`) or omits the parameter so the client's default agent applies.
   */
  readonly agentType?: string;
  readonly clientProfile?: RequestClientProfile;
  readonly subagentModel?: string;
  readonly gateCount: number;
  readonly hasGates: boolean;
}

/** Rendering hints for CTA construction. */
export interface RenderingHints {
  readonly gateGuidanceEnabled: boolean;
  readonly frameworkInjectionEnabled: boolean;
}

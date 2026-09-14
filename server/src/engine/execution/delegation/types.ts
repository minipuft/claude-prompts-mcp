// @lifecycle canonical - Strategy-based delegation rendering types.
/**
 * Delegation rendering types.
 *
 * These types define the semantic payload that flows from chain execution
 * into the DelegationRenderer. They are client-agnostic — the strategy
 * maps them to client-specific output.
 */
import type { RequestClientProfile } from '#shared/types/request-identity.js';

/**
 * Whether the run pauses at a delegated node until its result is resumed (`blocking`), or the
 * node is spawned and the run continues without waiting (`detached`, reserved — a later tier
 * gives it a lifecycle; Tier 1 never constructs it).
 */
export type DelegationMode = 'blocking' | 'detached';

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
  /** The handoff contract token this node's brief carries and a worker's reply must echo. */
  readonly nodeToken: string;
  /** Whether the run waits at this node (`blocking`) or continues past it (`detached`). */
  readonly mode: DelegationMode;
}

/** Rendering hints for CTA construction. */
export interface RenderingHints {
  readonly gateGuidanceEnabled: boolean;
  readonly frameworkInjectionEnabled: boolean;
}

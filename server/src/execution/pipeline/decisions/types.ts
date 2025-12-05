// @lifecycle canonical - Types for pipeline decision authorities.

/**
 * Framework decision result from the authority.
 */
export interface FrameworkDecision {
  readonly shouldApply: boolean;
  readonly frameworkId?: string;
  readonly reason: string;
  readonly source: 'operator' | 'client-selection' | 'global-active' | 'disabled';
  readonly decidedAt: number;
}

/**
 * Strategy decision result from the authority.
 */
export interface StrategyDecision {
  readonly strategy: 'single' | 'chain' | 'parallel';
  readonly reason: string;
  readonly source: 'parsed-command' | 'execution-plan' | 'default';
  readonly decidedAt: number;
}

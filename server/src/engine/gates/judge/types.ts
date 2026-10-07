// @lifecycle canonical - Judge evaluation type definitions.
/**
 * Judge Evaluation Types
 *
 * Defines the data model for context-isolated gate evaluation via delegation.
 * When a gate has `evaluation.mode: 'judge'`, the gate review is rendered as
 * a delegation CTA instead of a self-review prompt — stripping generation
 * reasoning and using strict (failure-first) framing.
 */

import type { JudgeEvaluationMode } from '#shared/types/gate-evaluation.js';

export type { JudgeEvaluationMode, ResolvedJudgeConfig } from '#shared/types/gate-evaluation.js';

/**
 * Per-gate judge evaluation configuration.
 * Defined in gate.yaml under the `evaluation` key.
 *
 * @example
 * ```yaml
 * evaluation:
 *   mode: judge
 *   model: haiku
 *   strict: true
 * ```
 */
export interface JudgeEvaluationConfig {
  /** Evaluation mode: 'self' (default) or 'judge' (context-isolated) */
  mode: JudgeEvaluationMode;
  /** Model hint for the judge sub-agent (e.g., 'haiku' for cheap evaluation) */
  model?: string;
  /** Use strict "find failures first" framing (default: true when mode is judge) */
  strict?: boolean;
}

/**
 * Semantic envelope for the judge sub-agent.
 * Contains only the data needed for evaluation — no generation reasoning.
 */
export interface JudgeEnvelope {
  /** The LLM output to evaluate (stripped of generation reasoning) */
  readonly output: string;
  /** Gate criteria text to evaluate against */
  readonly criteria: readonly string[];
  /** Human-readable gate name */
  readonly gateName: string;
  /** Gate ID for verdict routing */
  readonly gateId: string;
  /** Whether to use strict (failure-first) framing */
  readonly strict: boolean;
  /** Expected verdict format */
  readonly verdictFormat: string;
}

/**
 * Global judge evaluation defaults from config.json.
 * These are overridden by per-gate `evaluation` settings.
 */
export interface JudgeEvaluationDefaults {
  /** Default evaluation mode for all gates */
  defaultMode: JudgeEvaluationMode;
  /** Default model hint for judge sub-agents */
  defaultModel?: string;
  /** Default strict setting */
  strict: boolean;
}

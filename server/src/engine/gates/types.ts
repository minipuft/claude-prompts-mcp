// @lifecycle canonical - Top-level gate type definitions.
/**
 * Gate System Type Definitions
 *
 * Consolidated types for the gate validation system, including lightweight gates,
 * enhanced validation, and gate orchestration. Combines types from multiple gate
 * system implementations into a unified type system.
 *
 * Registry-based gate guide types are exported from ./types/ subfolder.
 */

import type { JudgeEvaluationConfig } from './judge/types.js';
import type { GatePassCriteria } from './types/gate-primitives.js';
import type { GateGuide, GateActivationContext, GateRegistryStats } from './types/index.js';

export type { ValidationCheck } from '../execution/types.js';

// ============================================================================
// Registry-Based Gate Guide Types (Phase 1: Foundation)
// ============================================================================

// Re-export all gate guide types from the types/ subfolder
export type {
  // Core interface
  GateGuide,
  GateActivationRules,
  GateActivationContext,
  GateDefinitionYaml,
  LoadedGateDefinition,
  GateRetryConfig,
  // Registry types
  GateSource,
  GateGuideEntry,
  GateRegistryStats,
  // Selection types
  GateSelectionContext,
  GateSelectionResult,
} from './types/index.js';

// GatePassCriteria canonical definition in ./types/gate-primitives.ts
export type { GatePassCriteria } from './types/gate-primitives.js';

/**
 * Context for validation
 */
export interface ValidationContext {
  /** Content to validate */
  content: string;
  /** Additional metadata */
  metadata?: Record<string, any>;
  /** Execution context */
  executionContext?: {
    promptId?: string;
    stepId?: string;
    attemptNumber?: number;
    previousAttempts?: string[];
  };
}

/**
 * Gate activation result
 */
export interface GateActivationResult {
  /** Gates that should be active */
  activeGates: LightweightGateDefinition[];
  /** Guidance text to inject */
  guidanceText: string[];
  /** Validation gates to apply */
  validationGates: LightweightGateDefinition[];
}

/**
 * Lightweight gate definition (for backward compatibility)
 */
export interface LightweightGateDefinition {
  /** Unique identifier for the gate */
  id: string;
  /** Human-readable name */
  name: string;
  /** Gate type - validation enforces pass/fail, guidance provides hints */
  type: 'validation' | 'guidance';
  /** Description of what this gate checks/guides */
  description: string;
  /**
   * Free kebab-case tag naming what this gate reminds about (e.g. `code-quality`). An
   * installation's `gates.harnessCovers` (config.json) suppresses reminders whose subject
   * it lists; checks (`shell_verify`/`script_tool`) are never suppressed. Surfaced by the
   * generated gate index.
   */
  subject?: string;
  /** Opaque evaluation-suite association; no runtime lookup or acceptance authority. */
  calibration_suite_id?: string;
  /** Severity level for prioritization (defaults to 'medium') */
  severity?: 'critical' | 'high' | 'medium' | 'low';
  /** What a FAIL does. Absent means undeclared — `resolveEnforcementMode` decides (P4.137). */
  enforcementMode?: 'blocking' | 'advisory' | 'informational';
  /** Path to external guidance file (relative to gate directory, e.g., 'guidance.md') */
  guidanceFile?: string;
  /** Guidance text injected into prompts (loaded from guidanceFile if specified) */
  guidance?: string;
  /** Pass/fail criteria for validation gates */
  pass_criteria?: GatePassCriteria[];
  /** Retry configuration */
  retry_config?: {
    max_attempts: number;
    improvement_hints: boolean;
    preserve_context: boolean;
  };
  /** Activation rules - when this gate should be applied */
  activation?: {
    prompt_categories?: string[];
    explicit_request?: boolean;
    framework_context?: string[];
  };
  /**
   * Gate type classification for dynamic identification.
   * 'framework' gates are framework-related and can be filtered when frameworks are disabled.
   */
  gate_type?: 'framework' | 'category' | 'custom';

  /**
   * When true, gate failure (FAIL verdict) will suppress the execution response content.
   * Only the gate review instructions will be returned, not the actual output.
   * Useful for critical gates where invalid output should not be exposed to the user.
   * @default false
   */
  blockResponseOnFail?: boolean;

  /**
   * Judge evaluation configuration.
   * When mode is 'judge', gate review is delegated to a context-isolated sub-agent
   * instead of self-review. Loaded from gate.yaml `evaluation` key.
   */
  evaluation?: JudgeEvaluationConfig;

  /**
   * Root directory this gate was loaded FROM, carried over from `LoadedGateDefinition`.
   *
   * The gate's own directory is `{sourceRoot}/{id}`, and that is the only way a consumer can
   * resolve a file the gate SHIPS WITH: a `shell_verify` script sitting beside `gate.yaml` is
   * part of the resource, so naming it relative to the server's working directory makes it
   * unresolvable wherever the server happens to have been launched from — which is the client's
   * cwd, not this package. Absent for a temporary (in-memory) gate, which has no directory.
   */
  sourceRoot?: string;
}

// Primitive gate types canonical in ./types/gate-primitives.ts
export type { GateEnforcementMode, GateSeverity } from './types/gate-primitives.js';
export { SEVERITY_TO_ENFORCEMENT } from './types/gate-primitives.js';

/**
 * Interface for GateManager consumed by the gate-provider-adapter.
 * Breaks the concrete import cycle: gate-manager → registry → adapter → gate-manager.
 */
export interface IGateManager {
  get(id: string): GateGuide | undefined;
  getActiveGates(gateIds: string[], context: GateActivationContext): GateGuide[];
  list(enabledOnly?: boolean): GateGuide[];
  getStats(): GateRegistryStats;
}

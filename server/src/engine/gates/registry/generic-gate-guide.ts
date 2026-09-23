// @lifecycle canonical - Data-driven GateGuide implementation from YAML definitions.
/**
 * Generic Gate Guide
 *
 * Data-driven implementation of GateGuide that works with any gate definition.
 * All behavior is driven by the YAML definition, not hardcoded logic.
 *
 * This mirrors the GenericFrameworkGuide pattern from the framework system.
 *
 * @see GenericFrameworkGuide for the pattern this follows
 */

import { isGateActiveForContext } from '../utils/gate-activation.js';

import type {
  GateGuide,
  LoadedGateDefinition,
  GateActivationRules,
  GateActivationContext,
  GateRetryConfig,
} from '../types/index.js';
import type { GatePassCriteria, GateSeverity } from '../types.js';

/**
 * Generic Gate Guide
 *
 * Implements GateGuide interface using data from YAML definitions.
 * All behavior is driven by the definition, making it easy to add
 * new gates without writing code.
 *
 * @example
 * ```typescript
 * const definition = loader.loadGate('code-quality');
 * const guide = new GenericGateGuide(definition);
 *
 * if (guide.isActive({ promptCategory: 'code' })) {
 *   console.log(guide.getGuidance());
 * }
 * ```
 */
export class GenericGateGuide implements GateGuide {
  // -------------------------------------------------------------------------
  // Readonly Properties (from GateGuide)
  // -------------------------------------------------------------------------

  readonly gateId: string;
  readonly name: string;
  readonly type: 'validation' | 'guidance';
  readonly severity: GateSeverity;
  readonly gateType: 'framework' | 'category' | 'custom';
  readonly description: string;

  // -------------------------------------------------------------------------
  // Private State
  // -------------------------------------------------------------------------

  private readonly definition: LoadedGateDefinition;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  constructor(definition: LoadedGateDefinition) {
    this.definition = definition;

    // Extract core properties
    this.gateId = definition.id;
    this.name = definition.name;
    this.type = definition.type;
    this.description = definition.description;

    // Severity and gate type are present on every loaded definition: the loader parses
    // through GateDefinitionSchema, which supplies both defaults.
    this.severity = definition.severity;

    // No enforcement mode is resolved here. The declared value stays on `getDefinition()`, and
    // `resolveEnforcementMode` is the one place that decides what an undeclared gate means
    // (P4.137); a severity-derived default here disagreed with it and had no reader.

    this.gateType = definition.gate_type;
  }

  // -------------------------------------------------------------------------
  // Core Methods
  // -------------------------------------------------------------------------

  /**
   * Get the guidance text for this gate
   */
  getGuidance(): string {
    return this.definition.guidance ?? '';
  }

  /**
   * Get the pass criteria for validation gates
   */
  getPassCriteria(): GatePassCriteria[] {
    return this.definition.pass_criteria ?? [];
  }

  /**
   * Get the activation rules for this gate
   */
  getActivationRules(): GateActivationRules {
    return this.definition.activation ?? {};
  }

  /**
   * Get the retry configuration for this gate
   */
  getRetryConfig(): GateRetryConfig | undefined {
    return this.definition.retry_config;
  }

  // -------------------------------------------------------------------------
  // Activation Methods
  // -------------------------------------------------------------------------

  /**
   * Check if this gate should be active for the given context.
   *
   * Delegates to the canonical isGateActiveForContext utility which handles:
   * - Framework gates (gate_type: 'framework'): AND logic for category+framework
   * - Regular gates: blocking logic where each rule blocks independently
   *
   * @see isGateActiveForContext for implementation details
   */
  isActive(context: GateActivationContext): boolean {
    return isGateActiveForContext(this.definition.activation, context, this.gateType);
  }

  // -------------------------------------------------------------------------
  // Introspection Methods
  // -------------------------------------------------------------------------

  /**
   * Get the underlying gate definition
   */
  getDefinition(): LoadedGateDefinition {
    return this.definition;
  }

  // -------------------------------------------------------------------------
  // Validation (Deprecated - Use GateValidator)
  // -------------------------------------------------------------------------
  // NOTE: validate() method intentionally not implemented here.
  // The canonical validation system is GateValidator which:
  // - Handles shell_verify (ground-truth via exit codes)
  // - Handles script_tool (resolves the id to a registered tool, runs it, parses a verdict)
  // - Intentionally skips `inline_guidance` criteria as they are descriptive
  //   agent-facing checklists, not auto-enforced patterns. The criteria text
  //   is rendered to the agent for self-assessment; no string matching runs
  //   against output (string-based checks don't provide meaningful signal
  //   for LLM-generated content).
  //
  // See: src/gates/core/gate-validator.ts
  // -------------------------------------------------------------------------
}

/**
 * Factory function to create a GenericGateGuide from a definition
 */
export function createGenericGateGuide(definition: LoadedGateDefinition): GenericGateGuide {
  return new GenericGateGuide(definition);
}

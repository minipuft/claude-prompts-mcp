// @lifecycle canonical - Data-driven IGateGuide implementation from YAML definitions.
/**
 * Generic Gate Guide
 *
 * Data-driven implementation of IGateGuide that works with any gate definition.
 * All behavior is driven by the YAML definition, not hardcoded logic.
 *
 * This mirrors the GenericMethodologyGuide pattern from the framework system.
 *
 * @see GenericMethodologyGuide for the pattern this follows
 */

import { isGateActiveForContext } from '../utils/gate-activation.js';

import type {
  IGateGuide,
  GateDefinitionYaml,
  GateActivationRules,
  GateActivationContext,
  GateRetryConfig,
} from '../types/index.js';
import type { GatePassCriteria, GateSeverity, GateEnforcementMode } from '../types.js';

// Default severity to enforcement mapping (matches types.ts)
const DEFAULT_SEVERITY_TO_ENFORCEMENT: Record<GateSeverity, GateEnforcementMode> = {
  critical: 'blocking',
  high: 'advisory',
  medium: 'advisory',
  low: 'informational',
};

/**
 * Generic Gate Guide
 *
 * Implements IGateGuide interface using data from YAML definitions.
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
export class GenericGateGuide implements IGateGuide {
  // -------------------------------------------------------------------------
  // Readonly Properties (from IGateGuide)
  // -------------------------------------------------------------------------

  readonly gateId: string;
  readonly name: string;
  readonly type: 'validation' | 'guidance';
  readonly severity: GateSeverity;
  readonly enforcementMode: GateEnforcementMode;
  readonly gateType: 'framework' | 'category' | 'custom';
  readonly description: string;

  // -------------------------------------------------------------------------
  // Private State
  // -------------------------------------------------------------------------

  private readonly definition: GateDefinitionYaml;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  constructor(definition: GateDefinitionYaml) {
    this.definition = definition;

    // Extract core properties
    this.gateId = definition.id;
    this.name = definition.name;
    this.type = definition.type;
    this.description = definition.description;

    // Resolve severity (default to 'medium')
    this.severity = definition.severity ?? 'medium';

    // Resolve enforcement mode (from definition or severity mapping)
    this.enforcementMode =
      definition.enforcementMode ?? DEFAULT_SEVERITY_TO_ENFORCEMENT[this.severity];

    // Resolve gate type (default to 'custom')
    this.gateType = definition.gate_type ?? 'custom';
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
  getDefinition(): GateDefinitionYaml {
    return this.definition;
  }

  // -------------------------------------------------------------------------
  // Validation (Deprecated - Use GateValidator)
  // -------------------------------------------------------------------------
  // NOTE: validate() method intentionally not implemented here.
  // The canonical validation system is GateValidator which:
  // - Handles shell_verify (ground-truth via exit codes)
  // - Handles llm_self_check (semantic validation)
  // - Intentionally skips string-based checks (content_check, pattern_check)
  //   as they don't provide meaningful signal for LLM-generated content
  //
  // See: src/gates/core/gate-validator.ts
  // -------------------------------------------------------------------------
}

/**
 * Factory function to create a GenericGateGuide from a definition
 */
export function createGenericGateGuide(definition: GateDefinitionYaml): GenericGateGuide {
  return new GenericGateGuide(definition);
}

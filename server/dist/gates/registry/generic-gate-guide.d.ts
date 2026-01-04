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
import type { IGateGuide, GateDefinitionYaml, GateActivationRules, GateActivationContext, GateRetryConfig, GateValidationResult } from '../types/index.js';
import type { GatePassCriteria, GateSeverity, GateEnforcementMode, ValidationContext } from '../types.js';
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
export declare class GenericGateGuide implements IGateGuide {
    readonly gateId: string;
    readonly name: string;
    readonly type: 'validation' | 'guidance';
    readonly severity: GateSeverity;
    readonly enforcementMode: GateEnforcementMode;
    readonly gateType: 'framework' | 'category' | 'custom';
    readonly description: string;
    private readonly definition;
    constructor(definition: GateDefinitionYaml);
    /**
     * Get the guidance text for this gate
     */
    getGuidance(): string;
    /**
     * Get the pass criteria for validation gates
     */
    getPassCriteria(): GatePassCriteria[];
    /**
     * Get the activation rules for this gate
     */
    getActivationRules(): GateActivationRules;
    /**
     * Get the retry configuration for this gate
     */
    getRetryConfig(): GateRetryConfig | undefined;
    /**
     * Check if this gate should be active for the given context
     */
    isActive(context: GateActivationContext): boolean;
    /**
     * Validate content against this gate's criteria
     *
     * Note: This is a basic implementation. The actual validation logic
     * will be enhanced when integrating with GateValidator.
     */
    validate(content: string, context: ValidationContext): Promise<GateValidationResult>;
    /**
     * Get the underlying gate definition
     */
    getDefinition(): GateDefinitionYaml;
    /**
     * Evaluate a single pass criteria against content
     */
    private evaluateCriteria;
    /**
     * Evaluate content check criteria
     */
    private evaluateContentCheck;
    /**
     * Evaluate pattern check criteria
     */
    private evaluatePatternCheck;
}
/**
 * Factory function to create a GenericGateGuide from a definition
 */
export declare function createGenericGateGuide(definition: GateDefinitionYaml): GenericGateGuide;

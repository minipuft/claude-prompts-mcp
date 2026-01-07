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

import type {
  IGateGuide,
  GateDefinitionYaml,
  GateActivationRules,
  GateActivationContext,
  GateRetryConfig,
  GateValidationResult,
} from '../types/index.js';
import type {
  GatePassCriteria,
  GateSeverity,
  GateEnforcementMode,
  ValidationContext,
  SEVERITY_TO_ENFORCEMENT,
} from '../types.js';

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
   * For framework gates (gate_type: 'framework'), requires BOTH:
   * - Matching prompt_categories (if defined)
   * - Matching framework_context (if defined)
   *
   * For regular gates, each rule independently blocks activation if not satisfied.
   */
  isActive(context: GateActivationContext): boolean {
    const activation = this.definition.activation;

    // No activation rules means always active
    if (activation === undefined) {
      return true;
    }

    // Check explicit request requirement (applies to all gate types)
    if (activation.explicit_request === true && context.explicitRequest !== true) {
      return false;
    }

    // Framework gates use AND logic: require BOTH category AND framework match
    if (this.gateType === 'framework') {
      return this.checkFrameworkGateActivation(activation, context);
    }

    // Regular gates: each rule blocks independently if not satisfied
    return this.checkRegularGateActivation(activation, context);
  }

  /**
   * Check activation for framework gates using AND logic.
   * Requires BOTH category and framework to match when both are defined.
   */
  private checkFrameworkGateActivation(
    activation: GateActivationRules,
    context: GateActivationContext
  ): boolean {
    const categoryRules = activation.prompt_categories;
    const frameworkRules = activation.framework_context;
    const hasCategoryRules = categoryRules !== undefined && categoryRules.length > 0;
    const hasFrameworkRules = frameworkRules !== undefined && frameworkRules.length > 0;

    // If category rules exist, check them
    let categoryMatch = true;
    if (hasCategoryRules) {
      const promptCategory = context.promptCategory;
      if (promptCategory === undefined || promptCategory.length === 0) {
        // No category in context but rules require one - don't activate
        categoryMatch = false;
      } else {
        const normalizedCategory = promptCategory.toLowerCase();
        const normalizedCategories = categoryRules.map((c) => c.toLowerCase());
        categoryMatch = normalizedCategories.includes(normalizedCategory);
      }
    }

    // If framework rules exist, check them
    let frameworkMatch = true;
    if (hasFrameworkRules) {
      const framework = context.framework;
      if (framework === undefined || framework.length === 0) {
        // No framework in context but rules require one - don't activate
        frameworkMatch = false;
      } else {
        const normalizedFramework = framework.toUpperCase();
        const normalizedContexts = frameworkRules.map((f) => f.toUpperCase());
        frameworkMatch = normalizedContexts.includes(normalizedFramework);
      }
    }

    // AND logic: both must pass
    return categoryMatch && frameworkMatch;
  }

  /**
   * Check activation for regular (non-framework) gates.
   * Each rule blocks independently if not satisfied.
   */
  private checkRegularGateActivation(
    activation: GateActivationRules,
    context: GateActivationContext
  ): boolean {
    const categoryRules = activation.prompt_categories;
    const frameworkRules = activation.framework_context;
    const promptCategory = context.promptCategory;
    const framework = context.framework;

    // Check prompt categories (empty array means no restriction)
    if (
      categoryRules !== undefined &&
      categoryRules.length > 0 &&
      promptCategory !== undefined &&
      promptCategory.length > 0
    ) {
      const normalizedCategory = promptCategory.toLowerCase();
      const normalizedCategories = categoryRules.map((c) => c.toLowerCase());
      if (!normalizedCategories.includes(normalizedCategory)) {
        return false;
      }
    }

    // Check framework context (empty array means no restriction)
    // Case-insensitive comparison to handle CAGEERF vs cageerf mismatches
    if (
      frameworkRules !== undefined &&
      frameworkRules.length > 0 &&
      framework !== undefined &&
      framework.length > 0
    ) {
      const normalizedFramework = framework.toUpperCase();
      const normalizedContexts = frameworkRules.map((f) => f.toUpperCase());
      if (!normalizedContexts.includes(normalizedFramework)) {
        return false;
      }
    }

    return true;
  }

  // -------------------------------------------------------------------------
  // Validation Methods
  // -------------------------------------------------------------------------

  /**
   * Validate content against this gate's criteria
   *
   * Note: This is a basic implementation. The actual validation logic
   * will be enhanced when integrating with GateValidator.
   */
  async validate(content: string, context: ValidationContext): Promise<GateValidationResult> {
    // Guidance-only gates always pass
    if (this.type === 'guidance') {
      return {
        gateId: this.gateId,
        valid: true,
        passed: true,
        message: 'Guidance gate - no validation required',
        score: 1.0,
        details: {},
        retryHints: [],
        suggestions: [],
      };
    }

    const passCriteria = this.getPassCriteria();

    // No pass criteria defined - pass by default
    if (!passCriteria || passCriteria.length === 0) {
      return {
        gateId: this.gateId,
        valid: true,
        passed: true,
        message: 'No pass criteria defined',
        score: 1.0,
        details: {},
        retryHints: [],
        suggestions: [],
      };
    }

    // Run validation checks
    const checks: Array<{ criteria: GatePassCriteria; passed: boolean; message: string }> = [];
    let allPassed = true;

    for (const criteria of passCriteria) {
      const result = this.evaluateCriteria(criteria, content, context);
      checks.push({
        criteria,
        passed: result.passed,
        message: result.message,
      });
      if (!result.passed) {
        allPassed = false;
      }
    }

    // Calculate score based on passed checks
    const passedCount = checks.filter((c) => c.passed).length;
    const score = checks.length > 0 ? passedCount / checks.length : 1.0;

    // Generate retry hints for failed checks
    const retryHints: string[] = [];
    if (!allPassed) {
      for (const check of checks) {
        if (!check.passed) {
          retryHints.push(check.message);
        }
      }
    }

    return {
      gateId: this.gateId,
      valid: allPassed,
      passed: allPassed,
      message: allPassed
        ? `All ${checks.length} criteria passed`
        : `${passedCount}/${checks.length} criteria passed`,
      score,
      details: {
        checks: checks.map((c) => ({
          type: c.criteria.type,
          passed: c.passed,
          message: c.message,
        })),
      },
      retryHints,
      suggestions: allPassed ? [] : ['Review the guidance and retry hints above'],
    };
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
  // Private Implementation
  // -------------------------------------------------------------------------

  /**
   * Evaluate a single pass criteria against content
   */
  private evaluateCriteria(
    criteria: GatePassCriteria,
    content: string,
    _context: ValidationContext
  ): { passed: boolean; message: string } {
    switch (criteria.type) {
      case 'content_check':
        return this.evaluateContentCheck(criteria, content);

      case 'pattern_check':
        return this.evaluatePatternCheck(criteria, content);

      case 'methodology_compliance':
        // Placeholder - actual methodology compliance checking
        // would require integration with framework system
        return {
          passed: true,
          message: 'Methodology compliance check - delegated to framework system',
        };

      case 'llm_self_check':
        // Placeholder - actual LLM self-check would require
        // integration with LLM service
        return {
          passed: true,
          message: 'LLM self-check - requires LLM integration',
        };

      default:
        return {
          passed: true,
          message: `Unknown criteria type: ${criteria.type}`,
        };
    }
  }

  /**
   * Evaluate content check criteria
   */
  private evaluateContentCheck(
    criteria: GatePassCriteria,
    content: string
  ): { passed: boolean; message: string } {
    const messages: string[] = [];
    let passed = true;

    // Check minimum length
    if (criteria.min_length !== undefined && content.length < criteria.min_length) {
      passed = false;
      messages.push(`Content too short: ${content.length} < ${criteria.min_length} characters`);
    }

    // Check maximum length
    if (criteria.max_length !== undefined && content.length > criteria.max_length) {
      passed = false;
      messages.push(`Content too long: ${content.length} > ${criteria.max_length} characters`);
    }

    // Check required patterns
    if (criteria.required_patterns && criteria.required_patterns.length > 0) {
      for (const pattern of criteria.required_patterns) {
        try {
          const regex = new RegExp(pattern, 'i');
          if (!regex.test(content)) {
            passed = false;
            messages.push(`Missing required pattern: ${pattern}`);
          }
        } catch {
          // Invalid regex - skip
          messages.push(`Invalid regex pattern: ${pattern}`);
        }
      }
    }

    // Check forbidden patterns
    if (criteria.forbidden_patterns && criteria.forbidden_patterns.length > 0) {
      for (const pattern of criteria.forbidden_patterns) {
        try {
          const regex = new RegExp(pattern, 'i');
          if (regex.test(content)) {
            passed = false;
            messages.push(`Found forbidden pattern: ${pattern}`);
          }
        } catch {
          // Invalid regex - skip
        }
      }
    }

    return {
      passed,
      message: passed ? 'Content check passed' : messages.join('; '),
    };
  }

  /**
   * Evaluate pattern check criteria
   */
  private evaluatePatternCheck(
    criteria: GatePassCriteria,
    content: string
  ): { passed: boolean; message: string } {
    const messages: string[] = [];
    let passed = true;

    // Check regex patterns
    if (criteria.regex_patterns && criteria.regex_patterns.length > 0) {
      for (const pattern of criteria.regex_patterns) {
        try {
          const regex = new RegExp(pattern, 'gi');
          if (!regex.test(content)) {
            passed = false;
            messages.push(`Pattern not found: ${pattern}`);
          }
        } catch {
          messages.push(`Invalid regex: ${pattern}`);
        }
      }
    }

    // Check keyword counts
    if (criteria.keyword_count) {
      for (const [keyword, minCount] of Object.entries(criteria.keyword_count)) {
        const regex = new RegExp(keyword, 'gi');
        const matches = content.match(regex);
        const count = matches ? matches.length : 0;
        if (count < minCount) {
          passed = false;
          messages.push(`Keyword '${keyword}' found ${count} times, need at least ${minCount}`);
        }
      }
    }

    return {
      passed,
      message: passed ? 'Pattern check passed' : messages.join('; '),
    };
  }
}

/**
 * Factory function to create a GenericGateGuide from a definition
 */
export function createGenericGateGuide(definition: GateDefinitionYaml): GenericGateGuide {
  return new GenericGateGuide(definition);
}

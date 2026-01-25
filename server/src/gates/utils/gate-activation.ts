// @lifecycle canonical - Pure utility for gate activation checking.
/**
 * Gate Activation Utility
 *
 * Provides the canonical implementation of gate activation logic.
 * All activation checks should delegate to this utility to ensure
 * consistent behavior across the codebase.
 *
 * Key behavior:
 * - Framework gates (gate_type: 'framework') use AND logic: require BOTH
 *   category AND framework to match when both are defined
 * - Regular gates use blocking logic: each rule blocks independently if not satisfied
 */

import type { GateActivationRules, GateActivationContext } from '../types/index.js';

/**
 * Check if a gate should be active for the given context.
 *
 * This is the canonical implementation of gate activation logic.
 * Use this function instead of implementing activation checks inline.
 *
 * @param activation - The gate's activation rules (or undefined for always-active)
 * @param context - The context to check against
 * @param gateType - Optional gate type for special handling ('framework' gates use AND logic)
 * @returns true if the gate should be active
 *
 * @example
 * ```typescript
 * // For regular gates
 * const active = isGateActiveForContext(gate.activation, { promptCategory: 'code' });
 *
 * // For framework gates (require BOTH category AND framework)
 * const active = isGateActiveForContext(gate.activation, context, 'framework');
 * ```
 */
export function isGateActiveForContext(
  activation: GateActivationRules | undefined,
  context: GateActivationContext,
  gateType?: 'framework' | 'category' | 'custom'
): boolean {
  // No activation rules means always active
  if (activation === undefined) {
    return true;
  }

  // Check explicit request requirement (applies to all gate types)
  if (activation.explicit_request === true && context.explicitRequest !== true) {
    return false;
  }

  // Framework gates use AND logic: require BOTH category AND framework match
  if (gateType === 'framework') {
    return checkFrameworkGateActivation(activation, context);
  }

  // Regular gates: each rule blocks independently if not satisfied
  return checkRegularGateActivation(activation, context);
}

/**
 * Check activation for framework gates using AND logic.
 * Requires BOTH category and framework to match when both are defined.
 */
function checkFrameworkGateActivation(
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
function checkRegularGateActivation(
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

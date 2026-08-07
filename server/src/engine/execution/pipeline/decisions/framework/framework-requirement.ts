// @lifecycle canonical - Pure predicates deciding whether a step needs framework guidance.

import type { ChainStepPrompt } from '../../../operators/types.js';

/**
 * Whether framework guidance is required, decided from a step and the set of gate ids that
 * are framework gates.
 *
 * These are free functions taking the framework-gate set as a parameter rather than methods
 * closing over it. The set is loaded asynchronously once per request
 * (`gateLoader.getFrameworkGateIds()`), and that load is I/O belonging to the caller. A method
 * reading it from instance state would present a synchronous call whose answer silently depends
 * on whether an unrelated `await` had run first — which is how the same set previously forced
 * this logic to stay in the stage (Tier 12).
 *
 * Passing the set in makes the dependency an argument the caller cannot forget to satisfy.
 */

/** Whether any of `gateIds` names a framework gate. */
export function containsFrameworkGate(
  gateIds: readonly string[] | null | undefined,
  frameworkGateIds: ReadonlySet<string>
): boolean {
  if (!Array.isArray(gateIds)) {
    return false;
  }
  return gateIds.some((gateId) => Boolean(gateId) && frameworkGateIds.has(gateId));
}

/**
 * Whether a single chain step needs a framework resolved — because its plan says so, or
 * because one of its gates (planned or inline) is a framework gate.
 */
export function stepRequiresFramework(
  step: ChainStepPrompt,
  frameworkGateIds: ReadonlySet<string>
): boolean {
  if (step.executionPlan?.requiresFramework) {
    return true;
  }
  if (containsFrameworkGate(step.executionPlan?.gates, frameworkGateIds)) {
    return true;
  }
  return containsFrameworkGate(step.inlineGateIds, frameworkGateIds);
}

/** Whether any step in a chain needs a framework resolved. */
export function anyStepRequiresFramework(
  steps: readonly ChainStepPrompt[],
  frameworkGateIds: ReadonlySet<string>
): boolean {
  return steps.some((step) => stepRequiresFramework(step, frameworkGateIds));
}

/**
 * Whether a step's own modifiers switch framework guidance off for that step.
 *
 * `clean` suppresses all injection and `lean` keeps gates only, so either one means this step
 * opted out regardless of what the gates would otherwise require.
 */
export function stepHasDisablingModifiers(step: ChainStepPrompt): boolean {
  const modifiers = step.executionPlan?.modifiers;
  if (!modifiers) {
    return false;
  }
  return modifiers.clean === true || modifiers.lean === true;
}

// @lifecycle canonical - Sole owner of the gate enforcement-mode decision.

import type { EnforcementMode, GateSetEnforcement } from './gate-enforcement-types.js';

const STRICTNESS: Readonly<Record<EnforcementMode, number>> = {
  informational: 0,
  advisory: 1,
  blocking: 2,
};

function strictest(modes: readonly EnforcementMode[]): EnforcementMode | undefined {
  return modes.reduce<EnforcementMode | undefined>(
    (acc, mode) => (acc === undefined || STRICTNESS[mode] > STRICTNESS[acc] ? mode : acc),
    undefined
  );
}

/**
 * Resolve the enforcement mode that decides what a FAIL does.
 *
 * In order (P4.137, owner rulings R102 and R107):
 *
 * 1. **The gates that FAILED**, when the verdict named them per gate and the step's gate set is
 *    known. Only those gates decide: all advisory or informational → the run advances; any
 *    blocking → it holds. A failed gate that declares nothing, or that is not in the step's set,
 *    counts as `gateSet.undeclared` — never as advisory.
 * 2. **The configured mode** — what stage 11 published for the step from the same gate set.
 * 3. **The strictest gate on the step**, when only the gate set is known. This is also what a
 *    verdict with no per-gate results (an overall-only object, the legacy string) gets, since
 *    it has no failing-gate set.
 * 4. **`blocking`**: an unstated mode means "not yet relaxed", not "relax".
 *
 * This is a pure function rather than a method on `GateEnforcementAuthority` because the
 * authority is optional on `ExecutionContext`. Reaching it through `context.gateEnforcement?.`
 * would silently yield `undefined` wherever the authority is unwired, turning a missing
 * dependency into a changed enforcement decision.
 *
 * @param configuredMode - Mode from pipeline gate state, or undefined when unset
 * @param gateSet - The step's applying gates and their declared modes, when known
 * @param failedGateIds - Gates the verdict failed by name; empty when it named none
 */
export function resolveEnforcementMode(
  configuredMode?: EnforcementMode,
  gateSet?: GateSetEnforcement,
  failedGateIds: readonly string[] = []
): EnforcementMode {
  const declaredOrDefault = (gateId: string): EnforcementMode =>
    gateSet?.declared.get(gateId) ?? gateSet?.undeclared ?? 'blocking';

  if (gateSet !== undefined && failedGateIds.length > 0) {
    return strictest(failedGateIds.map(declaredOrDefault)) ?? 'blocking';
  }
  if (configuredMode !== undefined) {
    return configuredMode;
  }
  return strictest([...(gateSet?.declared.keys() ?? [])].map(declaredOrDefault)) ?? 'blocking';
}

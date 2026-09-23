// @lifecycle canonical - Sole owner of the gate enforcement-mode decision.

import type { EnforcementMode } from './gate-enforcement-types.js';

/**
 * The gates that apply to the step being reviewed, as their files declare them.
 *
 * `declared` holds one entry per applying gate: its `enforcementMode`, or `undefined` for a gate
 * whose file names none. `undeclared` is what such a gate counts as — the posture the caller
 * already had for the context (a chain step holds, a single prompt advises).
 */
interface GateSetEnforcement {
  readonly declared: ReadonlyArray<EnforcementMode | undefined>;
  readonly undeclared: EnforcementMode;
}

const STRICTNESS: Readonly<Record<EnforcementMode, number>> = {
  informational: 0,
  advisory: 1,
  blocking: 2,
};

/**
 * Resolve the enforcement mode for a set of gates.
 *
 * A mode already configured on the pipeline's gate state wins. Otherwise, when the caller hands
 * over the applying gates, the STRICTEST mode any of them declares decides (P4.137): one blocking
 * gate on a step holds it however many advisory gates share the step, and a gate that declares
 * nothing counts as `gateSet.undeclared`, never as advisory.
 *
 * With neither, gates enforce rather than advise: an unstated mode means "not yet relaxed", not
 * "relax". Callers that want advisory behaviour must say so — through the gate file.
 *
 * This is a pure function rather than a method on `GateEnforcementAuthority` because the
 * authority is optional on `ExecutionContext`. Reaching it through `context.gateEnforcement?.`
 * would silently yield `undefined` wherever the authority is unwired, turning a missing
 * dependency into a changed enforcement decision.
 *
 * @param configuredMode - Mode from pipeline gate state, or undefined when unset
 * @param gateSet - The applying gates' declared modes, when the caller is deciding the mode
 * @returns The configured mode, else the strictest declared mode, else 'blocking'
 */
export function resolveEnforcementMode(
  configuredMode?: EnforcementMode,
  gateSet?: GateSetEnforcement
): EnforcementMode {
  if (configuredMode !== undefined) {
    return configuredMode;
  }
  if (gateSet === undefined || gateSet.declared.length === 0) {
    return 'blocking';
  }
  return gateSet.declared
    .map((mode) => mode ?? gateSet.undeclared)
    .reduce((strictest, mode) => (STRICTNESS[mode] > STRICTNESS[strictest] ? mode : strictest));
}

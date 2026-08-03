// @lifecycle canonical - Sole owner of the gate enforcement-mode default.

import type { EnforcementMode } from './gate-enforcement-types.js';

/**
 * Resolve the enforcement mode for a set of gates.
 *
 * A gate configuration may leave the mode unset — either because the prompt did not
 * declare one or because no enhancement stage reached the point of assigning one. In
 * that case gates enforce rather than advise: an unstated mode means "not yet relaxed",
 * not "relax". Callers that want advisory behaviour must say so.
 *
 * This is a pure function rather than a method on `GateEnforcementAuthority` because the
 * authority is optional on `ExecutionContext`. Reaching it through `context.gateEnforcement?.`
 * would silently yield `undefined` wherever the authority is unwired, turning a missing
 * dependency into a changed enforcement decision.
 *
 * @param configuredMode - Mode from pipeline gate state, or undefined when unset
 * @returns The configured mode, or 'blocking' when none was configured
 */
export function resolveEnforcementMode(configuredMode?: EnforcementMode): EnforcementMode {
  return configuredMode ?? 'blocking';
}

// @lifecycle canonical - Leaf-level gate primitive types (no barrel imports).
/**
 * Gate Primitives
 *
 * Primitive type definitions extracted from gates/types.ts to break the
 * circular dependency: types.ts → types/index.ts → gate-guide-types.ts → types.ts.
 *
 * Both gates/types.ts and types/gate-guide-types.ts import from this leaf file
 * instead of from each other.
 *
 * IMPORTANT: This file must NOT import from ../types.ts or ./index.ts.
 */

/**
 * Gate enforcement mode determines behavior on validation failure.
 * - blocking: Execution pauses until gate criteria are met (default for critical)
 * - advisory: Logs warning but allows advancement (default for high/medium)
 * - informational: Logs only, no user impact (default for low)
 */
export type GateEnforcementMode = 'blocking' | 'advisory' | 'informational';

/**
 * Gate severity levels for prioritization
 */
export type GateSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Default mapping from severity to enforcement mode
 */
export const SEVERITY_TO_ENFORCEMENT: Record<GateSeverity, GateEnforcementMode> = {
  critical: 'blocking',
  high: 'advisory',
  medium: 'advisory',
  low: 'informational',
};

/**
 * Pass/fail criteria for validation.
 *
 * Re-exported from `GatePassCriteriaSchema` (`../core/gate-schema.js`), not re-declared: the
 * schema is what `validateGateSchema` parses a `gate.yaml` with, so a hand-written twin here
 * could only agree with it by hand — and did not, until row 1.5 had to strip the same six
 * pattern/length fields from both. The type-only import keeps this file a leaf at runtime, and
 * `gate-schema.ts` depends on nothing in `../types.ts` or `./index.ts`, so the cycle this file
 * exists to break stays broken.
 *
 * `.passthrough()` puts an `unknown` index signature on the type: a field the schema does not
 * declare is reachable only as `criteria['field']`, which is what keeps a field that a runner
 * actually reads declared in the schema where the validator can see it. `GatePassCriteriaYaml`
 * is the schema's input side — see its own note for why that, and not the parsed output.
 */
export type { GatePassCriteriaYaml as GatePassCriteria } from '../core/gate-schema.js';

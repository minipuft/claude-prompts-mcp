// @lifecycle canonical - Top-level gate type definitions.
/**
 * Gate System Type Definitions
 *
 * Consolidated types for the gate validation system, including lightweight gates,
 * enhanced validation, and gate orchestration. Combines types from multiple gate
 * system implementations into a unified type system.
 *
 * Registry-based gate guide types are exported from ./types/ subfolder.
 */
/**
 * Gate type enumeration
 * - VALIDATION: Runs validation checks against content
 * - GUIDANCE: Only provides instructional text, no validation
 */
export var GateType;
(function (GateType) {
    GateType["VALIDATION"] = "validation";
    GateType["GUIDANCE"] = "guidance";
})(GateType || (GateType = {}));
/**
 * Default mapping from severity to enforcement mode
 */
export const SEVERITY_TO_ENFORCEMENT = {
    critical: 'blocking',
    high: 'advisory',
    medium: 'advisory',
    low: 'informational',
};
//# sourceMappingURL=types.js.map
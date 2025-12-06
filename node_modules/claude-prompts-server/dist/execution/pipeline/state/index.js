// @lifecycle canonical - Pipeline state management public API.
//
// This module provides per-request state accumulation for the execution pipeline:
// - GateAccumulator: Collect gates from all sources, deduplicate by priority
// - DiagnosticAccumulator: Collect warnings/errors for debugging
//
// For decision authorities (FrameworkDecisionAuthority, GateEnforcementAuthority,
// InjectionDecisionService), see ../decisions/index.js
export { GATE_SOURCE_PRIORITY } from './types.js';
// Accumulators
export { GateAccumulator, DiagnosticAccumulator } from './accumulators/index.js';
//# sourceMappingURL=index.js.map
// @lifecycle canonical - Pipeline state types for accumulators.
/**
 * Priority levels for conflict resolution.
 * Higher number = higher priority (wins in conflicts).
 *
 * Priority order (highest to lowest):
 * 1. inline-operator (100) - User explicitly typed :: "criteria"
 * 2. client-selection (90) - User chose in judge phase
 * 3. temporary-request (80) - User-provided gate spec via MCP
 * 4. prompt-config (60) - Prompt author's configured gates
 * 5. chain-level (50) - Chain's finalValidation configuration
 * 6. methodology (40) - Framework methodology gates
 * 7. registry-auto (20) - GateManager.selectGates() activation rules - lowest
 */
export const GATE_SOURCE_PRIORITY = {
    'inline-operator': 100, // Explicit user intent - highest
    'client-selection': 90, // User chose in judge phase
    'temporary-request': 80, // User-provided gate spec
    'prompt-config': 60, // Prompt author's intent
    'chain-level': 50, // Chain configuration
    methodology: 40, // Framework-derived
    'registry-auto': 20, // GateManager.selectGates() activation rules - lowest
};
//# sourceMappingURL=types.js.map
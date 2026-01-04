// @lifecycle canonical - Barrel exports for gate registry module.
/**
 * Gate Registry Module
 *
 * Provides registry-based lifecycle management for gate guides,
 * mirroring the framework system's MethodologyRegistry pattern.
 */
// Gate Registry - Lifecycle management
export { GateRegistry, createGateRegistry } from './gate-registry.js';
// Generic Gate Guide - Data-driven IGateGuide implementation
export { GenericGateGuide, createGenericGateGuide } from './generic-gate-guide.js';
// GateManager adapter for legacy loader contract
export { GateManagerProvider } from './gate-provider-adapter.js';
//# sourceMappingURL=index.js.map
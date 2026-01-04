/**
 * Gate Registry Module
 *
 * Provides registry-based lifecycle management for gate guides,
 * mirroring the framework system's MethodologyRegistry pattern.
 */
export { GateRegistry, createGateRegistry, type GateRegistryConfig } from './gate-registry.js';
export { GenericGateGuide, createGenericGateGuide } from './generic-gate-guide.js';
export { GateManagerProvider } from './gate-provider-adapter.js';

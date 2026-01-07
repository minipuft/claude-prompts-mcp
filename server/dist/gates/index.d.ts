/**
 * Gate System - Core Implementation
 *
 * The gate system provides validation and guidance capabilities for prompt execution.
 * This is the main gate system implementation.
 *
 * Registry-based architecture:
 * - GateRegistry: Lifecycle management for gate guides
 * - GenericGateGuide: Data-driven IGateGuide implementation
 * - GateManager: Orchestration layer (Phase 4)
 * - GateHotReloadCoordinator: Hot reload support (Phase 4)
 */
export * from './core/index.js';
export * from './registry/index.js';
export { type IGateService, type GateEnhancementResult, type GateValidationResult as ServiceGateValidationResult, type GateServiceConfig, CompositionalGateService, SemanticGateService, GateServiceFactory, GateReferenceResolver, } from './services/index.js';
export * from './types/index.js';
export { GateManager, createGateManager, type GateManagerConfig } from './gate-manager.js';
export * from './hot-reload/index.js';
export * from './shell/index.js';

// @lifecycle canonical - Top-level gate system exports.
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

// Export core gate system as primary interface
export * from './core/index.js';

// Export registry-based architecture (Phase 3)
export * from './registry/index.js';

// Export gate services (Phase 3)
export {
  type IGateService,
  type GateEnhancementResult,
  type GateValidationResult as ServiceGateValidationResult,
  type GateServiceConfig,
  CompositionalGateService,
  SemanticGateService,
  GateServiceFactory,
  GateReferenceResolver,
} from './services/index.js';

// Export gate guide types (Phase 1)
export * from './types/index.js';

// Export GateManager orchestration layer (Phase 4)
export { GateManager, createGateManager, type GateManagerConfig } from './gate-manager.js';

// Export hot reload coordinator (Phase 4)
export * from './hot-reload/index.js';

// Export shell verification types (Ralph Wiggum loops)
export * from './shell/index.js';

// @lifecycle canonical - Barrel exports for gate service implementations.
export type {
  IGateService,
  GateEnhancementResult,
  GateValidationResult,
  GateServiceConfig,
} from './gate-service-interface.js';

export { CompositionalGateService } from './compositional-gate-service.js';
export { SemanticGateService } from './semantic-gate-service.js';
export { GateServiceFactory } from './gate-service-factory.js';
export { GateReferenceResolver } from './gate-reference-resolver.js';

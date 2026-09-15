// @lifecycle canonical - Barrel exports for gate guide types.
/**
 * Gate Types Module
 *
 * Exports all gate guide types and interfaces for the registry-based
 * gate system architecture.
 */

// Core interface and types
export type {
  GateGuide,
  GateActivationRules,
  GateActivationContext,
  GateDefinitionYaml,
  LoadedGateDefinition,
  GateRetryConfig,
} from './gate-guide-types.js';

// Registry types
export type { GateSource, GateGuideEntry, GateRegistryStats } from './gate-guide-types.js';

// Selection types
export type { GateSelectionContext, GateSelectionResult } from './gate-guide-types.js';

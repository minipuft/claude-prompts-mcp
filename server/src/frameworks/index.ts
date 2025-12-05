// @lifecycle canonical - Barrel exports for framework orchestration modules.
/**
 * Framework System (Methodology System Reorganization)
 * Streamlined framework system with consolidated type definitions,
 * organized methodology system, and framework behavior guidance
 */

// Consolidated type definitions ( NEW)
export * from './types/index.js';

// Methodology system (NEW)
export * from './methodology/index.js';

// Framework managers (stateless orchestration and stateful management)
export * from './framework-manager.js';
export * from './framework-state-manager.js';

// Framework system components (stateful methodology switching)
export * from './integration/index.js';

// Prompt guidance system (NEW)
export * from './prompt-guidance/index.js';

// Methodology guides exported from ./methodology/ (single source of truth)
// Legacy adapters directory removed - no duplication

// Framework utilities (shared helpers)
export * from './utils/index.js';

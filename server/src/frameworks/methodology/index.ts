// @lifecycle canonical - Barrel exports for methodology registry and guides.
/**
 * Methodology System Index - Phase 2 Implementation
 *
 * Centralized exports for the reorganized methodology system.
 * Provides clean imports for methodology guides, registry, and interfaces.
 */

// Export methodology registry
export { MethodologyRegistry, createMethodologyRegistry } from "./registry.js";
export type { MethodologyRegistryConfig, MethodologyGuideEntry } from "./registry.js";

// Export methodology interfaces
export * from "./interfaces.js";

// Export methodology guides from new location
export { CAGEERFMethodologyGuide } from "./guides/cageerf-guide.js";
export { ReACTMethodologyGuide } from "./guides/react-guide.js";
export { FiveW1HMethodologyGuide } from "./guides/5w1h-guide.js";
export { SCAMPERMethodologyGuide } from "./guides/scamper-guide.js";

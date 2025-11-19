// @lifecycle canonical - Barrel exports for the prompt guidance subsystem.
/**
 * Prompt Guidance System Index - Phase 3 Implementation
 *
 * Central exports for the prompt guidance system that provides intelligent
 * methodology integration for MCP prompts.
 *
 * The prompt guidance system consists of three core components:
 * - SystemPromptInjector: Injects methodology guidance into system prompts
 * - MethodologyTracker: Tracks active methodology state and handles switching
 * - TemplateEnhancer: Enhances user templates with methodology-specific guidance
 */

// Core prompt guidance components
export {
  SystemPromptInjector,
  createSystemPromptInjector,
  type SystemPromptInjectorConfig
} from './system-prompt-injector.js';

export {
  MethodologyTracker,
  createMethodologyTracker,
  type MethodologyTrackerConfig,
  type MethodologyTrackerEvents
} from './methodology-tracker.js';

export {
  TemplateEnhancer,
  createTemplateEnhancer,
  type TemplateEnhancerConfig,
  type TemplateEnhancementContext
} from './template-enhancer.js';

// Unified prompt guidance service
export {
  PromptGuidanceService,
  createPromptGuidanceService,
  type PromptGuidanceServiceConfig
} from './service.js';

// Service-specific types (to avoid conflicts with types/index.js)
export type { PromptGuidanceResult as ServicePromptGuidanceResult } from './service.js';

// Re-export relevant types from the types system
export type {
  SystemPromptInjectionResult,
  TemplateEnhancementResult,
  MethodologyState,
  MethodologySwitchRequest,
  MethodologyHealth,
  PersistedMethodologyState,
  TemplateProcessingGuidance,
  PromptGuidanceConfig,
  PromptGuidanceResult
} from '../types/index.js';

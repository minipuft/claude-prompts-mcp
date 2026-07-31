// @lifecycle canonical - Barrel exports for the prompt guidance subsystem.
/**
 * Prompt Guidance System Index
 *
 * Central exports for the prompt guidance system that provides intelligent
 * framework integration for MCP prompts.
 *
 * The prompt guidance system consists of:
 * - PromptGuidanceService: Unified service orchestrating all guidance components
 * - TemplateEnhancer: Enhances user templates with framework-specific guidance
 *
 * Active framework state is read from FrameworkManager (SQLite-backed via FrameworkStateStore).
 */

export {
  TemplateEnhancer,
  createTemplateEnhancer,
  type TemplateEnhancerConfig,
} from './template-enhancer.js';

// Unified prompt guidance service
export {
  PromptGuidanceService,
  createPromptGuidanceService,
  type PromptGuidanceServiceConfig,
} from './service.js';

// Service-specific types (to avoid conflicts with types/index.js)
export type { PromptGuidanceResult as ServicePromptGuidanceResult } from './service.js';

// Re-export relevant types from the types system
export type {
  PromptGuidanceConfig,
  PromptGuidanceResult,
  SystemPromptInjectionResult,
  TemplateProcessingGuidance,
} from '../types/index.js';

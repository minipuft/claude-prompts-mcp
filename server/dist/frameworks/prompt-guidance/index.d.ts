/**
 * Prompt Guidance System Index
 *
 * Central exports for the prompt guidance system that provides intelligent
 * methodology integration for MCP prompts.
 *
 * The prompt guidance system consists of:
 * - PromptGuidanceService: Unified service orchestrating all guidance components
 * - MethodologyTracker: Tracks active methodology state and handles switching
 * - TemplateEnhancer: Enhances user templates with methodology-specific guidance
 *
 * Note: SystemPromptInjector was removed - its functionality is now inlined
 * in PromptGuidanceService.injectMethodologyGuidance()
 */
export { MethodologyTracker, createMethodologyTracker, type MethodologyTrackerConfig, type MethodologyTrackerEvents, } from './methodology-tracker.js';
export { TemplateEnhancer, createTemplateEnhancer, type TemplateEnhancerConfig, } from './template-enhancer.js';
export { PromptGuidanceService, createPromptGuidanceService, type PromptGuidanceServiceConfig, } from './service.js';
export type { PromptGuidanceResult as ServicePromptGuidanceResult } from './service.js';
export type { MethodologyHealth, MethodologyState, MethodologySwitchRequest, PersistedMethodologyState, PromptGuidanceConfig, PromptGuidanceResult, SystemPromptInjectionResult, TemplateProcessingGuidance, } from '../types/index.js';

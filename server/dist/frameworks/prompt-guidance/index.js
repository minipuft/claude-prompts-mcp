// @lifecycle canonical - Barrel exports for the prompt guidance subsystem.
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
// Core prompt guidance components
export { MethodologyTracker, createMethodologyTracker, } from './methodology-tracker.js';
export { TemplateEnhancer, createTemplateEnhancer, } from './template-enhancer.js';
// Unified prompt guidance service
export { PromptGuidanceService, createPromptGuidanceService, } from './service.js';
//# sourceMappingURL=index.js.map
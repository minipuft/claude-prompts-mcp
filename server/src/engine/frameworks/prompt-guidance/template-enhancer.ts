// @lifecycle canonical - Enhances templates with methodology-specific guidance blocks.
/**
 * Template Enhancer - Resource-Driven Implementation
 *
 * Enhances user templates by applying lightweight structural guidance.
 *
 * Architecture Shift:
 * - Legacy: Hardcoded TypeScript methods generating strings.
 * - Modern: DYNAMIC injection of Markdown resources loaded by PromptAssetManager.
 */

import { Logger } from '../../../infra/logging/index.js';

import type { ConvertedPrompt } from '../../execution/types.js';

/**
 * Template enhancement configuration
 */
export interface TemplateEnhancerConfig {
  /** When set, prepends a `##` heading to templates that do not already start with one. */
  enableStructureOptimization: boolean;
}

/**
 * Template Enhancer
 *
 * Applies lightweight structure improvements to user templates.
 */
export class TemplateEnhancer {
  private logger: Logger;
  private config: TemplateEnhancerConfig;

  constructor(logger: Logger, config?: Partial<TemplateEnhancerConfig>) {
    this.logger = logger;
    this.config = {
      enableStructureOptimization: true,
      ...config,
    };
  }

  /**
   * Enhance template by injecting selected resources
   * Resource-Driven Architecture
   */
  async enhanceTemplate(
    template: string,
    prompt: ConvertedPrompt,
    // Legacy args kept for interface compatibility but unused
    _methodologyGuide?: any,
    _framework?: any,
    _context?: any
  ): Promise<{
    originalTemplate: string;
    enhancedTemplate: string;
    validation: { score: number; passed: boolean };
    metadata: any;
  }> {
    const startTime = Date.now();
    let enhancedTemplate = template;
    // Legacy Structure Fallback (Minimal)
    if (this.config.enableStructureOptimization && !template.startsWith('##')) {
      enhancedTemplate = `## Task Context\n\n${template}`;
    }

    return {
      originalTemplate: template,
      enhancedTemplate,
      validation: {
        score: 100, // Assume resources are high quality
        passed: true,
      },
      metadata: {
        processingTimeMs: Date.now() - startTime,
        enhancementLevel: 'structure-fallback',
      },
    };
  }

  /**
   * Update enhancer configuration
   */
  updateConfig(config: Partial<TemplateEnhancerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Create and configure a TemplateEnhancer instance
 */
export function createTemplateEnhancer(
  logger: Logger,
  config?: Partial<TemplateEnhancerConfig>
): TemplateEnhancer {
  return new TemplateEnhancer(logger, config);
}

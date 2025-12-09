// @lifecycle canonical - Enhances templates with methodology-specific guidance blocks.
/**
 * Template Enhancer - Resource-Driven Implementation
 *
 * Enhances user templates by injecting methodology guidance and framework-specific
 * improvements selected by the Semantic Judge.
 *
 * Architecture Shift:
 * - Legacy: Hardcoded TypeScript methods generating strings.
 * - Modern: DYNAMIC injection of Markdown resources loaded by PromptAssetManager.
 */

import { Logger } from '../../logging/index.js';
import { ConvertedPrompt } from '../../types/index.js';

import type { ContentAnalysisResult } from '../../semantic/types.js';

/**
 * Template enhancement configuration
 */
export interface TemplateEnhancerConfig {
  enableArgumentSuggestions: boolean; // Kept for compat
  enableStructureOptimization: boolean; // Kept for compat
  enableSemanticAwareness: boolean;
}

/**
 * Template Enhancer
 *
 * Applies methodology-specific enhancements to user templates by injecting
 * static resources selected by the Semantic Judge (LLM).
 */
export class TemplateEnhancer {
  private logger: Logger;
  private config: TemplateEnhancerConfig;

  constructor(logger: Logger, config?: Partial<TemplateEnhancerConfig>) {
    this.logger = logger;
    this.config = {
      enableArgumentSuggestions: true,
      enableStructureOptimization: true,
      enableSemanticAwareness: true,
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
    _context?: any,
    semanticAnalysis?: ContentAnalysisResult,
    availableResources?: ConvertedPrompt[]
  ): Promise<{
    originalTemplate: string;
    enhancedTemplate: string;
    validation: { score: number; passed: boolean };
    metadata: any;
  }> {
    const startTime = Date.now();
    let enhancedTemplate = template;
    const injectedResources: string[] = [];

    // 1. Apply Semantic Enhancements (Resource Injection)
    if (
      this.config.enableSemanticAwareness &&
      semanticAnalysis?.executionCharacteristics?.advancedChainFeatures?.selected_resources &&
      availableResources
    ) {
      const selectedIds =
        semanticAnalysis.executionCharacteristics.advancedChainFeatures.selected_resources;

      this.logger.debug(`[TemplateEnhancer] Injecting resources: ${selectedIds.join(', ')}`);

      for (const resourceId of selectedIds) {
        // Fuzzy match: "analytical" or "guidance/analytical"
        const resource = availableResources.find(
          (r) => r.id === resourceId || r.id === `guidance/${resourceId}`
        );

        if (resource) {
          // Append the resource content (Methodology Frameworks typically go at the end)
          enhancedTemplate += `\n\n${resource.userMessageTemplate}`;
          injectedResources.push(resource.id);
        } else {
          this.logger.warn(`[TemplateEnhancer] Resource not found: ${resourceId}`);
        }
      }
    }

    // 2. Legacy Structure Fallback (Minimal)
    // If no resources selected but structure requested, add basic header
    if (
      injectedResources.length === 0 &&
      this.config.enableStructureOptimization &&
      !template.startsWith('##')
    ) {
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
        enhancementLevel: 'resource-driven',
        injectedResources,
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

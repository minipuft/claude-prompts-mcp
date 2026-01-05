// @lifecycle canonical - Aggregates gate evaluations across configured services.
import type {
  IGateService,
  GateEnhancementResult,
  GateServiceConfig,
} from './gate-service-interface.js';
import type { Logger } from '../../logging/index.js';
import type { ConvertedPrompt } from '../../types/index.js';
import type { GateContext } from '../core/gate-definitions.js';
import type { GateGuidanceRenderer } from '../guidance/GateGuidanceRenderer.js';

const DEFAULT_CONFIG: GateServiceConfig = {
  enabled: true,
};

/**
 * Compositional Gate Service - Template rendering only (no server-side validation)
 *
 * Simplified to use GateGuidanceRenderer directly, removing the unnecessary
 * GateInstructionInjector abstraction layer.
 */
export class CompositionalGateService implements IGateService {
  readonly serviceType = 'compositional' as const;
  private readonly logger: Logger;
  private readonly gateGuidanceRenderer: GateGuidanceRenderer;
  private config: GateServiceConfig;

  constructor(
    logger: Logger,
    gateGuidanceRenderer: GateGuidanceRenderer,
    config?: Partial<GateServiceConfig>
  ) {
    this.logger = logger;
    this.gateGuidanceRenderer = gateGuidanceRenderer;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async enhancePrompt(
    prompt: ConvertedPrompt,
    gateIds: string[],
    context: GateContext
  ): Promise<GateEnhancementResult> {
    if (!this.config.enabled || gateIds.length === 0) {
      return {
        enhancedPrompt: prompt,
        gateInstructionsInjected: false,
        injectedGateIds: [],
      };
    }

    this.logger.debug('[CompositionalGateService] Rendering gate guidance', {
      promptId: prompt.id,
      gateCount: gateIds.length,
    });

    try {
      const guidanceContext: GateContext = {
        category: context.category ?? prompt.category,
        promptId: context.promptId ?? prompt.id,
      };

      if (context.framework) {
        guidanceContext.framework = context.framework;
      }
      if (context.explicitGateIds) {
        guidanceContext.explicitGateIds = context.explicitGateIds;
      }

      const guidance = await this.gateGuidanceRenderer.renderGuidance(gateIds, guidanceContext);

      if (!guidance || guidance.trim().length === 0) {
        this.logger.debug('[CompositionalGateService] No guidance produced', {
          promptId: prompt.id,
        });
        return {
          enhancedPrompt: prompt,
          gateInstructionsInjected: false,
          injectedGateIds: [],
        };
      }

      const template = prompt.userMessageTemplate ?? '';
      const enhancedTemplate = template.length > 0 ? `${template}\n\n${guidance}` : guidance;

      this.logger.debug('[CompositionalGateService] Gate guidance injected', {
        promptId: prompt.id,
        gateCount: gateIds.length,
        guidanceLength: guidance.length,
      });

      return {
        enhancedPrompt: {
          ...prompt,
          userMessageTemplate: enhancedTemplate,
        },
        gateInstructionsInjected: true,
        injectedGateIds: gateIds,
        instructionLength: guidance.length,
      };
    } catch (error) {
      this.logger.error('[CompositionalGateService] Failed to render gate guidance', {
        error,
        promptId: prompt.id,
        gateIds,
      });
      return {
        enhancedPrompt: prompt,
        gateInstructionsInjected: false,
        injectedGateIds: [],
      };
    }
  }

  supportsValidation(): boolean {
    return false;
  }

  updateConfig(config: Partial<GateServiceConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

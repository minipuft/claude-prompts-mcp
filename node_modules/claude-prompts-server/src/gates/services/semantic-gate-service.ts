// @lifecycle migrating - Semantic scoring service still aligning with new guardrails.
import { CompositionalGateService } from './compositional-gate-service.js';

import type {
  IGateService,
  GateEnhancementResult,
  GateServiceConfig,
  GateValidationResult,
} from './gate-service-interface.js';
import type { Logger } from '../../logging/index.js';
import type { ConvertedPrompt } from '../../types/index.js';
import type { GateContext } from '../core/gate-definitions.js';
import type { GateValidator } from '../core/gate-validator.js';
import type { GateGuidanceRenderer } from '../guidance/GateGuidanceRenderer.js';

const DEFAULT_SEMANTIC_CONFIG: GateServiceConfig = {
  enabled: true,
  llmIntegration: {
    enabled: false,
    model: 'default',
    maxTokens: 2048,
    temperature: 0.2,
  },
};

/**
 * Semantic Gate Service - Template rendering + server-side validation (future work)
 */
export class SemanticGateService implements IGateService {
  readonly serviceType = 'semantic' as const;
  private readonly logger: Logger;
  private readonly gateValidator: GateValidator;
  private readonly compositionalService: CompositionalGateService;
  private config: GateServiceConfig;

  constructor(
    logger: Logger,
    gateGuidanceRenderer: GateGuidanceRenderer,
    gateValidator: GateValidator,
    config?: Partial<GateServiceConfig>
  ) {
    this.logger = logger;
    this.gateValidator = gateValidator;
    this.config = { ...DEFAULT_SEMANTIC_CONFIG, ...config };
    this.compositionalService = new CompositionalGateService(
      logger,
      gateGuidanceRenderer,
      this.config
    );
  }

  async enhancePrompt(
    prompt: ConvertedPrompt,
    gateIds: string[],
    context: GateContext
  ): Promise<GateEnhancementResult> {
    const compositionalResult = await this.compositionalService.enhancePrompt(
      prompt,
      gateIds,
      context
    );

    if (!this.config.llmIntegration?.enabled) {
      return compositionalResult;
    }

    try {
      const validationResults = await this.performSemanticValidation(
        compositionalResult.enhancedPrompt,
        gateIds,
        context
      );

      return {
        ...compositionalResult,
        validationResults,
      };
    } catch (error) {
      this.logger.error(
        '[SemanticGateService] Semantic validation failed – degrading to compositional',
        { error }
      );
      return compositionalResult;
    }
  }

  supportsValidation(): boolean {
    return this.config.llmIntegration?.enabled ?? false;
  }

  updateConfig(config: Partial<GateServiceConfig>): void {
    this.config = { ...this.config, ...config };
    this.compositionalService.updateConfig(this.config);
  }

  private async performSemanticValidation(
    _prompt: ConvertedPrompt,
    gateIds: string[],
    _context: GateContext
  ): Promise<GateValidationResult[]> {
    // TODO: Implement once third-party LLM integration is available.
    this.logger.warn(
      '[SemanticGateService] Semantic validation requested but not yet implemented',
      {
        gateIds,
        llmEnabled: this.config.llmIntegration?.enabled,
      }
    );

    throw new Error('Semantic validation not yet implemented');
  }
}

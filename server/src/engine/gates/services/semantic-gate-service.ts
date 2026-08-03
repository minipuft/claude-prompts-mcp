// @lifecycle migrating - Semantic scoring service still aligning with new guardrails.
import { CompositionalGateService } from './compositional-gate-service.js';

import type { Logger } from '#infra/logging/index.js';
import type {
  GateService,
  GateEnhancementResult,
  GateServiceConfig,
  GateValidationResult,
} from './gate-service-interface.js';
import type { ConvertedPrompt } from '../../execution/types.js';
import type { GateContext } from '../core/gate-definitions.js';
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
 * Semantic Gate Service - Template rendering.
 *
 * Server-side validation is still unimplemented. A `GateValidator` used to be
 * injected here for it and was never called; the seam was removed rather than
 * kept as speculative wiring, since re-adding a constructor argument when the
 * validation actually lands is a smaller cost than a dependency that lies about
 * what this service does.
 */
export class SemanticGateService implements GateService {
  readonly serviceType = 'semantic' as const;
  private readonly logger: Logger;
  private readonly compositionalService: CompositionalGateService;
  private config: GateServiceConfig;

  constructor(
    logger: Logger,
    gateGuidanceRenderer: GateGuidanceRenderer,
    config?: Partial<GateServiceConfig>
  ) {
    this.logger = logger;
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

// @lifecycle canonical - Aggregates gate evaluations across configured services.
import {
  GateInstructionInjector,
  type GateInstructionEnhancedPrompt,
  type GateInstructionInjectorConfig,
} from '../guidance/gate-instruction-injector.js';

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
 */
export class CompositionalGateService implements IGateService {
  readonly serviceType = 'compositional' as const;
  private readonly gateInstructionInjector: GateInstructionInjector;
  private config: GateServiceConfig;

  constructor(
    logger: Logger,
    gateGuidanceRenderer: GateGuidanceRenderer,
    config?: Partial<GateServiceConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.gateInstructionInjector = new GateInstructionInjector(
      logger,
      gateGuidanceRenderer,
      this.toInjectorConfig(this.config)
    );
  }

  async enhancePrompt(
    prompt: ConvertedPrompt,
    gateIds: string[],
    context: GateContext
  ): Promise<GateEnhancementResult> {
    const enhanced: GateInstructionEnhancedPrompt =
      await this.gateInstructionInjector.injectGateInstructions(prompt, gateIds, context);

    return {
      enhancedPrompt: enhanced,
      gateInstructionsInjected: enhanced.gateInstructionsInjected ?? false,
      injectedGateIds: enhanced.injectedGateIds ?? [],
      instructionLength: enhanced.gateInstructionLength,
    };
  }

  supportsValidation(): boolean {
    return false;
  }

  updateConfig(config: Partial<GateServiceConfig>): void {
    this.config = { ...this.config, ...config };
    this.gateInstructionInjector.updateConfig(this.toInjectorConfig(this.config));
  }

  private toInjectorConfig(config: GateServiceConfig): Partial<GateInstructionInjectorConfig> {
    return {
      enabled: config.enabled,
    };
  }
}

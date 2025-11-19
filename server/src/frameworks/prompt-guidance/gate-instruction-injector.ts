// @lifecycle canonical - Injects consistent gate instructions into prompt guidance flows.
/**
 * Gate Instruction Injector
 *
 * Provides a pure compositional layer for gate guidance injection, mirroring
 * the behavior of the system prompt injector. No execution coupling.
 */
import { Logger } from '../../logging/index.js';

import type { GateContext } from '../../gates/core/gate-definitions.js';
import type { GateGuidanceRenderer } from '../../gates/guidance/GateGuidanceRenderer.js';
import type { ConvertedPrompt } from '../../types/index.js';

/**
 * Configuration for gate instruction injection behavior.
 */
export interface GateInstructionInjectorConfig {
  enabled: boolean;
}

const DEFAULT_CONFIG: GateInstructionInjectorConfig = {
  enabled: true,
};

/**
 * Context for gate instruction injection. Extends renderer context while
 * capturing additional execution metadata for observability.
 */
export interface GateInjectionContext extends GateContext {
  previousAttempts?: number;
  previousFeedback?: string;
  executionType?: string;
}

/**
 * Metadata applied to prompts that have gate instructions appended.
 */
export interface GateInstructionMetadata {
  gateInstructionsInjected?: boolean;
  injectedGateIds?: string[];
  gateInstructionContext?: GateInjectionContext;
  gateInstructionLength?: number;
}

export type GateInstructionEnhancedPrompt = ConvertedPrompt & GateInstructionMetadata;

/**
 * Gate instruction injector responsible for pure template composition.
 */
export class GateInstructionInjector {
  private readonly logger: Logger;
  private readonly gateGuidanceRenderer: GateGuidanceRenderer;
  private config: GateInstructionInjectorConfig;

  constructor(
    logger: Logger,
    gateGuidanceRenderer: GateGuidanceRenderer,
    config?: Partial<GateInstructionInjectorConfig>
  ) {
    this.logger = logger;
    this.gateGuidanceRenderer = gateGuidanceRenderer;
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  /**
   * Inject gate instructions into the provided prompt template. Returns a new
   * prompt object when injection occurs; otherwise the original prompt is returned.
   */
  async injectGateInstructions(
    prompt: ConvertedPrompt,
    gateIds: string[],
    context: GateInjectionContext = {}
  ): Promise<GateInstructionEnhancedPrompt> {
    if (!this.config.enabled || gateIds.length === 0) {
      return prompt;
    }

    const template = prompt.userMessageTemplate ?? '';

    this.logger.debug('[GateInstructionInjector] Injecting gate instructions', {
      promptId: prompt.id,
      gateIds,
    });

    try {
      const renderContext: GateContext = {
        framework: context.framework,
        category: context.category ?? prompt.category,
        promptId: context.promptId ?? prompt.id,
      };

      const rawGuidance = await this.gateGuidanceRenderer.renderGuidance(gateIds, renderContext);

      if (!rawGuidance || rawGuidance.trim().length === 0) {
        this.logger.debug('[GateInstructionInjector] No guidance produced, skipping injection', {
          promptId: prompt.id,
          gateIds,
        });
        return prompt;
      }

      const enhancedTemplate = this.appendInstructions(template, rawGuidance);

      this.logger.debug('[GateInstructionInjector] Injected gate instructions', {
        promptId: prompt.id,
        gateCount: gateIds.length,
        instructionLength: rawGuidance.length,
      });

      return {
        ...prompt,
        userMessageTemplate: enhancedTemplate,
        gateInstructionsInjected: true,
        injectedGateIds: gateIds,
        gateInstructionContext: context,
        gateInstructionLength: rawGuidance.length,
      };
    } catch (error) {
      this.logger.error('[GateInstructionInjector] Failed to inject gate instructions', {
        error,
        promptId: prompt.id,
        gateIds,
      });
      return prompt;
    }
  }

  private appendInstructions(template: string, instructions: string): string {
    const prefix = template.length > 0 ? `${template}\n\n` : '';
    return `${prefix}${instructions}`;
  }

  updateConfig(config: Partial<GateInstructionInjectorConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }
}

export function createGateInstructionInjector(
  logger: Logger,
  gateGuidanceRenderer: GateGuidanceRenderer,
  config?: Partial<GateInstructionInjectorConfig>
): GateInstructionInjector {
  return new GateInstructionInjector(logger, gateGuidanceRenderer, config);
}

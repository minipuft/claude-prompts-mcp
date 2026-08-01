// @lifecycle canonical - Collects available resources (styles, frameworks, gates) for judge selection.
import type { Logger } from '../../../infra/logging/index.js';
import type { StyleManagerPort } from '../../../shared/types/index.js';
import type { ConvertedPrompt } from '../../execution/types.js';
import type { GateDefinitionProvider } from '../../gates/core/gate-loader.js';
import type { LightweightGateDefinition } from '../../gates/types.js';

/**
 * Collected resources organized by category for the judge menu.
 */
export interface ResourceMenu {
  styles: ConvertedPrompt[];
  frameworks: ConvertedPrompt[];
  gates: LightweightGateDefinition[];
}

/**
 * Provider function to get all converted prompts.
 */
type PromptsProvider = () => ConvertedPrompt[];

/**
 * Provider for framework resources (derived from framework definitions).
 */
type FrameworkResourceProvider = () => Promise<ConvertedPrompt[]> | ConvertedPrompt[];

/**
 * Collects all available resources from styles, frameworks, and gates
 * for the judge selection menu.
 *
 * Extracted from JudgeSelectionStage (pipeline stage 06a).
 */
export class JudgeResourceCollector {
  constructor(
    private readonly promptsProvider: PromptsProvider | null,
    private readonly gateLoader: GateDefinitionProvider | null,
    private readonly logger: Logger,
    private readonly frameworksProvider?: FrameworkResourceProvider | null,
    private readonly styleManager?: StyleManagerPort | null
  ) {}

  /**
   * Collect all available resources from styles, frameworks, and gates.
   */
  async collectAllResources(): Promise<ResourceMenu> {
    const styles = await this.loadAllStyles();
    const frameworks = await this.collectFrameworkResources();
    const gates = await this.loadAllGates();

    return { styles, frameworks, gates };
  }

  private async loadAllStyles(): Promise<ConvertedPrompt[]> {
    if (!this.styleManager) {
      const allPrompts = this.promptsProvider?.() ?? [];
      const guidancePrompts = allPrompts.filter((p) => p.category === 'guidance');
      return guidancePrompts.filter((p) => !this.isFrameworkPromptId(p.id));
    }

    try {
      const styleIds = this.styleManager.listStyles();
      return styleIds.map((id) => {
        const style = this.styleManager!.getStyle(id);
        return {
          id,
          name: style?.name ?? id,
          description: style?.description ?? '',
          category: 'style',
          userMessageTemplate: '',
          arguments: [],
        };
      });
    } catch (error) {
      this.logger.warn('[JudgeResourceCollector] Failed to load styles from StyleManager:', error);
      return [];
    }
  }

  private isFrameworkPromptId(id: string): boolean {
    const normalized = id.toLowerCase();
    return (
      normalized.includes('cageerf') ||
      normalized.includes('react') ||
      normalized.includes('5w1h') ||
      normalized.includes('scamper')
    );
  }

  private async collectFrameworkResources(): Promise<ConvertedPrompt[]> {
    if (!this.frameworksProvider) {
      return [];
    }

    try {
      const provided = await this.frameworksProvider();
      return Array.isArray(provided) ? provided : [];
    } catch (error) {
      this.logger.warn('[JudgeResourceCollector] Framework provider failed', { error });
      return [];
    }
  }

  private async loadAllGates(): Promise<LightweightGateDefinition[]> {
    if (!this.gateLoader) {
      return [];
    }

    try {
      return await this.gateLoader.listAvailableGateDefinitions();
    } catch (error) {
      this.logger.warn('[JudgeResourceCollector] Failed to load gates:', error);
      return [];
    }
  }
}

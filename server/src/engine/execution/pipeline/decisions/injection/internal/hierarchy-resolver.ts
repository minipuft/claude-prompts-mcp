// @lifecycle canonical - Hierarchical resolution for injection configuration.

import { DEFAULT_CONFIG_BY_TYPE, RESOLUTION_PRIORITY } from '../constants.js';

import type { Logger } from '#infra/logging/index.js';
import type {
  CategoryInjectionConfig,
  ChainInjectionConfig,
  InjectionConfig,
  InjectionDecisionInput,
  InjectionDecisionSource,
  InjectionRuntimeOverride,
  InjectionType,
  InjectionTypeConfig,
  PromptInjectionRule,
  ResolvedInjectionConfig,
  StepInjectionConfig,
} from '../types.js';

/**
 * Resolves injection configuration from hierarchical sources.
 *
 * Resolution priority (highest to lowest):
 * 1. Runtime overrides (from system_control)
 * 2. Step config (step-specific rules)
 * 3. Prompt config (the prompt's own `injection` block)
 * 4. Chain config (chain-level rules)
 * 5. Category config (category-level rules)
 * 6. Global config (config.json defaults)
 * 7. System defaults (hardcoded fallbacks)
 *
 * Prompt sits above chain and below step: a prompt's declaration about itself outranks the
 * chain or category it happens to run inside, while a chain author's step-targeted rule is
 * the more specific statement about this particular execution and still wins.
 *
 * Note: Modifiers (%clean, %lean) are NOT handled here.
 * They are checked first by InjectionDecisionService before
 * consulting the resolver.
 */
export class HierarchyResolver {
  constructor(
    private readonly config: InjectionConfig,
    private readonly logger: Logger
  ) {}

  /**
   * Resolve the effective configuration for an injection type.
   * Walks the hierarchy from most specific to least specific.
   */
  resolve(
    injectionType: InjectionType,
    input: InjectionDecisionInput,
    runtimeOverride?: InjectionRuntimeOverride
  ): ResolvedInjectionConfig {
    const resolutionPath: InjectionDecisionSource[] = [];

    // Priority 1: Runtime override
    if (runtimeOverride && this.isOverrideApplicable(runtimeOverride, input)) {
      resolutionPath.push('runtime-override');

      this.logger.debug('[HierarchyResolver] Using runtime override', {
        type: injectionType,
        enabled: runtimeOverride.enabled,
        target: runtimeOverride.target,
      });

      const defaultConfig = DEFAULT_CONFIG_BY_TYPE[injectionType];
      const runtimeConfig: InjectionTypeConfig = {
        enabled: runtimeOverride.enabled ?? true,
      };

      const frequency =
        this.getFrequencyFromHierarchy(injectionType, input, resolutionPath) ??
        defaultConfig.frequency;
      if (frequency) {
        runtimeConfig.frequency = frequency;
      }

      const target =
        runtimeOverride.target ??
        this.getTargetFromHierarchy(injectionType, input) ??
        defaultConfig.target ??
        'both';
      if (target) {
        runtimeConfig.target = target;
      }

      return {
        config: runtimeConfig,
        source: 'runtime-override',
        resolutionPath,
      };
    }

    // Priority 2: Step config
    const stepConfig = this.findStepConfig(injectionType, input);
    if (stepConfig) {
      resolutionPath.push('step-config');

      this.logger.debug('[HierarchyResolver] Using step config', {
        type: injectionType,
        stepTarget: stepConfig.stepTarget,
      });

      return {
        config: this.mergeWithDefaults(injectionType, stepConfig[injectionType]),
        source: 'step-config',
        resolutionPath,
      };
    }

    // Priority 3: Prompt config (the prompt's own declaration about itself)
    const promptConfig = this.findPromptConfig(injectionType, input);
    if (promptConfig !== undefined) {
      resolutionPath.push('prompt-config');

      this.logger.debug('[HierarchyResolver] Using prompt config', {
        type: injectionType,
        promptId: input.promptId,
      });

      return {
        config: this.mergeWithDefaults(injectionType, promptConfig),
        source: 'prompt-config',
        resolutionPath,
      };
    }

    // Priority 4: Chain config
    const chainConfig = this.findChainConfig(injectionType, input);
    if (chainConfig) {
      resolutionPath.push('chain-config');

      this.logger.debug('[HierarchyResolver] Using chain config', {
        type: injectionType,
        chainPattern: chainConfig.chainPattern,
      });

      return {
        config: this.mergeWithDefaults(injectionType, chainConfig[injectionType]),
        source: 'chain-config',
        resolutionPath,
      };
    }

    // Priority 5: Category config
    const categoryConfig = this.findCategoryConfig(injectionType, input);
    if (categoryConfig) {
      resolutionPath.push('category-config');

      this.logger.debug('[HierarchyResolver] Using category config', {
        type: injectionType,
        categoryId: categoryConfig.categoryId,
      });

      return {
        config: this.mergeWithDefaults(injectionType, categoryConfig[injectionType]),
        source: 'category-config',
        resolutionPath,
      };
    }

    // Priority 6: Global config
    const globalConfig = this.config[injectionType];
    if (globalConfig) {
      resolutionPath.push('global-config');

      this.logger.debug('[HierarchyResolver] Using global config', {
        type: injectionType,
      });

      return {
        config: this.mergeWithDefaults(injectionType, globalConfig),
        source: 'global-config',
        resolutionPath,
      };
    }

    // Priority 7: System defaults
    resolutionPath.push('system-default');

    this.logger.debug('[HierarchyResolver] Using system defaults', {
      type: injectionType,
    });

    return {
      config: DEFAULT_CONFIG_BY_TYPE[injectionType],
      source: 'system-default',
      resolutionPath,
    };
  }

  /**
   * Check if a runtime override applies to the current input.
   */
  private isOverrideApplicable(
    override: InjectionRuntimeOverride,
    input: InjectionDecisionInput
  ): boolean {
    // Check expiration
    if (override.expiresAt && Date.now() > override.expiresAt) {
      return false;
    }

    switch (override.scope) {
      case 'session':
        // Session-level overrides always apply
        return true;

      case 'chain':
        // Chain-level overrides apply if chain ID matches
        return override.scopeId === input.chainId;

      case 'step':
        // Step-level overrides apply if chain ID and step number match
        return override.scopeId === `${input.chainId}:${input.currentStep}`;

      default:
        return false;
    }
  }

  /**
   * Find step-specific configuration.
   */
  private findStepConfig(
    injectionType: InjectionType,
    input: InjectionDecisionInput
  ): StepInjectionConfig | undefined {
    if (!this.config.steps || input.currentStep === undefined) {
      return undefined;
    }

    for (const stepConfig of this.config.steps) {
      if (this.stepTargetMatches(stepConfig.stepTarget, input)) {
        // Check if this step config has settings for our injection type
        if (stepConfig[injectionType]) {
          return stepConfig;
        }
      }
    }

    return undefined;
  }

  /**
   * Check if a step target matches the current input.
   */
  private stepTargetMatches(
    target: number | 'first' | 'last' | 'odd' | 'even',
    input: InjectionDecisionInput
  ): boolean {
    const step = input.currentStep;
    const total = input.totalSteps;

    if (step === undefined) return false;

    if (typeof target === 'number') {
      return step === target;
    }

    switch (target) {
      case 'first':
        return step === 1;
      case 'last':
        return total !== undefined && step === total;
      case 'odd':
        return step % 2 === 1;
      case 'even':
        return step % 2 === 0;
      default:
        return false;
    }
  }

  /**
   * Find chain-level configuration using pattern matching.
   */
  private findChainConfig(
    injectionType: InjectionType,
    input: InjectionDecisionInput
  ): ChainInjectionConfig | undefined {
    if (!this.config.chains || !input.chainId) {
      return undefined;
    }

    for (const chainConfig of this.config.chains) {
      if (this.chainPatternMatches(chainConfig.chainPattern, input.chainId)) {
        // Check if this chain config has settings for our injection type
        if (chainConfig[injectionType]) {
          return chainConfig;
        }
      }
    }

    return undefined;
  }

  /**
   * Match a chain ID against a glob-like pattern.
   * Supports: exact match, prefix-*, *-suffix, *contains*
   */
  private chainPatternMatches(pattern: string, chainId: string): boolean {
    // Exact match
    if (pattern === chainId) {
      return true;
    }

    // Prefix match: "research-*"
    if (pattern.endsWith('*') && !pattern.startsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return chainId.startsWith(prefix);
    }

    // Suffix match: "*-workflow"
    if (pattern.startsWith('*') && !pattern.endsWith('*')) {
      const suffix = pattern.slice(1);
      return chainId.endsWith(suffix);
    }

    // Contains match: "*research*"
    if (pattern.startsWith('*') && pattern.endsWith('*')) {
      const middle = pattern.slice(1, -1);
      return chainId.includes(middle);
    }

    return false;
  }

  /**
   * Find the prompt's own rule for this injection type.
   *
   * Unlike the step/chain/category finders this searches nothing: the config travels with the
   * prompt on the decision input rather than living in a `config.json` array, so there is no
   * identifier to match. `promptId` remains on the input for diagnostics.
   *
   * Returns the rule only when it declares at least one field. A present-but-empty rule would
   * otherwise register as a hierarchy match and shadow the chain tier while contributing nothing.
   */
  private findPromptConfig(
    injectionType: InjectionType,
    input: InjectionDecisionInput
  ): PromptInjectionRule | undefined {
    const rule = input.promptInjection?.[injectionType];
    if (rule === undefined || Object.keys(rule).length === 0) {
      return undefined;
    }
    return rule;
  }

  /**
   * Find category-level configuration.
   */
  private findCategoryConfig(
    injectionType: InjectionType,
    input: InjectionDecisionInput
  ): CategoryInjectionConfig | undefined {
    if (!this.config.categories || !input.categoryId) {
      return undefined;
    }

    for (const categoryConfig of this.config.categories) {
      if (categoryConfig.categoryId === input.categoryId) {
        // Check if this category config has settings for our injection type
        if (categoryConfig[injectionType]) {
          return categoryConfig;
        }
      }
    }

    return undefined;
  }

  /**
   * Merge a partial config with system defaults.
   *
   * Takes `Partial<InjectionTypeConfig>` because every tier's rule shape declares `enabled` as
   * optional — that is the point of a tier that overrides one field and inherits the rest. The
   * method only ever reads fields behind `??`, so the partial is what it actually consumes.
   */
  private mergeWithDefaults(
    injectionType: InjectionType,
    partialConfig: Partial<InjectionTypeConfig> | undefined
  ): InjectionTypeConfig {
    const defaults = DEFAULT_CONFIG_BY_TYPE[injectionType];

    if (!partialConfig) {
      return defaults;
    }

    const merged: InjectionTypeConfig = {
      enabled: partialConfig.enabled ?? defaults.enabled,
    };

    const frequency = partialConfig.frequency ?? defaults.frequency;
    if (frequency) {
      merged.frequency = frequency;
    }

    const target = partialConfig.target ?? defaults.target ?? 'both';
    if (target) {
      merged.target = target;
    }

    const conditions = partialConfig.conditions ?? defaults.conditions;
    if (conditions) {
      merged.conditions = conditions;
    }

    return merged;
  }

  /**
   * The config tiers between step and global, in precedence order, each as a thunk.
   *
   * Thunks rather than resolved values so a tier is only searched if every higher tier declined,
   * preserving the short-circuit the per-field walks had when they were written out longhand.
   *
   * One list, consumed by every field walk. Written out per field instead, adding the prompt
   * tier meant editing each walk separately — the partial-threading failure mode, where a
   * prompt could disable injection yet still inherit a category's frequency.
   */
  private buildTierChain(
    injectionType: InjectionType,
    input: InjectionDecisionInput
  ): ReadonlyArray<{
    source: InjectionDecisionSource;
    read: () => Partial<InjectionTypeConfig> | undefined;
  }> {
    return [
      {
        source: 'step-config',
        read: () => this.findStepConfig(injectionType, input)?.[injectionType],
      },
      { source: 'prompt-config', read: () => this.findPromptConfig(injectionType, input) },
      {
        source: 'chain-config',
        read: () => this.findChainConfig(injectionType, input)?.[injectionType],
      },
      {
        source: 'category-config',
        read: () => this.findCategoryConfig(injectionType, input)?.[injectionType],
      },
      { source: 'global-config', read: () => this.config[injectionType] },
    ];
  }

  /**
   * First value declared for `field` walking the hierarchy from most to least specific,
   * falling back to the system default.
   *
   * `resolutionPath` is optional because the target walk records no path — only the frequency
   * walk does, which is the pre-existing behavior.
   */
  private findInHierarchy<K extends 'frequency' | 'target'>(
    injectionType: InjectionType,
    input: InjectionDecisionInput,
    field: K,
    resolutionPath?: InjectionDecisionSource[]
  ): InjectionTypeConfig[K] {
    for (const tier of this.buildTierChain(injectionType, input)) {
      const value = tier.read()?.[field];
      if (value !== undefined) {
        resolutionPath?.push(tier.source);
        return value;
      }
    }

    resolutionPath?.push('system-default');
    return DEFAULT_CONFIG_BY_TYPE[injectionType][field];
  }

  /**
   * Get frequency configuration from hierarchy (for runtime overrides).
   * Runtime overrides don't specify frequency, so we need to find it.
   */
  private getFrequencyFromHierarchy(
    injectionType: InjectionType,
    input: InjectionDecisionInput,
    resolutionPath: InjectionDecisionSource[]
  ): InjectionTypeConfig['frequency'] {
    return this.findInHierarchy(injectionType, input, 'frequency', resolutionPath);
  }

  /**
   * Get target configuration from hierarchy (for runtime overrides).
   * Runtime overrides may not specify target, so we need to find it.
   */
  private getTargetFromHierarchy(
    injectionType: InjectionType,
    input: InjectionDecisionInput
  ): InjectionTypeConfig['target'] {
    return this.findInHierarchy(injectionType, input, 'target') ?? 'both';
  }

  /**
   * Get the resolution priority order for documentation/debugging.
   */
  getResolutionPriority(): readonly InjectionDecisionSource[] {
    return RESOLUTION_PRIORITY;
  }
}

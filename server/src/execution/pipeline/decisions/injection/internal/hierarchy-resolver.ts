// @lifecycle canonical - Hierarchical resolution for injection configuration.

import { DEFAULT_CONFIG_BY_TYPE, RESOLUTION_PRIORITY } from '../constants.js';

import type { Logger } from '../../../../../logging/index.js';
import type {
  CategoryInjectionConfig,
  ChainInjectionConfig,
  InjectionConfig,
  InjectionDecisionInput,
  InjectionDecisionSource,
  InjectionRuntimeOverride,
  InjectionType,
  InjectionTypeConfig,
  ResolvedInjectionConfig,
  StepInjectionConfig,
} from '../types.js';

/**
 * Resolves injection configuration from hierarchical sources.
 *
 * Resolution priority (highest to lowest):
 * 1. Runtime overrides (from system_control)
 * 2. Step config (step-specific rules)
 * 3. Chain config (chain-level rules)
 * 4. Category config (category-level rules)
 * 5. Global config (config.json defaults)
 * 6. System defaults (hardcoded fallbacks)
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
        config: this.mergeWithDefaults(
          injectionType,
          stepConfig[injectionType] as InjectionTypeConfig | undefined
        ),
        source: 'step-config',
        resolutionPath,
      };
    }

    // Priority 3: Chain config
    const chainConfig = this.findChainConfig(injectionType, input);
    if (chainConfig) {
      resolutionPath.push('chain-config');

      this.logger.debug('[HierarchyResolver] Using chain config', {
        type: injectionType,
        chainPattern: chainConfig.chainPattern,
      });

      return {
        config: this.mergeWithDefaults(
          injectionType,
          chainConfig[injectionType] as InjectionTypeConfig | undefined
        ),
        source: 'chain-config',
        resolutionPath,
      };
    }

    // Priority 4: Category config
    const categoryConfig = this.findCategoryConfig(injectionType, input);
    if (categoryConfig) {
      resolutionPath.push('category-config');

      this.logger.debug('[HierarchyResolver] Using category config', {
        type: injectionType,
        categoryId: categoryConfig.categoryId,
      });

      return {
        config: this.mergeWithDefaults(
          injectionType,
          categoryConfig[injectionType] as InjectionTypeConfig | undefined
        ),
        source: 'category-config',
        resolutionPath,
      };
    }

    // Priority 5: Global config
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

    // Priority 6: System defaults
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
   */
  private mergeWithDefaults(
    injectionType: InjectionType,
    partialConfig: InjectionTypeConfig | undefined
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
   * Get frequency configuration from hierarchy (for runtime overrides).
   * Runtime overrides don't specify frequency, so we need to find it.
   */
  private getFrequencyFromHierarchy(
    injectionType: InjectionType,
    input: InjectionDecisionInput,
    resolutionPath: InjectionDecisionSource[]
  ): InjectionTypeConfig['frequency'] {
    // Check step, chain, category, global in order
    const stepConfig = this.findStepConfig(injectionType, input);
    if (stepConfig?.[injectionType]?.frequency) {
      resolutionPath.push('step-config');
      return (stepConfig[injectionType] as InjectionTypeConfig).frequency;
    }

    const chainConfig = this.findChainConfig(injectionType, input);
    if (chainConfig?.[injectionType]?.frequency) {
      resolutionPath.push('chain-config');
      return (chainConfig[injectionType] as InjectionTypeConfig).frequency;
    }

    const categoryConfig = this.findCategoryConfig(injectionType, input);
    if (categoryConfig?.[injectionType]?.frequency) {
      resolutionPath.push('category-config');
      return (categoryConfig[injectionType] as InjectionTypeConfig).frequency;
    }

    const globalConfig = this.config[injectionType];
    if (globalConfig?.frequency) {
      resolutionPath.push('global-config');
      return globalConfig.frequency;
    }

    resolutionPath.push('system-default');
    return DEFAULT_CONFIG_BY_TYPE[injectionType].frequency;
  }

  /**
   * Get target configuration from hierarchy (for runtime overrides).
   * Runtime overrides may not specify target, so we need to find it.
   */
  private getTargetFromHierarchy(
    injectionType: InjectionType,
    input: InjectionDecisionInput
  ): InjectionTypeConfig['target'] {
    // Check step, chain, category, global in order
    const stepConfig = this.findStepConfig(injectionType, input);
    if (stepConfig?.[injectionType]?.target) {
      return (stepConfig[injectionType] as InjectionTypeConfig).target;
    }

    const chainConfig = this.findChainConfig(injectionType, input);
    if (chainConfig?.[injectionType]?.target) {
      return (chainConfig[injectionType] as InjectionTypeConfig).target;
    }

    const categoryConfig = this.findCategoryConfig(injectionType, input);
    if (categoryConfig?.[injectionType]?.target) {
      return (categoryConfig[injectionType] as InjectionTypeConfig).target;
    }

    const globalConfig = this.config[injectionType];
    if (globalConfig?.target) {
      return globalConfig.target;
    }

    return DEFAULT_CONFIG_BY_TYPE[injectionType].target ?? 'both';
  }

  /**
   * Get the resolution priority order for documentation/debugging.
   */
  getResolutionPriority(): readonly InjectionDecisionSource[] {
    return RESOLUTION_PRIORITY;
  }
}

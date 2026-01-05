// @lifecycle canonical - Single source of truth for all injection decisions.

import {
  DISABLE_INJECT_MODIFIERS,
  FORCE_INJECT_MODIFIERS,
  INJECTION_TYPES,
  MODIFIER_EFFECTS,
} from './constants.js';
import { ConditionEvaluator, HierarchyResolver } from './internal/index.js';

import type {
  ExecutionContextType,
  InjectionConfig,
  InjectionDecision,
  InjectionDecisionInput,
  InjectionFrequency,
  InjectionRuntimeOverride,
  InjectionState,
  InjectionTarget,
  InjectionType,
} from './types.js';
import type { Logger } from '../../../../logging/index.js';

/**
 * Single source of truth for all injection decisions.
 *
 * All pipeline stages MUST consult this service instead of
 * making injection decisions independently. Decisions are computed
 * once per injection type and cached for the duration of the request.
 *
 * Resolution Priority:
 * 1. Modifiers (%clean, %lean, %judge) - highest priority
 * 2. Runtime overrides (session_control injection:override)
 * 3. Step config (step-specific rules)
 * 4. Chain config (chain-level rules)
 * 5. Category config (category-level rules)
 * 6. Global config (config.json defaults)
 * 7. System defaults (hardcoded fallbacks)
 *
 * @example
 * ```typescript
 * // In a pipeline stage
 * const decision = injectionService.decide({
 *   injectionType: 'system-prompt',
 *   currentStep: 2,
 *   totalSteps: 5,
 *   modifiers: context.executionPlan?.modifiers,
 *   categoryId: context.prompt?.category,
 *   chainId: context.mcpRequest.chain_id,
 * });
 *
 * if (decision.inject) {
 *   // Inject the system prompt
 * }
 * ```
 */
export class InjectionDecisionService {
  private readonly logger: Logger;
  private readonly resolver: HierarchyResolver;
  private readonly conditionEvaluator: ConditionEvaluator;

  /** Cached decisions by injection type. */
  private decisions: Map<InjectionType, InjectionDecision> = new Map();

  /** Active runtime overrides. */
  private runtimeOverrides: Map<InjectionType, InjectionRuntimeOverride> = new Map();

  /** Track last injection step for each type. */
  private lastInjectionStep: Map<InjectionType, number> = new Map();

  constructor(config: InjectionConfig, logger: Logger) {
    this.logger = logger;
    this.resolver = new HierarchyResolver(config, logger);
    this.conditionEvaluator = new ConditionEvaluator(logger);
  }

  /**
   * Replace all runtime overrides at once (e.g., from SessionOverrideManager)
   * and clear cached decisions so new overrides take effect immediately.
   */
  syncRuntimeOverrides(overrides: Map<InjectionType, InjectionRuntimeOverride>): void {
    this.runtimeOverrides = new Map(overrides);
    this.decisions.clear();
    this.logger.debug('[InjectionDecisionService] Runtime overrides synced', {
      count: this.runtimeOverrides.size,
    });
  }

  /**
   * Get the injection decision for a specific type.
   * Computes on first call, returns cached thereafter.
   *
   * IMPORTANT: `inject: true` means INJECT, `inject: false` means SKIP.
   * No inversions, no confusion.
   */
  decide(input: InjectionDecisionInput): InjectionDecision {
    const cacheKey = input.injectionType;

    // Return cached decision if available
    const cached = this.decisions.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Compute new decision
    const decision = this.computeDecision(input);

    // Cache it
    this.decisions.set(cacheKey, decision);

    // Track injection step if we're injecting
    if (decision.inject && input.currentStep !== undefined) {
      this.lastInjectionStep.set(input.injectionType, input.currentStep);
    }

    this.logger.debug('[InjectionDecisionService] Decision made', {
      type: input.injectionType,
      inject: decision.inject,
      reason: decision.reason,
      source: decision.source,
      currentStep: input.currentStep,
    });

    return decision;
  }

  /**
   * Decide for all injection types at once.
   * Useful for pipeline stages that need all decisions.
   */
  decideAll(input: Omit<InjectionDecisionInput, 'injectionType'>): InjectionState {
    const state: InjectionState = {};
    if (input.currentStep !== undefined) {
      state.currentStep = input.currentStep;
    }
    if (input.sessionOverrides) {
      state.sessionOverrides = input.sessionOverrides;
    }
    if (input.executionContext) {
      state.executionContext = input.executionContext;
    }

    for (const type of INJECTION_TYPES) {
      const decision = this.decide({ ...input, injectionType: type });

      switch (type) {
        case 'system-prompt':
          state.systemPrompt = decision;
          if (decision.inject && input.currentStep !== undefined) {
            state.lastSystemPromptStep = input.currentStep;
          }
          break;
        case 'gate-guidance':
          state.gateGuidance = decision;
          break;
        case 'style-guidance':
          state.styleGuidance = decision;
          break;
      }
    }

    return state;
  }

  /**
   * Check if a decision has been made for a type.
   */
  hasDecided(type: InjectionType): boolean {
    return this.decisions.has(type);
  }

  /**
   * Get cached decision without computing.
   */
  getCachedDecision(type: InjectionType): InjectionDecision | undefined {
    return this.decisions.get(type);
  }

  /**
   * Reset all cached decisions (for new request or testing).
   */
  reset(): void {
    this.decisions.clear();
    this.lastInjectionStep.clear();
  }

  /**
   * Set a runtime override for an injection type.
   */
  setRuntimeOverride(override: InjectionRuntimeOverride): void {
    this.runtimeOverrides.set(override.type, override);
    // Invalidate cached decision for this type
    this.decisions.delete(override.type);

    this.logger.debug('[InjectionDecisionService] Runtime override set', {
      type: override.type,
      enabled: override.enabled,
      scope: override.scope,
    });
  }

  /**
   * Clear a runtime override.
   */
  clearRuntimeOverride(type: InjectionType): void {
    this.runtimeOverrides.delete(type);
    // Invalidate cached decision
    this.decisions.delete(type);

    this.logger.debug('[InjectionDecisionService] Runtime override cleared', {
      type,
    });
  }

  /**
   * Clear all runtime overrides.
   */
  clearAllRuntimeOverrides(): void {
    this.runtimeOverrides.clear();
    this.decisions.clear();

    this.logger.debug('[InjectionDecisionService] All runtime overrides cleared');
  }

  /**
   * Get current runtime overrides for status reporting.
   */
  getRuntimeOverrides(): ReadonlyMap<InjectionType, InjectionRuntimeOverride> {
    return this.runtimeOverrides;
  }

  /**
   * Get last injection step for a type.
   */
  getLastInjectionStep(type: InjectionType): number | undefined {
    return this.lastInjectionStep.get(type);
  }

  /**
   * Compute the injection decision.
   */
  private computeDecision(input: InjectionDecisionInput): InjectionDecision {
    const timestamp = Date.now();

    // Priority 1: Check modifiers that disable injection
    const modifierDecision = this.checkModifiers(input, timestamp);
    if (modifierDecision) {
      return modifierDecision;
    }

    // Priority 2-6: Resolve from hierarchy
    const runtimeOverride = this.runtimeOverrides.get(input.injectionType);
    const resolved = this.resolver.resolve(input.injectionType, input, runtimeOverride);

    // Capture target from resolved config for later filtering
    const target = resolved.config.target ?? 'both';

    // Check if globally disabled
    if (!resolved.config.enabled) {
      return {
        inject: false,
        reason: `Disabled in ${resolved.source}`,
        source: resolved.source,
        decidedAt: timestamp,
        target,
      };
    }

    // Check conditional rules
    const conditionResult = this.conditionEvaluator.evaluate(resolved.config.conditions, input);

    if (conditionResult.matched) {
      if (conditionResult.action === 'skip') {
        return {
          inject: false,
          reason: conditionResult.reason,
          source: resolved.source,
          decidedAt: timestamp,
          target,
        };
      }
      if (conditionResult.action === 'inject') {
        // Apply target filtering before returning inject decision
        return this.applyTargetFilter(
          {
            inject: true,
            reason: conditionResult.reason,
            source: resolved.source,
            decidedAt: timestamp,
            target,
          },
          input.executionContext
        );
      }
      // 'inherit' falls through to frequency check
    }

    // Check frequency for chains
    if (input.currentStep !== undefined && resolved.config.frequency) {
      const frequencyDecision = this.checkFrequency(
        input.injectionType,
        input.currentStep,
        input.totalSteps,
        resolved.config.frequency,
        timestamp,
        resolved.source,
        target
      );
      // Apply target filtering to frequency decision
      return this.applyTargetFilter(frequencyDecision, input.executionContext);
    }

    // Default: inject (with target filtering)
    return this.applyTargetFilter(
      {
        inject: true,
        reason: `Enabled by ${resolved.source}`,
        source: resolved.source,
        decidedAt: timestamp,
        target,
      },
      input.executionContext
    );
  }

  /**
   * Apply target filtering to an injection decision.
   * If the decision is to inject but the target doesn't match the execution context,
   * convert it to a skip decision.
   *
   * @param decision - The base injection decision
   * @param executionContext - Current execution context ('step' or 'gate_review')
   * @returns Modified decision if target doesn't match, original otherwise
   */
  private applyTargetFilter(
    decision: InjectionDecision,
    executionContext?: ExecutionContextType
  ): InjectionDecision {
    // If not injecting, no filtering needed
    if (!decision.inject) {
      return decision;
    }

    const target = decision.target ?? 'both';

    // 'both' always matches
    if (target === 'both') {
      return decision;
    }

    // If no execution context provided, allow injection (backward compatibility)
    if (!executionContext) {
      return decision;
    }

    // Check if target matches execution context
    const matches =
      (target === 'steps' && executionContext === 'step') ||
      (target === 'gates' && executionContext === 'gate_review');

    if (matches) {
      return decision;
    }

    // Target doesn't match - convert to skip
    return {
      inject: false,
      reason: `Target '${target}' doesn't match execution context '${executionContext}'`,
      source: decision.source,
      decidedAt: decision.decidedAt,
      target,
    };
  }

  /**
   * Check modifiers for injection control.
   * Returns a decision if modifiers override normal behavior.
   */
  private checkModifiers(
    input: InjectionDecisionInput,
    timestamp: number
  ): InjectionDecision | null {
    if (!input.modifiers) {
      return null;
    }

    // Check force-inject modifiers (e.g., %judge)
    for (const modifier of FORCE_INJECT_MODIFIERS) {
      if (input.modifiers[modifier as keyof typeof input.modifiers]) {
        // %judge only affects system-prompt (forces injection for judge selection phase)
        if (modifier === 'judge' && input.injectionType === 'system-prompt') {
          return {
            inject: true,
            reason: `Forced by %${modifier} modifier`,
            source: 'modifier',
            decidedAt: timestamp,
          };
        }
      }
    }

    // Check disable-inject modifiers (e.g., %clean, %lean)
    for (const modifier of DISABLE_INJECT_MODIFIERS) {
      if (input.modifiers[modifier as keyof typeof input.modifiers]) {
        const affectedTypes = MODIFIER_EFFECTS[modifier];
        if (affectedTypes?.includes(input.injectionType)) {
          return {
            inject: false,
            reason: `Disabled by %${modifier} modifier`,
            source: 'modifier',
            decidedAt: timestamp,
          };
        }
      }
    }

    return null;
  }

  /**
   * Check if injection should happen based on frequency rules.
   */
  private checkFrequency(
    type: InjectionType,
    currentStep: number,
    totalSteps: number | undefined,
    frequency: InjectionFrequency,
    timestamp: number,
    source: InjectionDecision['source'],
    target: InjectionTarget = 'both'
  ): InjectionDecision {
    switch (frequency.mode) {
      case 'never':
        return {
          inject: false,
          reason: 'Frequency mode is never',
          source,
          decidedAt: timestamp,
          target,
        };

      case 'first-only':
        if (currentStep === 1) {
          return {
            inject: true,
            reason: 'First step (first-only mode)',
            source,
            decidedAt: timestamp,
            target,
          };
        }
        return {
          inject: false,
          reason: `Step ${currentStep} > 1 (first-only mode)`,
          source,
          decidedAt: timestamp,
          target,
        };

      case 'every': {
        const interval = frequency.interval ?? 1;

        // Step 1 always injects
        if (currentStep === 1) {
          return {
            inject: true,
            reason: 'First step always injects',
            source,
            decidedAt: timestamp,
            target,
          };
        }

        // For subsequent steps, check interval
        // With interval=2: inject on steps 1, 3, 5, etc.
        // Formula: inject if (step - 1) % interval === 0
        const shouldInject = (currentStep - 1) % interval === 0;

        if (shouldInject) {
          return {
            inject: true,
            reason: `Step ${currentStep} matches interval ${interval}`,
            source,
            decidedAt: timestamp,
            target,
          };
        }

        return {
          inject: false,
          reason: `Step ${currentStep} doesn't match interval ${interval}`,
          source,
          decidedAt: timestamp,
          target,
        };
      }

      default: {
        // Fallback for unknown mode
        const _exhaustive: never = frequency.mode;
        void _exhaustive;
        return {
          inject: true,
          reason: 'Unknown frequency mode, defaulting to inject',
          source,
          decidedAt: timestamp,
          target,
        };
      }
    }
  }
}

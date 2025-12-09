// @lifecycle canonical - Default values and constants for the injection control system.

import type {
  InjectionConfig,
  InjectionDecisionSource,
  InjectionFrequency,
  InjectionTarget,
  InjectionType,
  InjectionTypeConfig,
} from './types.js';

/**
 * All available injection types.
 */
export const INJECTION_TYPES: readonly InjectionType[] = [
  'system-prompt',
  'gate-guidance',
  'style-guidance',
] as const;

/**
 * Resolution priority order (highest to lowest).
 * Used for hierarchical configuration resolution.
 */
export const RESOLUTION_PRIORITY: readonly InjectionDecisionSource[] = [
  'modifier',
  'runtime-override',
  'step-config',
  'chain-config',
  'category-config',
  'global-config',
  'system-default',
] as const;

/**
 * Default target for all injection types.
 * 'both' ensures injection on both step execution and gate reviews.
 */
export const DEFAULT_INJECTION_TARGET: InjectionTarget = 'both';

/**
 * Default frequency for system prompt injection.
 * Injects every 2 steps (step 1, 3, 5, etc.)
 */
export const DEFAULT_SYSTEM_PROMPT_FREQUENCY: InjectionFrequency = {
  mode: 'every',
  interval: 2,
} as const;

/**
 * Default frequency for gate guidance injection.
 * Injects on every step.
 */
export const DEFAULT_GATE_GUIDANCE_FREQUENCY: InjectionFrequency = {
  mode: 'every',
  interval: 1,
} as const;

/**
 * Default frequency for style guidance injection.
 * Injects on first step only.
 */
export const DEFAULT_STYLE_GUIDANCE_FREQUENCY: InjectionFrequency = {
  mode: 'first-only',
} as const;

/**
 * Default configuration for system-prompt injection.
 */
export const DEFAULT_SYSTEM_PROMPT_CONFIG: InjectionTypeConfig = {
  enabled: true,
  frequency: DEFAULT_SYSTEM_PROMPT_FREQUENCY,
  target: DEFAULT_INJECTION_TARGET,
} as const;

/**
 * Default configuration for gate-guidance injection.
 */
export const DEFAULT_GATE_GUIDANCE_CONFIG: InjectionTypeConfig = {
  enabled: true,
  frequency: DEFAULT_GATE_GUIDANCE_FREQUENCY,
  target: DEFAULT_INJECTION_TARGET,
} as const;

/**
 * Default configuration for style-guidance injection.
 */
export const DEFAULT_STYLE_GUIDANCE_CONFIG: InjectionTypeConfig = {
  enabled: true,
  frequency: DEFAULT_STYLE_GUIDANCE_FREQUENCY,
  target: DEFAULT_INJECTION_TARGET,
} as const;

/**
 * Complete default injection configuration.
 * Used when no config.json injection section exists.
 */
export const DEFAULT_INJECTION_CONFIG: InjectionConfig = {
  defaults: {
    'system-prompt': true,
    'gate-guidance': true,
    'style-guidance': true,
  },
  'system-prompt': DEFAULT_SYSTEM_PROMPT_CONFIG,
  'gate-guidance': DEFAULT_GATE_GUIDANCE_CONFIG,
  'style-guidance': DEFAULT_STYLE_GUIDANCE_CONFIG,
} as const;

/**
 * Map of injection type to its default configuration.
 */
export const DEFAULT_CONFIG_BY_TYPE: Readonly<Record<InjectionType, InjectionTypeConfig>> = {
  'system-prompt': DEFAULT_SYSTEM_PROMPT_CONFIG,
  'gate-guidance': DEFAULT_GATE_GUIDANCE_CONFIG,
  'style-guidance': DEFAULT_STYLE_GUIDANCE_CONFIG,
} as const;

/**
 * Modifier effects on injection.
 * Maps modifiers to which injection types they disable.
 */
export const MODIFIER_EFFECTS: Readonly<Record<string, readonly InjectionType[]>> = {
  clean: ['system-prompt', 'gate-guidance', 'style-guidance'],
  lean: ['system-prompt', 'style-guidance'],
  judge: [], // Enables/forces injection (triggers judge selection phase)
} as const;

/**
 * Modifiers that force injection regardless of config.
 * %judge triggers judge selection phase.
 */
export const FORCE_INJECT_MODIFIERS: readonly string[] = ['judge'] as const;

/**
 * Modifiers that disable injection.
 */
export const DISABLE_INJECT_MODIFIERS: readonly string[] = ['clean', 'lean'] as const;

/**
 * Human-readable descriptions for injection types.
 */
export const INJECTION_TYPE_DESCRIPTIONS: Readonly<Record<InjectionType, string>> = {
  'system-prompt': 'Framework methodology system prompts (CAGEERF, ReACT, etc.)',
  'gate-guidance': 'Quality gate validation guidance and criteria',
  'style-guidance': 'Response style and formatting guidance',
} as const;

/**
 * Human-readable descriptions for decision sources.
 */
export const DECISION_SOURCE_DESCRIPTIONS: Readonly<Record<InjectionDecisionSource, string>> = {
  modifier: 'Command modifier (%clean, %lean, %judge)',
  'runtime-override': 'Runtime session override via system_control',
  'step-config': 'Step-specific configuration',
  'chain-config': 'Chain-level configuration',
  'category-config': 'Category-level configuration',
  'global-config': 'Global config.json settings',
  'system-default': 'Built-in system defaults',
} as const;

/**
 * Human-readable descriptions for injection targets.
 */
export const INJECTION_TARGET_DESCRIPTIONS: Readonly<Record<InjectionTarget, string>> = {
  steps: 'Inject only on normal step execution (not gate reviews)',
  gates: 'Inject only on gate review steps (not normal execution)',
  both: 'Inject on both step execution and gate reviews (default)',
} as const;

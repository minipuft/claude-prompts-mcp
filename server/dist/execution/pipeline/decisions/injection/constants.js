// @lifecycle canonical - Default values and constants for the injection control system.
/**
 * All available injection types.
 */
export const INJECTION_TYPES = [
    'system-prompt',
    'gate-guidance',
    'style-guidance',
];
/**
 * Resolution priority order (highest to lowest).
 * Used for hierarchical configuration resolution.
 */
export const RESOLUTION_PRIORITY = [
    'modifier',
    'runtime-override',
    'step-config',
    'chain-config',
    'category-config',
    'global-config',
    'system-default',
];
/**
 * Default target for all injection types.
 * 'both' ensures injection on both step execution and gate reviews.
 */
export const DEFAULT_INJECTION_TARGET = 'both';
/**
 * Default frequency for system prompt injection.
 * Injects every 2 steps (step 1, 3, 5, etc.)
 */
export const DEFAULT_SYSTEM_PROMPT_FREQUENCY = {
    mode: 'every',
    interval: 2,
};
/**
 * Default frequency for gate guidance injection.
 * Injects on every step.
 */
export const DEFAULT_GATE_GUIDANCE_FREQUENCY = {
    mode: 'every',
    interval: 1,
};
/**
 * Default frequency for style guidance injection.
 * Injects on first step only.
 */
export const DEFAULT_STYLE_GUIDANCE_FREQUENCY = {
    mode: 'first-only',
};
/**
 * Default configuration for system-prompt injection.
 */
export const DEFAULT_SYSTEM_PROMPT_CONFIG = {
    enabled: true,
    frequency: DEFAULT_SYSTEM_PROMPT_FREQUENCY,
    target: DEFAULT_INJECTION_TARGET,
};
/**
 * Default configuration for gate-guidance injection.
 */
export const DEFAULT_GATE_GUIDANCE_CONFIG = {
    enabled: true,
    frequency: DEFAULT_GATE_GUIDANCE_FREQUENCY,
    target: DEFAULT_INJECTION_TARGET,
};
/**
 * Default configuration for style-guidance injection.
 */
export const DEFAULT_STYLE_GUIDANCE_CONFIG = {
    enabled: true,
    frequency: DEFAULT_STYLE_GUIDANCE_FREQUENCY,
    target: DEFAULT_INJECTION_TARGET,
};
/**
 * Complete default injection configuration.
 * Used when no config.json injection section exists.
 */
export const DEFAULT_INJECTION_CONFIG = {
    defaults: {
        'system-prompt': true,
        'gate-guidance': true,
        'style-guidance': true,
    },
    'system-prompt': DEFAULT_SYSTEM_PROMPT_CONFIG,
    'gate-guidance': DEFAULT_GATE_GUIDANCE_CONFIG,
    'style-guidance': DEFAULT_STYLE_GUIDANCE_CONFIG,
};
/**
 * Map of injection type to its default configuration.
 */
export const DEFAULT_CONFIG_BY_TYPE = {
    'system-prompt': DEFAULT_SYSTEM_PROMPT_CONFIG,
    'gate-guidance': DEFAULT_GATE_GUIDANCE_CONFIG,
    'style-guidance': DEFAULT_STYLE_GUIDANCE_CONFIG,
};
/**
 * Modifier effects on injection.
 * Maps modifiers to which injection types they disable.
 */
export const MODIFIER_EFFECTS = {
    clean: ['system-prompt', 'gate-guidance', 'style-guidance'],
    lean: ['system-prompt', 'style-guidance'],
    judge: [], // Enables/forces injection (triggers judge selection phase)
};
/**
 * Modifiers that force injection regardless of config.
 * %judge triggers judge selection phase.
 */
export const FORCE_INJECT_MODIFIERS = ['judge'];
/**
 * Modifiers that disable injection.
 */
export const DISABLE_INJECT_MODIFIERS = ['clean', 'lean'];
/**
 * Human-readable descriptions for injection types.
 */
export const INJECTION_TYPE_DESCRIPTIONS = {
    'system-prompt': 'Framework methodology system prompts (CAGEERF, ReACT, etc.)',
    'gate-guidance': 'Quality gate validation guidance and criteria',
    'style-guidance': 'Response style and formatting guidance',
};
/**
 * Human-readable descriptions for decision sources.
 */
export const DECISION_SOURCE_DESCRIPTIONS = {
    modifier: 'Command modifier (%clean, %lean, %judge)',
    'runtime-override': 'Runtime session override via system_control',
    'step-config': 'Step-specific configuration',
    'chain-config': 'Chain-level configuration',
    'category-config': 'Category-level configuration',
    'global-config': 'Global config.json settings',
    'system-default': 'Built-in system defaults',
};
/**
 * Human-readable descriptions for injection targets.
 */
export const INJECTION_TARGET_DESCRIPTIONS = {
    steps: 'Inject only on normal step execution (not gate reviews)',
    gates: 'Inject only on gate review steps (not normal execution)',
    both: 'Inject on both step execution and gate reviews (default)',
};
//# sourceMappingURL=constants.js.map
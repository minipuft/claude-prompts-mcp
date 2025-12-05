// @lifecycle canonical - Gate system constants shared across loaders/validators.
/**
 * Gate System Constants
 *
 * Centralized behavioral settings for the gate system.
 * These were previously configurable but are now set as sensible defaults.
 */

/**
 * Default retry limit for failed validations
 * @remarks Changed from 3 to 2 per gate-retry-enforcement.md plan
 */
export const DEFAULT_RETRY_LIMIT = 2;

/**
 * Default retry configuration for gates that don't specify their own
 */
export const DEFAULT_GATE_RETRY_CONFIG = {
  max_attempts: DEFAULT_RETRY_LIMIT,
  improvement_hints: true,
  preserve_context: true,
} as const;

/**
 * Whether to inject gate guidance into prompts by default
 */
export const ENABLE_GUIDANCE_INJECTION = true;

/**
 * Whether to perform gate validation by default
 */
export const ENABLE_VALIDATION = true;

/**
 * Default gate system behavioral configuration
 */
export const GATE_SYSTEM_DEFAULTS = {
  defaultRetryLimit: DEFAULT_RETRY_LIMIT,
  enableGuidanceInjection: ENABLE_GUIDANCE_INJECTION,
  enableValidation: ENABLE_VALIDATION,
  defaultRetryConfig: DEFAULT_GATE_RETRY_CONFIG,
} as const;

/**
 * Canonical methodology gate identifiers that should not be duplicated across templates.
 */
export const METHODOLOGY_GATES = new Set<string>([
  'framework-compliance',
  'methodology-validation',
  'educational-clarity',
  'research-quality',
  'technical-accuracy',
  'content-structure',
  'code-quality',
  'security-awareness',
]);

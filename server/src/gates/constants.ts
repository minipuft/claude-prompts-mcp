// @lifecycle canonical - Gate system constants shared across loaders/validators.
/**
 * Gate System Constants
 *
 * Centralized behavioral settings for the gate system.
 * These were previously configurable but are now set as sensible defaults.
 */

/**
 * Default retry limit for failed validations
 */
export const DEFAULT_RETRY_LIMIT = 3;

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
} as const;

/**
 * Canonical methodology gate identifiers that should not be duplicated across templates.
 */
export const METHODOLOGY_GATES = new Set<string>([
  'framework-compliance',
  'educational-clarity',
  'research-quality',
  'technical-accuracy',
  'content-structure',
  'code-quality',
  'security-awareness',
]);

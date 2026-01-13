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

// ============================================================================
// Shell Verification Gate Constants
// ============================================================================

/**
 * Default maximum retry attempts for shell verification gates.
 * After this many failures, user is prompted for gate_action decision.
 */
export const SHELL_VERIFY_DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Default timeout for shell verification commands in milliseconds.
 * Set to 5 minutes to accommodate large test suites and CI builds.
 * Commands exceeding this timeout are killed and marked as failed.
 */
export const SHELL_VERIFY_DEFAULT_TIMEOUT = 300000; // 5 minutes

/**
 * Maximum allowed timeout for shell verification commands.
 * Protects against runaway processes from misconfiguration.
 */
export const SHELL_VERIFY_MAX_TIMEOUT = 600000; // 10 minutes

/**
 * Shell verification system defaults
 */
export const SHELL_VERIFY_DEFAULTS = {
  maxAttempts: SHELL_VERIFY_DEFAULT_MAX_ATTEMPTS,
  defaultTimeout: SHELL_VERIFY_DEFAULT_TIMEOUT,
  maxTimeout: SHELL_VERIFY_MAX_TIMEOUT,
} as const;

// ============================================================================
// Shell Verification Presets
// ============================================================================

/**
 * Verification presets for common use cases.
 * Users can apply these with :fast, :full, or :extended syntax.
 *
 * @example
 * :: verify:"npm test" :fast      // Quick feedback during development
 * :: verify:"npm test" :full      // CI-style validation (default-like)
 * :: verify:"npm test" :extended  // Long-running test suites
 */
export const SHELL_VERIFY_PRESETS = {
  /**
   * :fast - Quick feedback during development
   * Single attempt with short timeout for rapid iteration
   */
  fast: {
    maxIterations: 1,
    timeout: 30000, // 30 seconds
  },

  /**
   * :full - CI-style validation (recommended for most cases)
   * Multiple attempts with standard timeout
   */
  full: {
    maxIterations: 5,
    timeout: 300000, // 5 minutes
  },

  /**
   * :extended - Long-running test suites
   * More attempts with extended timeout for comprehensive testing
   */
  extended: {
    maxIterations: 10,
    timeout: 600000, // 10 minutes
  },
} as const;

/**
 * Type for valid preset names
 */
export type ShellVerifyPresetName = keyof typeof SHELL_VERIFY_PRESETS;

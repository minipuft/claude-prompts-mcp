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
export declare const DEFAULT_RETRY_LIMIT = 2;
/**
 * Default retry configuration for gates that don't specify their own
 */
export declare const DEFAULT_GATE_RETRY_CONFIG: {
    readonly max_attempts: 2;
    readonly improvement_hints: true;
    readonly preserve_context: true;
};
/**
 * Whether to inject gate guidance into prompts by default
 */
export declare const ENABLE_GUIDANCE_INJECTION = true;
/**
 * Whether to perform gate validation by default
 */
export declare const ENABLE_VALIDATION = true;
/**
 * Default gate system behavioral configuration
 */
export declare const GATE_SYSTEM_DEFAULTS: {
    readonly defaultRetryLimit: 2;
    readonly enableGuidanceInjection: true;
    readonly enableValidation: true;
    readonly defaultRetryConfig: {
        readonly max_attempts: 2;
        readonly improvement_hints: true;
        readonly preserve_context: true;
    };
};
/**
 * Default maximum retry attempts for shell verification gates.
 * After this many failures, user is prompted for gate_action decision.
 */
export declare const SHELL_VERIFY_DEFAULT_MAX_ATTEMPTS = 5;
/**
 * Default timeout for shell verification commands in milliseconds.
 * Set to 5 minutes to accommodate large test suites and CI builds.
 * Commands exceeding this timeout are killed and marked as failed.
 */
export declare const SHELL_VERIFY_DEFAULT_TIMEOUT = 300000;
/**
 * Maximum allowed timeout for shell verification commands.
 * Protects against runaway processes from misconfiguration.
 */
export declare const SHELL_VERIFY_MAX_TIMEOUT = 600000;
/**
 * Shell verification system defaults
 */
export declare const SHELL_VERIFY_DEFAULTS: {
    readonly maxAttempts: 5;
    readonly defaultTimeout: 300000;
    readonly maxTimeout: 600000;
};

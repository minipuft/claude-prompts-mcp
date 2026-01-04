/**
 * Feature Flags for Execution Context System
 *
 * Provides safe, gradual rollout of new type system features through
 * environment variable toggles.
 */
/**
 * Check if discriminated unions are enabled for the execution context.
 *
 * **Feature**: Discriminated Union Type System (Phase 2)
 * **Default**: `false` (disabled for backward compatibility)
 * **Enable**: Set environment variable `USE_DISCRIMINATED_UNIONS=true`
 *
 * When enabled:
 * - ExecutionContext uses discriminated union types
 * - Type guards enable compile-time type narrowing
 * - Optional chaining reduced by ~50%
 * - Pipeline stages use variant-specific paths
 *
 * When disabled:
 * - Uses class-based ExecutionContext (legacy)
 * - Runtime validation with optional fields
 * - Backward compatibility maintained
 *
 * @returns true if discriminated unions feature is enabled
 *
 * @example
 * ```typescript
 * if (useDiscriminatedUnions()) {
 *   // Use type guards for variant-specific logic
 *   if (hasChainCommand(context)) {
 *     // context.parsedCommand is ChainCommand
 *   }
 * } else {
 *   // Use runtime checks
 *   if (context.parsedCommand?.steps) {
 *     // Chain execution
 *   }
 * }
 * ```
 */
export declare function useDiscriminatedUnions(): boolean;
/**
 * Feature flag status for logging and diagnostics
 *
 * @returns Object containing all feature flag states
 */
export declare function getFeatureFlagStatus(): Record<string, boolean>;

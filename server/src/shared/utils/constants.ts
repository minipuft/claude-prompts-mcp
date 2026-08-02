// @lifecycle canonical - Shared constants for the application.

/**
 * Regex pattern for validating Chain IDs.
 * Format: chain-<slug>#<version>
 * Example: chain-analysis-flow#1
 */
export const CHAIN_ID_PATTERN = /^chain-[a-zA-Z0-9_-]+(?:#\d+)?$/;

/**
 * Framework applied when nothing else selects one.
 *
 * Lives at the shared layer (L0) so `infra/config` and `engine/frameworks` can both
 * reference it. Config resolution (`frameworks.defaultFramework`) overrides it, and a
 * persisted per-scope state row overrides that. Anything holding its own literal instead
 * of this constant will drift from the configured value.
 */
export const DEFAULT_FRAMEWORK_ID = 'CAGEERF';

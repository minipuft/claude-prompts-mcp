// @lifecycle canonical - Shared constants for the application.

/**
 * Framework applied when nothing else selects one.
 *
 * Lives at the shared layer (L0) so `infra/config` and `engine/frameworks` can both
 * reference it. Config resolution (`frameworks.defaultFramework`) overrides it, and a
 * persisted per-scope state row overrides that. Anything holding its own literal instead
 * of this constant will drift from the configured value.
 */
export const DEFAULT_FRAMEWORK_ID = 'CAGEERF';

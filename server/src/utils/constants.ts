// @lifecycle canonical - Shared constants for the application.

/**
 * Regex pattern for validating Chain IDs.
 * Format: chain-<slug>#<version>
 * Example: chain-analysis-flow#1
 */
export const CHAIN_ID_PATTERN = /^chain-[a-zA-Z0-9_-]+(?:#\d+)?$/;

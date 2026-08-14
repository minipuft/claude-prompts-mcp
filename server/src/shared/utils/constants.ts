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

/**
 * Reserved rendering-context key under which a chain step's `outputMapping` names are published.
 *
 * A named output is a chain-history value wearing an author-chosen name, so it must be
 * withheld exactly when the positional history surface is (`step{N}_result`, `step_results`).
 * Flat publication made that impossible: `{{findings}}` is indistinguishable from an ordinary
 * argument once spread, so `stripChainHistory` could only delete regex-identifiable positional
 * keys and a withheld `chain_history` leaked through any alias (P5-F2).
 *
 * One reserved object key rather than a per-name marker: the producer
 * (`TextReferenceStore.buildChainVariables`, L3) and the withholder
 * (`ChainOperatorExecutor.stripChainHistory`, L2) cannot import each other — `engine/` may not
 * value-import `modules/` — so the contract between them lives here, at L0, or it is two
 * literals that drift.
 */
export const NAMED_OUTPUT_NAMESPACE = 'outputs';

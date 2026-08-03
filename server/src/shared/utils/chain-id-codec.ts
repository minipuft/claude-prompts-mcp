// @lifecycle canonical - Sole owner of the chain run-identifier format.
/**
 * Chain ID codec.
 *
 * A chain identifier is `chain-{promptId}` optionally suffixed with `#{runNumber}`:
 * `chain-analysis-flow` is the *base* id shared by every run, `chain-analysis-flow#3`
 * is the third run of it. Every producer and consumer of that shape goes through this
 * module.
 *
 * It lives at the shared layer because the format has consumers in three of them —
 * the pipeline stage that mints run ids, the chains module that indexes runs by base
 * id, and the MCP/validation schemas that accept a `chain_id` from the client. It is a
 * pure format codec with no state and no I/O, so per the layer model it is a utility
 * rather than a service; deciding *which* run comes next needs run history, which is
 * the session store's to fetch and this module's only to interpret.
 *
 * Consolidated 2026-08-02: the strip and parse halves each existed twice, privately,
 * under names sharing no substring (`stripRunCounter`/`extractBaseChainId`,
 * `extractRunNumber`/`getRunNumber`), and the validating regex was inlined in two Zod
 * schemas beside a `CHAIN_ID_PATTERN` constant that already existed. Six literals, one
 * contract, no owner. Keep it that way: add format knowledge here, not at a call site.
 */

/**
 * The run-number suffix. One literal serves strip, parse, and format so the three can
 * never disagree about what a run suffix is.
 */
const RUN_SUFFIX_PATTERN = /#(\d+)$/;

/**
 * Full shape of a chain identifier, with or without a run suffix.
 *
 * Used by request validation and by the `chain_id` MCP parameter. The base segment is
 * `chain-` plus a prompt id, which the prompt loader constrains to the same character
 * class this allows.
 */
export const CHAIN_ID_PATTERN = /^chain-[a-zA-Z0-9_-]+(?:#\d+)?$/;

/**
 * The format stated in prose, for validator messages that must tell a caller what to
 * send. Exported so the sentence and the regex are revised together — nothing
 * typechecks a description that has drifted from the pattern beside it.
 */
export const CHAIN_ID_FORMAT_MESSAGE =
  'Chain ID must follow format: chain-{prompt} or chain-{prompt}#runNumber';

/** True when `value` is a string matching the chain identifier format. */
export function isChainId(value: unknown): value is string {
  return typeof value === 'string' && CHAIN_ID_PATTERN.test(value);
}

/**
 * The base id shared by every run of a chain — `chain-x#4` and `chain-x` both yield
 * `chain-x`. Idempotent, so callers need not track whether an id was already stripped.
 */
export function stripRunNumber(chainId: string): string {
  return chainId.replace(RUN_SUFFIX_PATTERN, '');
}

/** The run number carried by `chainId`, or `undefined` for a bare base id. */
export function parseRunNumber(chainId: string): number | undefined {
  const match = chainId.match(RUN_SUFFIX_PATTERN);
  const digits = match?.[1];
  return digits === undefined ? undefined : Number.parseInt(digits, 10);
}

/** Build a run id. `baseChainId` may already carry a suffix; it is replaced, not appended. */
export function formatChainId(baseChainId: string, runNumber: number): string {
  return `${stripRunNumber(baseChainId)}#${runNumber}`;
}

/**
 * The run number to mint next, given a chain's run history oldest-first.
 *
 * Counts from the last entry rather than the length so a pruned or partially recorded
 * history still advances instead of colliding with a live run. Falls back to
 * `length + 1` when the last entry carries no parseable suffix.
 */
export function nextRunNumber(runHistory: readonly string[]): number {
  if (runHistory.length === 0) {
    return 1;
  }
  const lastRunId = runHistory[runHistory.length - 1];
  const lastRunNumber = lastRunId === undefined ? undefined : parseRunNumber(lastRunId);
  return lastRunNumber === undefined ? runHistory.length + 1 : lastRunNumber + 1;
}

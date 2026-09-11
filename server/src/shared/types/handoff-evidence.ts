// @lifecycle canonical - Delegation handoff evidence vocabulary shared by config, records, and the contract module.
/**
 * The two closed vocabularies of the delegation handoff contract, kept in `shared/types` so that
 * `core-config.ts` (the mode) and `chain-execution.ts` (the recorded reason) do not depend on the
 * engine layer. `engine/execution/delegation/handoff-contract.ts` owns every function over them
 * and re-exports these names for its own consumers.
 */

/** Whether an unacceptable handoff trailer merely records (`advisory`) or refuses the resume. */
export type HandoffEvidenceMode = 'advisory' | 'required';

/**
 * What a delegated step's resume actually carried, as ONE value rather than a boolean.
 *
 * `ok` — the trailer named this node. `trailer` — no `HANDOFF RESULT` heading at all.
 * `node-line` — a heading with no `node:` line. `node-mismatch` — a `node:` line naming some
 * other node. This is what `execution_records.handoff_evidence` stores for every delegated step
 * (NULL only for a step that was not delegated), in BOTH modes (R1, 2026-09-08).
 */
export type HandoffEvidenceReason = 'ok' | 'trailer' | 'node-line' | 'node-mismatch';

/**
 * Every value the resolver can return, in one exported list. The `handoff_evidence` CHECK
 * constraint in `sqlite-engine.ts` enumerates the same four strings; a test compares that DDL
 * against this array, so the column cannot admit a value the resolver never produces.
 */
export const HANDOFF_EVIDENCE_REASONS: readonly HandoffEvidenceReason[] = [
  'ok',
  'trailer',
  'node-line',
  'node-mismatch',
];

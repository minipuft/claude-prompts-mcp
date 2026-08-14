// @lifecycle canonical - Applies typed unknown observations to a chain run's unknowns ledger.
import type { Logger } from '#infra/logging/index.js';
import type {
  ChainSessionService,
  UnknownLedgerEntry,
  UnknownObservation,
} from '#shared/types/chain-session.js';
import type { ExecutionContext } from '../context/index.js';

import { ValidationError } from '#shared/utils/index.js';

/**
 * Hard cap on ledger rows per chain run. Exceeding it is a validation error, not a
 * silent truncation: a run that has opened 200 unresolved unknowns has a modelling
 * problem the caller must see, and dropping rows would make the ledger lie about it.
 */
export const UNKNOWN_LEDGER_MAX_ENTRIES = 200;

/**
 * An observation batch that cannot be applied to the current ledger.
 *
 * Distinct class (not bare `ValidationError`) so the capture stage can map exactly
 * this failure to a tool-result error and let every other throw — notably a persist
 * failure from the session store — propagate to the pipeline's error boundary.
 */
export class UnknownObservationValidationError extends ValidationError {}

/**
 * Compute the ledger that results from applying `observations` to `currentLedger`.
 *
 * Pure: no I/O, no mutation of the input. The single owner of unknowns-ledger
 * transition rules — the session store calls this rather than restating them.
 *
 * Semantics (two-state machine: active <-> resolved):
 * - discover + new id            -> append an active entry stamped at `stepNumber`
 * - discover + active id         -> restatement; refresh statement/blocking/targetStepId, keep discoveredAtStep
 * - discover + resolved id       -> re-open; the unknown genuinely returned, so this IS a new
 *                                   discovery event and re-stamps discoveredAtStep
 * - resolve  + active id         -> close; resolution + resolutionStatement + resolvedAtStep
 * - resolve  + resolved id       -> idempotent refresh; resolvedAtStep keeps the first close
 * - resolve  + unknown id        -> validation error naming the id
 *
 * Entries in one batch are applied in order, so a later entry observes the effect of
 * an earlier one (discover then resolve in a single call closes the same entry).
 * The batch is all-or-nothing: the first invalid observation throws before the caller
 * sees any result, so a rejected batch never half-applies.
 *
 * @throws UnknownObservationValidationError on an invalid transition or cap overflow.
 */
export function computeUnknownLedger(
  currentLedger: readonly UnknownLedgerEntry[],
  observations: readonly UnknownObservation[],
  stepNumber: number
): UnknownLedgerEntry[] {
  const nextLedger = currentLedger.map((entry) => ({ ...entry }));
  const byId = new Map(nextLedger.map((entry) => [entry.id, entry]));

  observations.forEach((observation, index) => {
    const position = index + 1;
    const existing = byId.get(observation.id);

    if (observation.type === 'unknown_discovered') {
      if (existing === undefined) {
        assertCapacity(nextLedger.length, observation.id, position);
        const created = createEntry(observation, stepNumber);
        nextLedger.push(created);
        byId.set(created.id, created);
        return;
      }
      applyDiscoveryToExisting(existing, observation, stepNumber);
      return;
    }

    if (existing === undefined) {
      throw new UnknownObservationValidationError(
        `Cannot resolve unknown "${observation.id}" (observation ${position}): no entry with that id exists in this run's ledger. Declare it with unknown_discovered first.`
      );
    }
    applyResolutionToExisting(existing, observation, stepNumber, position);
  });

  return nextLedger;
}

function assertCapacity(currentSize: number, id: string, position: number): void {
  if (currentSize < UNKNOWN_LEDGER_MAX_ENTRIES) return;
  throw new UnknownObservationValidationError(
    `Unknowns ledger is at its ${UNKNOWN_LEDGER_MAX_ENTRIES}-entry cap for this run; observation ${position} would open a new unknown "${id}". Resolve existing unknowns before declaring new ones.`
  );
}

function createEntry(observation: UnknownObservation, stepNumber: number): UnknownLedgerEntry {
  return {
    id: observation.id,
    statement: observation.statement,
    state: 'active',
    blocking: observation.blocking ?? false,
    discoveredAtStep: stepNumber,
    // Carries observation.target_step_id (wire snake_case) onto the ledger's targetStepId
    // (internal camelCase) so it is still readable at resolution time — see
    // UnknownLedgerEntry.targetStepId docblock in chain-session.ts.
    ...(observation.target_step_id !== undefined
      ? { targetStepId: observation.target_step_id }
      : {}),
  };
}

function applyDiscoveryToExisting(
  entry: UnknownLedgerEntry,
  observation: UnknownObservation,
  stepNumber: number
): void {
  entry.statement = observation.statement;
  entry.blocking = observation.blocking ?? false;
  // Authoritative refresh, same posture as `blocking` above: a restatement that omits
  // target_step_id clears a previously-declared one rather than silently keeping a stale
  // target the caller no longer intends. Deleted rather than set to `undefined` so the key's
  // presence/absence matches createEntry's `targetStepId` (conditionally spread, never present
  // with an explicit `undefined` value) — an inconsistent representation of "no target" would
  // make consumers' `'targetStepId' in entry` / `toHaveProperty` checks disagree with `?? `
  // defaulting checks elsewhere in the ledger.
  if (observation.target_step_id !== undefined) {
    entry.targetStepId = observation.target_step_id;
  } else {
    delete entry.targetStepId;
  }

  if (entry.state === 'active') return;

  // Re-open: a resolved unknown that is discovered again is open once more, and the
  // step that re-opened it is the one worth reporting.
  entry.state = 'active';
  entry.discoveredAtStep = stepNumber;
  delete entry.resolution;
  delete entry.resolutionStatement;
  delete entry.resolvedAtStep;
}

function applyResolutionToExisting(
  entry: UnknownLedgerEntry,
  observation: UnknownObservation,
  stepNumber: number,
  position: number
): void {
  const resolution = observation.resolution;
  if (resolution === undefined) {
    throw new UnknownObservationValidationError(
      `Observation ${position} resolves unknown "${observation.id}" without a resolution. unknown_resolved requires resolution: "answered" | "irrelevant".`
    );
  }

  entry.resolution = resolution;
  entry.resolutionStatement = observation.statement;
  if (entry.state === 'active') {
    entry.state = 'resolved';
    entry.resolvedAtStep = stepNumber;
  }
}

/**
 * Applies a step's typed unknown observations to its chain run's ledger.
 *
 * Owns transition validation (via `computeUnknownLedger` above) and the session-store
 * call; owns no persistence of its own. Throws rather than swallowing so the capture
 * stage remains the single catch boundary.
 */
export class UnknownObservationProcessor {
  constructor(
    private readonly chainSessionStore: ChainSessionService,
    private readonly logger: Logger
  ) {}

  /**
   * Apply `observations` to the session's ledger and return the updated ledger.
   *
   * @throws UnknownObservationValidationError for an invalid batch (caller maps to a
   *   tool-result error); any other error indicates a persist/lookup failure and must
   *   reach the pipeline error boundary unchanged.
   */
  async applyObservations(
    context: ExecutionContext,
    sessionId: string,
    nodeId: string,
    observations: readonly UnknownObservation[]
  ): Promise<UnknownLedgerEntry[]> {
    if (observations.length === 0) {
      return [];
    }

    const ledger = await this.chainSessionStore.applyUnknownObservations(sessionId, nodeId, [
      ...observations,
    ]);

    const activeCount = ledger.filter((entry) => entry.state === 'active').length;
    context.diagnostics.info('UnknownObservationProcessor', 'Applied unknown observations', {
      sessionId,
      nodeId,
      observations: observations.length,
      ledgerSize: ledger.length,
      active: activeCount,
      blocking: ledger.filter((entry) => entry.state === 'active' && entry.blocking).length,
    });
    this.logger.debug(
      `[UnknownObservationProcessor] Applied ${observations.length} observation(s) at node ${nodeId}; ledger now ${ledger.length} entr(ies), ${activeCount} active`
    );

    return ledger;
  }
}

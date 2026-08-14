// @lifecycle canonical - Append-only execution log writer for chain lifecycle transitions.
/**
 * ExecutionRecordStore
 *
 * Writes durable per-step (or per-chain when stepNumber is null) execution records
 * to the `execution_records` table. The append-only series forms the queryable
 * execution log consumed by:
 *  - v_execution_status view (Tier 4 Python hook read path)
 *  - In-process queries by sessionId/chainId
 *  - Future evidence contract validation (Tier 8)
 *
 * Identifiers are ULIDs so records sort lexicographically by creation order
 * without requiring an extra timestamp index for ordering.
 */

import { monotonicFactory } from 'ulid';

/**
 * Monotonic ULID factory — guarantees lexical ordering across rapid successive
 * calls within the same millisecond. Without this, two `ulid()` calls in the
 * same ms get random suffixes and sort non-deterministically.
 */
const ulid = monotonicFactory();

import type {
  ExecutionRecord,
  StepLifecycle,
  StepSubstate,
  InputRequiredReason,
  EvidencePayload,
  GateVerdictSummary,
} from '#shared/types/chain-execution.js';
import type { Logger } from '#shared/types/index.js';
import type { DatabasePort, StateStoreOptions } from '#shared/types/persistence.js';

import { resolveContinuityScopeId } from '#shared/utils/request-identity-scope.js';

interface ExecutionRecordRow {
  execution_id: string;
  tenant_id: string;
  organization_id: string | null;
  workspace_id: string | null;
  session_id: string;
  chain_id: string | null;
  step_number: number | null;
  node_id: string | null;
  prompt_id: string | null;
  status: string;
  substate_json: string | null;
  input_required_json: string | null;
  evidence_json: string | null;
  gate_verdicts_json: string;
  error_message: string | null;
  started_at: number;
  completed_at: number | null;
  steps_planned: number | null;
  gates_fired: number | null;
  gate_retries: number | null;
  unknowns_opened: number | null;
  unknowns_closed: number | null;
  nodes_inserted: number | null;
  nodes_skipped: number | null;
}

export interface ExecutionRecordAppendInput {
  sessionId: string;
  chainId?: string;
  stepNumber?: number;
  /**
   * Stable node identity of the step this record describes. Omitted by the two run-level
   * terminal writers, which describe a run rather than a node; `buildAppendParams` binds NULL
   * for them explicitly rather than letting the column go unnamed.
   */
  nodeId?: string;
  promptId?: string;
  status: StepLifecycle;
  substate?: StepSubstate;
  inputRequired?: InputRequiredReason;
  evidence?: EvidencePayload;
  gateVerdicts?: GateVerdictSummary[];
  errorMessage?: string;
  startedAt?: number;
  completedAt?: number;
  /**
   * Run-level telemetry, flat rather than nested: this file's existing flat-scalar style
   * (sessionId/chainId/stepNumber/promptId) maps one field to one column, which is what keeps
   * the column names literal in the INSERT below and therefore visible to
   * `validate:no-phantom-columns`. Bound only by the two terminal-record call sites.
   */
  stepsPlanned?: number;
  gatesFired?: number;
  gateRetries?: number;
  unknownsOpened?: number;
  unknownsClosed?: number;
  /**
   * P4 adaptive-mutation counters. Same terminal-rows-only posture as the five above — they
   * arrive on the same `getRunTelemetry` object both terminal writers spread, so a writer
   * cannot pick up one group and miss the other.
   */
  nodesInserted?: number;
  nodesSkipped?: number;
  scope?: StateStoreOptions;
}

/** Default page size for `queryRecent` when a caller does not specify one. */
const DEFAULT_RECENT_LIMIT = 50;

/** Ceiling for `queryRecent`, so a caller cannot request the entire ledger in one call. */
const MAX_RECENT_LIMIT = 500;

/** Coerce an untrusted limit into `[1, MAX_RECENT_LIMIT]`; non-finite input falls back to default. */
function clampRecentLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_RECENT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_RECENT_LIMIT);
}

export class ExecutionRecordStore {
  constructor(
    private readonly db: DatabasePort,
    private readonly logger: Logger
  ) {}

  /**
   * Append a record describing one lifecycle transition. Returns the generated
   * executionId. Best-effort: failures are logged at warn level but do not throw
   * — emission must never break pipeline execution.
   */
  append(input: ExecutionRecordAppendInput): string {
    const executionId = ulid();
    const params = buildAppendParams(executionId, input, this.resolveTenantId(input.scope));

    try {
      this.db.run(
        `INSERT INTO execution_records (
          execution_id, tenant_id, organization_id, workspace_id,
          session_id, chain_id, step_number, node_id, prompt_id, status,
          substate_json, input_required_json, evidence_json, gate_verdicts_json,
          error_message, started_at, completed_at,
          steps_planned, gates_fired, gate_retries, unknowns_opened, unknowns_closed,
          nodes_inserted, nodes_skipped
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params
      );
    } catch (error) {
      this.logger.warn(
        `[ExecutionRecordStore] Failed to append record for session ${input.sessionId} step ${input.stepNumber ?? 'chain'}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return executionId;
  }
  /**
   * Return all records for a session ordered by creation (ULID order).
   * Scope filter is applied when provided so cross-tenant rows are excluded.
   */
  queryBySession(sessionId: string, scope?: StateStoreOptions): ExecutionRecord[] {
    const tenantId = this.resolveTenantId(scope);
    const rows = this.db.query<ExecutionRecordRow>(
      `SELECT * FROM execution_records
       WHERE session_id = ? AND tenant_id = ?
       ORDER BY execution_id ASC`,
      [sessionId, tenantId]
    );
    return rows.map((row) => this.fromRow(row));
  }

  /**
   * Return the most recent records for the resolved scope, newest first.
   *
   * Ordering is by `execution_id` rather than by `started_at` because ULIDs are
   * monotonic (see the factory above): they sort lexicographically by creation even
   * for records written inside the same millisecond, which a timestamp sort does not.
   *
   * `limit` is clamped rather than trusted — this backs an MCP-facing action, and an
   * unbounded LIMIT against an append-only table with no retention (see the
   * `execution_records` contract) would let one call read the whole ledger.
   */
  queryRecent(limit: number = DEFAULT_RECENT_LIMIT, scope?: StateStoreOptions): ExecutionRecord[] {
    const tenantId = this.resolveTenantId(scope);
    const rows = this.db.query<ExecutionRecordRow>(
      `SELECT * FROM execution_records
       WHERE tenant_id = ?
       ORDER BY execution_id DESC
       LIMIT ?`,
      [tenantId, clampRecentLimit(limit)]
    );
    return rows.map((row) => this.fromRow(row));
  }

  /**
   * Return all records for a chain ordered by creation (ULID order).
   */
  queryByChain(chainId: string, scope?: StateStoreOptions): ExecutionRecord[] {
    const tenantId = this.resolveTenantId(scope);
    const rows = this.db.query<ExecutionRecordRow>(
      `SELECT * FROM execution_records
       WHERE chain_id = ? AND tenant_id = ?
       ORDER BY execution_id ASC`,
      [chainId, tenantId]
    );
    return rows.map((row) => this.fromRow(row));
  }

  private resolveTenantId(scope?: StateStoreOptions): string {
    if (scope?.continuityScopeId !== undefined) {
      return scope.continuityScopeId;
    }
    return resolveContinuityScopeId(scope ?? {});
  }

  private fromRow(row: ExecutionRecordRow): ExecutionRecord {
    return {
      executionId: row.execution_id,
      sessionId: row.session_id,
      chainId: row.chain_id ?? undefined,
      stepNumber: row.step_number ?? undefined,
      nodeId: row.node_id ?? undefined,
      promptId: row.prompt_id ?? undefined,
      status: row.status as StepLifecycle,
      substate: parseJson<StepSubstate>(row.substate_json),
      inputRequired: parseJson<InputRequiredReason>(row.input_required_json),
      evidence: parseJson<EvidencePayload>(row.evidence_json),
      gateVerdicts: parseJsonArray<GateVerdictSummary>(row.gate_verdicts_json),
      errorMessage: row.error_message ?? undefined,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      organizationId: row.organization_id ?? undefined,
      workspaceId: row.workspace_id ?? undefined,
      stepsPlanned: row.steps_planned ?? undefined,
      gatesFired: row.gates_fired ?? undefined,
      gateRetries: row.gate_retries ?? undefined,
      unknownsOpened: row.unknowns_opened ?? undefined,
      unknownsClosed: row.unknowns_closed ?? undefined,
      nodesInserted: row.nodes_inserted ?? undefined,
      nodesSkipped: row.nodes_skipped ?? undefined,
    };
  }
}

function buildAppendParams(
  executionId: string,
  input: ExecutionRecordAppendInput,
  tenantId: string
): unknown[] {
  const startedAt = input.startedAt ?? Date.now();
  const gateVerdicts = input.gateVerdicts ?? [];
  return [
    executionId,
    tenantId,
    input.scope?.organizationId ?? null,
    input.scope?.workspaceId ?? null,
    input.sessionId,
    input.chainId ?? null,
    input.stepNumber ?? null,
    input.nodeId ?? null,
    input.promptId ?? null,
    input.status,
    input.substate !== undefined ? JSON.stringify(input.substate) : null,
    input.inputRequired !== undefined ? JSON.stringify(input.inputRequired) : null,
    input.evidence !== undefined ? JSON.stringify(input.evidence) : null,
    JSON.stringify(gateVerdicts),
    input.errorMessage ?? null,
    startedAt,
    input.completedAt ?? null,
    input.stepsPlanned ?? null,
    input.gatesFired ?? null,
    input.gateRetries ?? null,
    input.unknownsOpened ?? null,
    input.unknownsClosed ?? null,
    input.nodesInserted ?? null,
    input.nodesSkipped ?? null,
  ];
}

function parseJson<T>(raw: string | null): T | undefined {
  if (raw === null || raw === '') return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function createExecutionRecordStore(db: DatabasePort, logger: Logger): ExecutionRecordStore {
  return new ExecutionRecordStore(db, logger);
}

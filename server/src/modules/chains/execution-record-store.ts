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

import { resolveContinuityScopeId } from '../../shared/utils/request-identity-scope.js';

import type {
  ExecutionRecord,
  StepLifecycle,
  StepSubstate,
  InputRequiredReason,
  EvidencePayload,
  GateVerdictSummary,
} from '../../shared/types/chain-execution.js';
import type { Logger } from '../../shared/types/index.js';
import type { DatabasePort, StateStoreOptions } from '../../shared/types/persistence.js';

interface ExecutionRecordRow {
  execution_id: string;
  tenant_id: string;
  organization_id: string | null;
  workspace_id: string | null;
  session_id: string;
  chain_id: string | null;
  step_number: number | null;
  prompt_id: string | null;
  status: string;
  substate_json: string | null;
  input_required_json: string | null;
  evidence_json: string | null;
  gate_verdicts_json: string;
  error_message: string | null;
  started_at: number;
  completed_at: number | null;
}

export interface ExecutionRecordAppendInput {
  sessionId: string;
  chainId?: string;
  stepNumber?: number;
  promptId?: string;
  status: StepLifecycle;
  substate?: StepSubstate;
  inputRequired?: InputRequiredReason;
  evidence?: EvidencePayload;
  gateVerdicts?: GateVerdictSummary[];
  errorMessage?: string;
  startedAt?: number;
  completedAt?: number;
  scope?: StateStoreOptions;
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
          session_id, chain_id, step_number, prompt_id, status,
          substate_json, input_required_json, evidence_json, gate_verdicts_json,
          error_message, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    input.promptId ?? null,
    input.status,
    input.substate !== undefined ? JSON.stringify(input.substate) : null,
    input.inputRequired !== undefined ? JSON.stringify(input.inputRequired) : null,
    input.evidence !== undefined ? JSON.stringify(input.evidence) : null,
    JSON.stringify(gateVerdicts),
    input.errorMessage ?? null,
    startedAt,
    input.completedAt ?? null,
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

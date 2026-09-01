// @lifecycle canonical - Per-row persistence for chain runs (chain_runs + chain_run_nodes).
/**
 * Chain run persistence.
 *
 * Replaces the `chain_run_registry` JSON blob (retired at schema v22). The blob carried every
 * run, every node, every step's lifecycle metadata AND three chain-id mapping dictionaries in one
 * opaque document, so answering "which node is this run standing at" meant parsing all of it.
 *
 * The mapping dictionaries are deliberately NOT persisted. `runMapping` (chainId -> sessionIds)
 * is `session.chainId` read the other way round; `baseRunMapping` and `runToBase` are
 * `stripRunNumber(chainId)` applied to the same data. Storing three derivable indexes alongside
 * their source is how they drift, and `ChainSessionStore.ensureRunMappingConsistency()` already
 * rebuilds all three from the chain ids at load. `base_chain_id` is stored as a column because a
 * query needs it, and it comes from the same `stripRunNumber` the rebuild uses.
 *
 * `current_node_id` is the single source for where a run stands. The residual `state` document
 * does not carry it — see the v22 note in `sqlite-engine.ts`.
 */
import type {
  ChainNode,
  ChainRunStatus,
  StepLifecycle,
  StepMetadata,
} from '#shared/types/chain-execution.js';
import type {
  ChainHandoffClaimResult,
  ChainSession,
  ChainSessionLifecycle,
  SessionBlueprint,
  UnknownLedgerEntry,
} from '#shared/types/chain-session.js';
import type { DatabasePort, StateStoreOptions } from '#shared/types/persistence.js';

import { stripRunNumber } from '#shared/utils/chain-id-codec.js';

export interface ChainRunRegistry {
  ensureInitialized(): Promise<void>;
  /** Every run owned by the scope's run owner, with its nodes in position order. */
  load(scope?: StateStoreOptions): Promise<ChainSession[]>;
  /** Replace the scope owner's runs wholesale. Must run inside the caller's transaction. */
  /**
   * Replace this owner's runs with `sessions`. Returns the session ids that were NOT written
   * because another owner has claimed them since (2A handoff) — the caller evicts those from
   * memory, since the claimer's row is now the run.
   */
  save(sessions: readonly ChainSession[], scope?: StateStoreOptions): Promise<string[]>;
  /**
   * Transfer the run carrying `token` to the owner/scope in `scope`, nulling the token in the
   * same statement so it cannot be claimed twice (2A). Refuses a row whose workspace differs
   * from the claimant's when both are known.
   */
  claimRunByToken(token: string, scope?: StateStoreOptions): ClaimRunResult;
  /** Drop every run owned by a process that is no longer alive. */
  deleteRunsForOwners(ownerPids: readonly string[]): void;
}

/** The document-shaped remainder of a session, everything the columns do not carry. */
interface ResidualRunState {
  executionOrder?: string[];
  originalArgs?: Record<string, unknown>;
  continuityScopeId?: string;
  pendingGateReview?: unknown;
  pendingShellVerification?: unknown;
  blueprint?: SessionBlueprint;
  lifecycle?: ChainSessionLifecycle;
  unknownsLedger?: UnknownLedgerEntry[];
  gatesFiredCount?: number;
  gateRetriesCount?: number;
  /** ChainState.lastUpdated — a timestamp on the state document, not on the run. */
  stateLastUpdated?: number;
}

interface ChainRunRow {
  session_id: string;
  chain_id: string;
  run_status: string;
  current_node_id: string | null;
  state: string;
  created_at: number | null;
  last_activity: number | null;
  run_completed_at: number | null;
  handoff_token: string | null;
}

/** What a registry claim hands back: the run, or the reason it was refused at the row level. */
export type ClaimRunResult = Exclude<ChainHandoffClaimResult, { status: 'no-blueprint' }>;

interface ChainRunNodeRow {
  session_id: string;
  node_id: string;
  position: number;
  prompt_id: string;
  step_name: string | null;
  milestone: string | null;
  is_placeholder: number | null;
  rendered_at: number | null;
  declared_sections_json?: string | null;
  responded_at: number | null;
  completed_at: number | null;
  /**
   * P4 (v23). Typed `string | null` rather than the DDL's `TEXT NOT NULL` because this shape
   * describes what a SELECT hands back, and nothing stops a row from predating the column or
   * carrying a value outside the union — {@link reconstructNodeOrigin} is the single place that
   * narrows it, and it narrows anything unrecognized to 'planned'.
   */
  origin: string | null;
  origin_unknown_id: string | null;
  /**
   * A.5 (v27). What a caller-contributed node declared about itself: `delegated` is 0/1/NULL
   * (NULL = declared nothing), `args_json` a JSON object or NULL. Typed loosely for the same
   * reason `origin` is — this is what a SELECT hands back, and {@link reconstructNode} is the
   * single place that narrows it.
   */
  delegated: number | null;
  args_json: string | null;
}

/**
 * Chain run persistence backed directly by DatabasePort (no infra/ dependency).
 * Used when DatabasePort is injected from the runtime layer to avoid modules/ → infra/ imports.
 */
export class DirectChainRunRegistry implements ChainRunRegistry {
  constructor(private readonly db: DatabasePort) {}

  async ensureInitialized(): Promise<void> {
    // Tables created by SqliteEngine.applySchema() during db.initialize()
  }

  async load(scope?: StateStoreOptions): Promise<ChainSession[]> {
    const runOwnerPid = resolveRunOwnerPid(scope);

    const runRows = this.db.query<ChainRunRow>(
      `SELECT session_id, chain_id, run_status, current_node_id, state,
              created_at, last_activity, run_completed_at, handoff_token
         FROM chain_runs
        WHERE run_owner_pid = ?`,
      [runOwnerPid]
    );
    if (runRows.length === 0) return [];

    const nodeRows = this.db.query<ChainRunNodeRow>(
      `SELECT n.session_id, n.node_id, n.position, n.prompt_id, n.step_name, n.milestone,
              n.is_placeholder, n.rendered_at, n.responded_at, n.completed_at,
              n.declared_sections_json,
              n.origin, n.origin_unknown_id, n.delegated, n.args_json
         FROM chain_run_nodes n
         JOIN chain_runs r ON r.session_id = n.session_id
        WHERE r.run_owner_pid = ?
        ORDER BY n.session_id, n.position`,
      [runOwnerPid]
    );

    const nodesBySession = new Map<string, ChainRunNodeRow[]>();
    for (const row of nodeRows) {
      const bucket = nodesBySession.get(row.session_id);
      if (bucket === undefined) {
        nodesBySession.set(row.session_id, [row]);
      } else {
        bucket.push(row);
      }
    }

    return runRows.map((row) => reconstructSession(row, nodesBySession.get(row.session_id) ?? []));
  }

  /**
   * Replace this owner's runs with `sessions`.
   *
   * Delete-then-insert rather than UPSERT, mirroring `projectToHookView`: a run cleared from
   * memory must disappear from storage in the same write, and an UPSERT would leave it behind
   * unless a separate reconciling DELETE ran anyway. The caller (`persistSessions`) owns the
   * transaction, so the window where a PID has no rows is never observable.
   */
  async save(sessions: readonly ChainSession[], scope?: StateStoreOptions): Promise<string[]> {
    const runOwnerPid = resolveRunOwnerPid(scope);
    const organizationId = scope?.organizationId ?? null;
    const workspaceId = scope?.workspaceId ?? null;

    this.db.run(
      `DELETE FROM chain_run_nodes
        WHERE session_id IN (SELECT session_id FROM chain_runs WHERE run_owner_pid = ?)`,
      [runOwnerPid]
    );
    this.db.run('DELETE FROM chain_runs WHERE run_owner_pid = ?', [runOwnerPid]);

    // A run another owner has claimed (2A) still sits in this process's memory until the next
    // persist — which is now. Its row survived the owner-scoped DELETE above because the claim
    // rewrote run_owner_pid, so inserting it again would collide on the primary key and take the
    // whole save down. Skip it and report it, so the caller evicts the stale copy.
    const claimedElsewhere = this.findRunsOwnedByOthers(
      sessions.map((session) => session.sessionId),
      runOwnerPid
    );

    const updatedAt = Date.now();
    for (const session of sessions) {
      if (claimedElsewhere.has(session.sessionId)) continue;
      this.db.run(
        `INSERT INTO chain_runs (
           session_id, chain_id, base_chain_id, run_owner_pid, organization_id, workspace_id,
           run_status, current_node_id, state, created_at, last_activity, run_completed_at,
           handoff_token
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session.sessionId,
          session.chainId,
          stripRunNumber(session.chainId),
          runOwnerPid,
          organizationId,
          workspaceId,
          session.runStatus ?? 'working',
          session.state.currentNodeId,
          JSON.stringify(toResidual(session)),
          session.startTime,
          session.lastActivity,
          session.runCompletedAt ?? null,
          session.handoffToken ?? null,
        ]
      );

      const stepStates = session.state.stepStates;
      session.state.nodes.forEach((node, index) => {
        const metadata = stepStates?.get(node.id);
        this.db.run(
          `INSERT INTO chain_run_nodes (
             session_id, node_id, position, prompt_id, step_name, milestone,
             is_placeholder, rendered_at, responded_at, completed_at,
             origin, origin_unknown_id, declared_sections_json, delegated, args_json, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            session.sessionId,
            node.id,
            index + 1,
            node.promptId,
            node.stepName,
            metadata?.state ?? null,
            metadata === undefined ? null : metadata.isPlaceholder ? 1 : 0,
            metadata?.renderedAt ?? null,
            metadata?.respondedAt ?? null,
            metadata?.completedAt ?? null,
            // The column is NOT NULL with no DDL default, so this bind is the only source of
            // the value — a real 'planned'/'inserted' string on every row, never a NULL that a
            // default would paper over.
            node.origin ?? 'planned',
            node.originUnknownId ?? null,
            // Serialised only when the render recorded one. A step that declared nothing and a
            // step whose declaration was never recorded are the same row here, and both mean the
            // verification stage has no declared header to block on.
            metadata?.declaredSections === undefined
              ? null
              : JSON.stringify(metadata.declaredSections),
            // A.5: the node's own declaration. NULL rather than 0/'{}' when absent, so "declared
            // nothing" and "declared not delegated" stay distinguishable on the row.
            node.delegated === undefined ? null : node.delegated ? 1 : 0,
            node.args === undefined ? null : JSON.stringify(node.args),
            updatedAt,
          ]
        );
      });
    }
    return [...claimedElsewhere];
  }

  /** Session ids among `sessionIds` whose row is currently owned by someone other than `ownerPid`. */
  private findRunsOwnedByOthers(sessionIds: readonly string[], ownerPid: string): Set<string> {
    const result = new Set<string>();
    if (sessionIds.length === 0) return result;
    const placeholders = sessionIds.map(() => '?').join(', ');
    const rows = this.db.query<{ session_id: string }>(
      `SELECT session_id FROM chain_runs
        WHERE session_id IN (${placeholders}) AND run_owner_pid != ?`,
      [...sessionIds, ownerPid]
    );
    for (const row of rows) result.add(row.session_id);
    return result;
  }

  claimRunByToken(token: string, scope?: StateStoreOptions): ClaimRunResult {
    const claimantPid = resolveRunOwnerPid(scope);
    const claimantWorkspace = scope?.workspaceId ?? null;
    const claimantOrganization = scope?.organizationId ?? null;

    const row = this.db.queryOne<ChainRunRow & { workspace_id: string | null }>(
      `SELECT session_id, chain_id, run_status, current_node_id, state,
              created_at, last_activity, run_completed_at, handoff_token, workspace_id
         FROM chain_runs
        WHERE handoff_token = ?`,
      [token]
    );
    if (row === null) return { status: 'unknown-token' };

    // OQ-3: a claim never rewrites workspace scope. Known-and-different is refused; an unknown
    // side (NULL) is not evidence of a mismatch.
    if (
      row.workspace_id !== null &&
      claimantWorkspace !== null &&
      row.workspace_id !== claimantWorkspace
    ) {
      return {
        status: 'workspace-mismatch',
        rowWorkspaceId: row.workspace_id,
        claimantWorkspaceId: claimantWorkspace,
      };
    }

    // Ownership transfer and token burn in ONE statement: a second claimant racing on the same
    // token finds no row matching it, rather than a window where both own the run.
    this.db.run(
      `UPDATE chain_runs
          SET run_owner_pid = ?, organization_id = COALESCE(?, organization_id),
              workspace_id = COALESCE(?, workspace_id), handoff_token = NULL
        WHERE session_id = ? AND handoff_token = ?`,
      [claimantPid, claimantOrganization, claimantWorkspace, row.session_id, token]
    );

    const nodeRows = this.db.query<ChainRunNodeRow>(
      `SELECT session_id, node_id, position, prompt_id, step_name, milestone,
              is_placeholder, rendered_at, responded_at, completed_at,
              declared_sections_json, origin, origin_unknown_id
         FROM chain_run_nodes
        WHERE session_id = ?
        ORDER BY position`,
      [row.session_id]
    );
    const session = reconstructSession({ ...row, handoff_token: null }, nodeRows);
    return { status: 'claimed', session };
  }

  deleteRunsForOwners(ownerPids: readonly string[]): void {
    for (const pid of ownerPids) {
      this.db.run(
        `DELETE FROM chain_run_nodes
          WHERE session_id IN (SELECT session_id FROM chain_runs WHERE run_owner_pid = ?)`,
        [pid]
      );
      this.db.run('DELETE FROM chain_runs WHERE run_owner_pid = ?', [pid]);
    }
  }
}

/**
 * Resolve which owning process a scope addresses.
 *
 * `continuityScopeId` first, matching the blob registry it replaces: the caller merges the PID
 * scope with the workspace scope, and the PID is what decides row ownership. The workspace keys
 * fill the scope columns and must not be able to change who owns a run.
 */
function resolveRunOwnerPid(scope?: StateStoreOptions): string {
  return scope?.continuityScopeId ?? scope?.workspaceId ?? scope?.organizationId ?? 'default';
}

function toResidual(session: ChainSession): ResidualRunState {
  const residual: ResidualRunState = {
    executionOrder: [...session.executionOrder],
    originalArgs: session.originalArgs,
    // `?? 'canonical'` reproduces the blob writer's default: a session with no explicit
    // lifecycle was serialized as canonical, and load demotes everything to dormant anyway.
    lifecycle: session.lifecycle ?? 'canonical',
    stateLastUpdated: session.state.lastUpdated,
  };
  if (session.continuityScopeId !== undefined)
    residual.continuityScopeId = session.continuityScopeId;
  if (session.pendingGateReview !== undefined)
    residual.pendingGateReview = session.pendingGateReview;
  if (session.pendingShellVerification !== undefined) {
    residual.pendingShellVerification = session.pendingShellVerification;
  }
  if (session.blueprint !== undefined) residual.blueprint = session.blueprint;
  if (session.unknownsLedger !== undefined) residual.unknownsLedger = session.unknownsLedger;
  if (session.gatesFiredCount !== undefined) residual.gatesFiredCount = session.gatesFiredCount;
  if (session.gateRetriesCount !== undefined) residual.gateRetriesCount = session.gateRetriesCount;
  return residual;
}

function parseResidual(raw: string): ResidualRunState {
  try {
    const parsed = JSON.parse(raw) as ResidualRunState | null;
    return parsed !== null && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Narrow the persisted `origin` string to the {@link ChainNode} union.
 *
 * Anything that is not a recognized non-default member reads as 'planned', including NULL. That
 * is the conservative direction on purpose: mis-reading a planned node as inserted would inflate
 * the run's insertion count and silently exhaust the P4 cap, while the reverse only loses
 * provenance on a row the schema says cannot exist (the column is NOT NULL, and v23 recreates
 * the table).
 *
 * Every non-default member must be listed here. This function is the ONLY place a persisted
 * origin becomes a typed one, so a member added to the union and not added here round-trips to
 * 'planned' after a cold load — the run's caps would then recompute against a provenance the
 * writer never lost, which is exactly the silent-drop shape the NOT NULL column exists to
 * prevent on the write side.
 */
function reconstructNodeOrigin(raw: string | null): 'planned' | 'inserted' | 'remainder' {
  if (raw === 'inserted' || raw === 'remainder') {
    return raw;
  }
  return 'planned';
}

/** A node's declared argument bag, or `undefined` when the column is NULL or undecodable. */
function parseNodeArgs(raw: string | null): Record<string, unknown> | undefined {
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Rebuild one {@link ChainNode} from its row, provenance included.
 *
 * `origin` is always set here even though the field is optional on the type: a node that has
 * been through storage should never leave a reader to re-apply the default.
 */
function reconstructNode(node: ChainRunNodeRow): ChainNode {
  const reconstructed: ChainNode = {
    id: node.node_id,
    promptId: node.prompt_id,
    stepName: node.step_name ?? '',
    origin: reconstructNodeOrigin(node.origin),
  };
  // Assigned only when present: `exactOptionalPropertyTypes` rejects an explicit `undefined`,
  // and the hook-projection tests pin the resulting key set.
  if (node.origin_unknown_id !== null) {
    reconstructed.originUnknownId = node.origin_unknown_id;
  }
  // A.5: `delegated` and `args` are what a caller-contributed node declared about itself, and a
  // cold-loaded run has nowhere else to recover them from — `parsedCommand.steps` never had an
  // entry for this node. A malformed `args_json` is dropped rather than thrown on: the run is
  // resumable without it, and a throw here would take the whole owner's session load with it.
  if (node.delegated !== null) {
    reconstructed.delegated = node.delegated !== 0;
  }
  const args = parseNodeArgs(node.args_json);
  if (args !== undefined) {
    reconstructed.args = args;
  }
  return reconstructed;
}

/**
 * Read back the recorded declaration. A malformed or non-array payload is treated as absent
 * rather than thrown: this column records what a prompt declared, and a run must not fail to
 * resume because that record is unreadable — an absent declaration only relaxes enforcement.
 */
function parseDeclaredSections(raw: string | null | undefined): string[] | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return undefined;
  }
}

/** Rebuild the step-lifecycle map from the node rows. Rows with no milestone have no entry. */
function toStepStates(nodeRows: readonly ChainRunNodeRow[]): Map<string, StepMetadata> {
  const stepStates = new Map<string, StepMetadata>();
  for (const node of nodeRows) {
    if (node.milestone === null) continue;
    const metadata: StepMetadata = {
      state: node.milestone as StepLifecycle,
      isPlaceholder: node.is_placeholder === 1,
    };
    if (node.rendered_at !== null) metadata.renderedAt = node.rendered_at;
    if (node.responded_at !== null) metadata.respondedAt = node.responded_at;
    if (node.completed_at !== null) metadata.completedAt = node.completed_at;
    const declared = parseDeclaredSections(node.declared_sections_json);
    if (declared !== undefined) metadata.declaredSections = declared;
    stepStates.set(node.node_id, metadata);
  }
  return stepStates;
}

/**
 * Copy the residual document's optional fields onto the session.
 *
 * Assigned only when present, rather than assigned unconditionally: `ChainSession` distinguishes
 * an absent optional from one explicitly set to `undefined` in several places (the hook
 * projection tests pin the resulting key set), and `exactOptionalPropertyTypes` rejects the
 * unconditional form outright.
 */
function applyResidual(session: ChainSession, residual: ResidualRunState): void {
  const optional: Array<[keyof ResidualRunState, keyof ChainSession]> = [
    ['continuityScopeId', 'continuityScopeId'],
    ['pendingGateReview', 'pendingGateReview'],
    ['pendingShellVerification', 'pendingShellVerification'],
    ['blueprint', 'blueprint'],
    ['lifecycle', 'lifecycle'],
    ['unknownsLedger', 'unknownsLedger'],
    ['gatesFiredCount', 'gatesFiredCount'],
    ['gateRetriesCount', 'gateRetriesCount'],
  ];
  const target = session as unknown as Record<string, unknown>;
  for (const [from, to] of optional) {
    const value = residual[from];
    if (value !== undefined) target[to as string] = value;
  }
}

function reconstructSession(row: ChainRunRow, nodeRows: readonly ChainRunNodeRow[]): ChainSession {
  const residual = parseResidual(row.state);

  const session: ChainSession = {
    sessionId: row.session_id,
    chainId: row.chain_id,
    state: {
      currentNodeId: row.current_node_id,
      nodes: nodeRows.map(reconstructNode),
      lastUpdated: residual.stateLastUpdated ?? row.last_activity ?? 0,
      stepStates: toStepStates(nodeRows),
    },
    executionOrder: residual.executionOrder ?? [],
    startTime: row.created_at ?? 0,
    lastActivity: row.last_activity ?? 0,
    originalArgs: residual.originalArgs ?? {},
    runStatus: row.run_status as ChainRunStatus,
  };

  applyResidual(session, residual);
  if (row.run_completed_at !== null) session.runCompletedAt = row.run_completed_at;
  if (row.handoff_token !== null && row.handoff_token !== '') {
    session.handoffToken = row.handoff_token;
  }

  return session;
}

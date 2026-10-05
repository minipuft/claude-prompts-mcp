// @lifecycle canonical - In-memory registry for temporary/inline gates.
/**
 * Temporary Gate Registry
 *
 * Manages in-memory storage and lifecycle for execution-scoped gates that don't persist to filesystem.
 * Provides automatic cleanup, scope management, and integration with existing gate systems.
 */

import { toGateDefinition, type GateDefinitionSource } from './gate-definition-converter.js';

import type { GateEnforcementMode, GatePassCriteria, LightweightGateDefinition } from '../types.js';

import { Logger } from '#infra/logging/index.js';

/**
 * Temporary gate definition with lifecycle management
 */
export interface TemporaryGateDefinition {
  /**
   * Unique identifier
   * - Auto-generated (temp_${timestamp}_${random}) if not provided
   * - User-provided IDs must not match auto-generated pattern to avoid collisions
   * - Must match /^[A-Za-z0-9_-]+$/ pattern
   */
  id: string;
  /** Human-readable name */
  name: string;
  /** Gate type: 'validation' runs checks, 'guidance' only provides instructional text */
  type: 'validation' | 'guidance';
  /** Scope of the temporary gate */
  scope: 'execution' | 'session' | 'chain' | 'step';
  /** Description of what this gate checks/guides */
  description: string;
  /** Guidance text injected into prompts */
  guidance: string;
  /** Pass/fail criteria for validation gates */
  pass_criteria?: any[];
  /** Creation timestamp */
  created_at: number;
  /** Expiration timestamp (optional) */
  expires_at?: number;
  /** Source of gate creation */
  source: 'manual' | 'automatic' | 'analysis';
  /** Additional context for gate creation */
  context?: Record<string, any>;
  /** Associated execution/session/chain ID */
  scope_id?: string;
  /** Target specific step number in a chain (1-based) */
  target_step_number?: number;
  /**
   * Target a specific step by its stable node id. Resolved at registration alongside
   * `target_step_number` — whichever the caller supplied fills in the other — so gate
   * SELECTION stays positional (OQ5) while the identity survives on the definition.
   */
  target_step_id?: string;
  /** Target multiple specific steps in a chain (1-based) */
  apply_to_steps?: number[];
  /** What a FAIL does; absent means undeclared, and `resolveEnforcementMode` decides. */
  enforcement_mode?: GateEnforcementMode;
  /**
   * `'request'` for a gate the caller sent in the request's `gates` (a workflow's included). A
   * resume carries no `gates`, so a run reads its own request gates back by this mark (R47).
   */
  origin?: 'request';
  /**
   * The key the caller declared this gate under: a request gate's or inline definition's `id`,
   * or a named inline gate's binding key (`name`, `name#n`). The gate may have registered under a
   * fresh `<id>-N`; {@link TemporaryGateRegistry.resolveDeclared} resolves the key back to it for
   * the run that owns it (R49). Absent on a gate nobody named.
   */
  declared_key?: string;
}

/**
 * The keys `storeGate` decides rather than copies: the id it registered under, its own clock, the
 * scope it was filed under, and the declared key (which falls back to the requested id).
 */
type DecidedKey = 'id' | 'created_at' | 'expires_at' | 'scope_id' | 'declared_key';
type StoredKey = Exclude<keyof TemporaryGateDefinition, DecidedKey>;

/**
 * Every key a stored record copies as-is from the caller's definition — the same exhaustive table
 * `gate-definition-converter.ts` keeps over `LightweightGateDefinition`. `satisfies` fails the
 * typecheck both ways: a new `TemporaryGateDefinition` field until it is named here (or in
 * `DecidedKey`), and a key the interface does not declare. The record used to be rebuilt from a
 * hand-written field list, which dropped any field it did not list without a sound.
 */
const STORED_KEYS = {
  name: true,
  type: true,
  scope: true,
  description: true,
  guidance: true,
  source: true,
  pass_criteria: true,
  context: true,
  target_step_number: true,
  target_step_id: true,
  apply_to_steps: true,
  enforcement_mode: true,
  origin: true,
} as const satisfies Record<StoredKey, true>;

/** The caller's copied keys, each present only when the caller set it. Pure. */
function copyStoredKeys(
  definition: Omit<TemporaryGateDefinition, 'id' | 'created_at'>
): Pick<TemporaryGateDefinition, StoredKey> {
  const carried: Record<string, unknown> = {};
  for (const key of Object.keys(STORED_KEYS) as StoredKey[]) {
    const value = definition[key];
    if (value !== undefined) carried[key] = value;
  }
  return carried as Pick<TemporaryGateDefinition, StoredKey>;
}

/**
 * Scope management information
 */
interface ScopeInfo {
  scope_type: 'execution' | 'session' | 'chain' | 'step';
  scope_id: string;
  gates: Set<string>;
  created_at: number;
}

/**
 * Registry for managing temporary gates
 */
export class TemporaryGateRegistry {
  private logger: Logger;
  private temporaryGates: Map<string, TemporaryGateDefinition>;
  private scopeManagement: Map<string, ScopeInfo>;
  private cleanupTimers: Map<string, NodeJS.Timeout>;
  /**
   * Run (session id) -> the temporary gates that run owns, and the reverse (R47). A gate a run
   * adopts lives as long as the run and is removed by {@link releaseRun}; a gate no run adopts
   * lives for the call that registered it and is removed by {@link releaseUnowned}.
   */
  private runGates: Map<string, Set<string>>;
  private gateOwners: Map<string, string>;
  private maxMemoryGates: number;
  private defaultExpirationMs: number;
  private isCanonicalGateId: ((gateId: string) => boolean) | undefined;

  constructor(
    logger: Logger,
    options: {
      maxMemoryGates?: number;
      defaultExpirationMs?: number;
      /**
       * Whether an id names a canonical gate (P6.193, R94). Gate loading reads this registry
       * first and it is keyed by id per process, so a temporary gate under a canonical id would
       * replace that gate's criteria for every run while it lived: `createTemporaryGate` refuses
       * one, whichever caller chose the id. Absent, no id is refused.
       */
      isCanonicalGateId?: (gateId: string) => boolean;
    } = {}
  ) {
    this.logger = logger;
    this.temporaryGates = new Map();
    this.scopeManagement = new Map();
    this.cleanupTimers = new Map();
    this.runGates = new Map();
    this.gateOwners = new Map();
    this.maxMemoryGates = options.maxMemoryGates || 1000;
    this.defaultExpirationMs = options.defaultExpirationMs || 3600000; // 1 hour
    this.isCanonicalGateId = options.isCanonicalGateId;

    this.logger.debug('[TEMP GATE REGISTRY] Initialized with max gates:', this.maxMemoryGates);
  }

  /**
   * Create a new temporary gate
   */
  createTemporaryGate(
    definition: Omit<TemporaryGateDefinition, 'id' | 'created_at'> & { id?: string },
    scopeId?: string,
    options: {
      onIdCollision?: 'throw' | 'fresh-id';
      /**
       * `'fresh-id'` registers a canonical id under the first free `<id>-N` instead of refusing
       * it; only a claimed run's restore passes it, for a gate recorded before the refusal (R104).
       */
      onCanonicalId?: 'refuse' | 'fresh-id';
    } = {}
  ): string {
    const refusal =
      definition.id === undefined ? undefined : this.canonicalIdRefusal(definition.id);
    if (refusal !== undefined && options.onCanonicalId !== 'fresh-id') {
      throw new Error(refusal);
    }
    return this.storeGate(
      this.chooseGateId(definition.id, options.onIdCollision),
      definition,
      scopeId
    );
  }

  /**
   * The id a gate recorded under `id` would register under with `onIdCollision: 'fresh-id'` right
   * now: `id` when unheld and not canonical, else the first free `<id>-N`. For a restore that must
   * rewrite what it hands back before the registration happens (R110).
   */
  freshIdFor(id: string): string {
    return this.firstFreeId(id);
  }

  /** Whether `gateId` names a canonical gate, which no temporary gate may register under. */
  shadowsCanonicalGate(gateId: string): boolean {
    return this.isCanonicalGateId?.(gateId) === true;
  }

  /**
   * The refusal for a temporary gate under `gateId`, or undefined when it names no canonical gate:
   * one sentence for the registry's own throw and for the reply refusals that answer a call before
   * anything registers (R100).
   */
  canonicalIdRefusal(gateId: string): string | undefined {
    return this.shadowsCanonicalGate(gateId)
      ? `A temporary gate may not shadow a canonical gate id ('${gateId}'). Give it another id or name.`
      : undefined;
  }

  /**
   * Register a gate under exactly the id a run recorded for it — `temp_…` included, which
   * {@link createTemporaryGate} never accepts from a caller — for a run resumed in a process that
   * never registered its gates (R54: a claimed handoff). The run's blueprint references its gates
   * by those ids, so any other id would leave them unresolved. Returns false, and registers
   * nothing, when the id is already held. Throws, naming it, for a canonical id (R104): its one
   * caller restores generated `temp_…` ids, which no canonical gate carries.
   */
  restoreTemporaryGate(
    definition: Omit<TemporaryGateDefinition, 'created_at'>,
    scopeId?: string
  ): boolean {
    const { id, ...recorded } = definition;
    const refusal = this.canonicalIdRefusal(id);
    if (refusal !== undefined) {
      throw new Error(refusal);
    }
    if (this.temporaryGates.has(id)) {
      return false;
    }
    // `recorded` carries no `id`, so the gate keeps only the declared key it was recorded with.
    this.storeGate(id, recorded, scopeId);
    return true;
  }

  private storeGate(
    gateId: string,
    definition: Omit<TemporaryGateDefinition, 'id' | 'created_at'> & { id?: string },
    scopeId?: string
  ): string {
    // Check for ID collision
    if (this.temporaryGates.has(gateId)) {
      this.logger.warn(`[TEMP GATE REGISTRY] Gate ID collision: ${gateId}`);
      throw new Error(`Temporary gate ID already exists: ${gateId}`);
    }

    // Check memory limits
    if (this.temporaryGates.size >= this.maxMemoryGates) {
      this.performCleanup();
      if (this.temporaryGates.size >= this.maxMemoryGates) {
        throw new Error(`Temporary gate registry at capacity (${this.maxMemoryGates})`);
      }
    }

    const now = Date.now();
    const storedScopeId = scopeId ?? definition.scope_id;
    const declaredKey = definition.declared_key ?? definition.id;

    const tempGate: TemporaryGateDefinition = {
      id: gateId,
      ...copyStoredKeys(definition),
      created_at: now,
      expires_at: definition.expires_at ?? now + this.defaultExpirationMs,
      ...(storedScopeId ? { scope_id: storedScopeId } : {}),
      ...(declaredKey !== undefined ? { declared_key: declaredKey } : {}),
    };

    // Store the gate
    this.temporaryGates.set(gateId, tempGate);

    // Manage scope association
    if (scopeId) {
      this.associateWithScope(gateId, definition.scope, scopeId);
    }

    // Set up automatic cleanup
    if (tempGate.expires_at) {
      const cleanupTimeout = setTimeout(() => {
        this.removeTemporaryGate(gateId);
      }, tempGate.expires_at - now);
      cleanupTimeout.unref();

      this.cleanupTimers.set(gateId, cleanupTimeout);
    }

    this.logger.debug(`[TEMP GATE REGISTRY] Created temporary gate:`, {
      id: gateId,
      name: tempGate.name,
      scope: tempGate.scope,
      scopeId,
      expiresAt: tempGate.expires_at,
    });

    return gateId;
  }

  /**
   * Get a temporary gate by ID
   */
  getTemporaryGate(gateId: string): TemporaryGateDefinition | undefined {
    return this.temporaryGates.get(gateId);
  }

  /**
   * Get all temporary gates for a specific scope
   */
  getTemporaryGatesForScope(scope: string, scopeId: string): TemporaryGateDefinition[] {
    const scopeKey = `${scope}:${scopeId}`;
    const scopeInfo = this.scopeManagement.get(scopeKey);

    if (!scopeInfo) {
      return [];
    }

    const gates: TemporaryGateDefinition[] = [];
    for (const gateId of scopeInfo.gates) {
      const gate = this.temporaryGates.get(gateId);
      if (gate) {
        gates.push(gate);
      }
    }

    return gates;
  }

  /**
   * Hand the gates a call registered to the run that call belongs to (R47). The run then owns
   * them until it ends: their expiry timer is dropped, because a run may wait longer than any
   * timer between two calls. A gate another run already owns stays with that run.
   *
   * A `chain`-scoped gate is filed under the run's chain id here (P6.164, R73). The call that
   * starts a run registers before the run has a chain id, so its chain-scoped gates were filed
   * under a server-wide stand-in (`chain:execution`) shared by every run's start call: the run's
   * own `chain:<chainId>` scope never listed them, and anything reading or clearing that bucket
   * reached every run's at once. `chainId` absent re-keys nothing.
   */
  adoptIntoRun(runId: string, gateIds: readonly string[], chainId?: string): void {
    for (const gateId of gateIds) {
      const gate = this.temporaryGates.get(gateId);
      if (gate === undefined || this.gateOwners.has(gateId)) {
        continue;
      }
      this.gateOwners.set(gateId, runId);
      const owned = this.runGates.get(runId) ?? new Set<string>();
      owned.add(gateId);
      this.runGates.set(runId, owned);
      this.clearExpiry(gate);
      if (chainId !== undefined) {
        this.fileUnderChain(gate, chainId);
      }
    }
  }

  /** Move a `chain`-scoped gate's scope association to `chain:<chainId>`. */
  private fileUnderChain(gate: TemporaryGateDefinition, chainId: string): void {
    if (gate.scope !== 'chain' || gate.scope_id === chainId) {
      return;
    }
    if (gate.scope_id !== undefined) {
      this.removeFromScope(gate.id, gate.scope, gate.scope_id);
    }
    gate.scope_id = chainId;
    this.associateWithScope(gate.id, gate.scope, chainId);
  }

  /**
   * The id `key` was declared as for this run (R49) — the run's one declared-id map, read off the
   * gates its index holds: a gate `runId` owns, else one of `callGateIds`, the gates this call
   * registered (the call that starts a run registers before the run exists, and adoption hands
   * its gates to the run keys and all). Undefined when neither holds the key: the caller
   * registers, under a fresh id if another run holds the declared one.
   */
  resolveDeclared(
    key: string,
    runId: string | undefined,
    callGateIds: readonly string[]
  ): string | undefined {
    const owned = runId === undefined ? [] : [...(this.runGates.get(runId) ?? [])];
    return [...owned, ...callGateIds].find(
      (gateId) => this.temporaryGates.get(gateId)?.declared_key === key
    );
  }

  /** The gates `runId` owns. */
  getRunGates(runId: string): TemporaryGateDefinition[] {
    const gates: TemporaryGateDefinition[] = [];
    for (const gateId of this.runGates.get(runId) ?? []) {
      const gate = this.temporaryGates.get(gateId);
      if (gate !== undefined) {
        gates.push(gate);
      }
    }
    return gates;
  }

  /** Remove every gate `runId` owns — the run completed, was cancelled, pruned or cleared. */
  releaseRun(runId: string): number {
    const owned = [...(this.runGates.get(runId) ?? [])];
    for (const gateId of owned) {
      this.removeTemporaryGate(gateId);
    }
    this.runGates.delete(runId);
    return owned.length;
  }

  /** Remove the gates in `gateIds` that no run adopted: a call with no run is over. */
  releaseUnowned(gateIds: readonly string[]): number {
    let released = 0;
    for (const gateId of new Set(gateIds)) {
      if (!this.gateOwners.has(gateId) && this.removeTemporaryGate(gateId)) {
        released += 1;
      }
    }
    return released;
  }

  convertToLightweightGate(tempGate: TemporaryGateDefinition): LightweightGateDefinition {
    return toGateDefinition(liftTemporaryGate(tempGate));
  }

  /**
   * Remove a temporary gate
   */
  removeTemporaryGate(gateId: string): boolean {
    const gate = this.temporaryGates.get(gateId);
    if (!gate) {
      return false;
    }

    // Remove from registry
    this.temporaryGates.delete(gateId);

    const owner = this.gateOwners.get(gateId);
    if (owner !== undefined) {
      this.gateOwners.delete(gateId);
      this.runGates.get(owner)?.delete(gateId);
    }

    // Clean up scope associations
    if (gate.scope_id) {
      this.removeFromScope(gateId, gate.scope, gate.scope_id);
    }

    // Cancel cleanup timer
    const timer = this.cleanupTimers.get(gateId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(gateId);
    }

    this.logger.debug(`[TEMP GATE REGISTRY] Removed temporary gate: ${gateId}`);
    return true;
  }

  /**
   * Remove every gate whose own `expires_at` has passed. A scope has no expiry: it empties as its
   * gates leave ({@link removeFromScope}).
   */
  cleanupExpiredGates(): number {
    const now = Date.now();
    let cleanedCount = 0;

    // Clean up expired gates
    for (const [gateId, gate] of this.temporaryGates.entries()) {
      if (gate.expires_at && gate.expires_at <= now) {
        this.removeTemporaryGate(gateId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`[TEMP GATE REGISTRY] Cleaned up ${cleanedCount} expired gates`);
    }

    return cleanedCount;
  }

  /**
   * Force cleanup to free memory
   */
  private performCleanup(): void {
    this.logger.debug('[TEMP GATE REGISTRY] Performing forced cleanup');

    // First try cleaning expired gates
    this.cleanupExpiredGates();

    // If still at capacity, remove oldest gates
    if (this.temporaryGates.size >= this.maxMemoryGates) {
      const gates = Array.from(this.temporaryGates.values()).sort(
        (a, b) => a.created_at - b.created_at
      );

      const toRemove = Math.min(100, gates.length - Math.floor(this.maxMemoryGates * 0.8));
      for (let i = 0; i < toRemove; i++) {
        const gate = gates[i];
        if (!gate) {
          continue;
        }
        this.removeTemporaryGate(gate.id);
      }

      this.logger.warn(`[TEMP GATE REGISTRY] Force removed ${toRemove} oldest gates`);
    }
  }

  /** Drop a gate's expiry: a run-owned gate ends with its run, not with a timer. */
  private clearExpiry(gate: TemporaryGateDefinition): void {
    delete gate.expires_at;
    const timer = this.cleanupTimers.get(gate.id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.cleanupTimers.delete(gate.id);
    }
  }

  /**
   * Associate gate with scope
   */
  private associateWithScope(gateId: string, scope: string, scopeId: string): void {
    const scopeKey = `${scope}:${scopeId}`;

    if (!this.scopeManagement.has(scopeKey)) {
      this.scopeManagement.set(scopeKey, {
        scope_type: scope as any,
        scope_id: scopeId,
        gates: new Set(),
        created_at: Date.now(),
      });
    }

    this.scopeManagement.get(scopeKey)!.gates.add(gateId);
  }

  /**
   * Remove gate from scope
   */
  private removeFromScope(gateId: string, scope: string, scopeId: string): void {
    const scopeKey = `${scope}:${scopeId}`;
    const scopeInfo = this.scopeManagement.get(scopeKey);

    if (scopeInfo) {
      scopeInfo.gates.delete(gateId);

      // Remove scope if empty
      if (scopeInfo.gates.size === 0) {
        this.scopeManagement.delete(scopeKey);
      }
    }
  }

  /**
   * A valid caller-chosen id, else a generated `temp_…` one. Under 'fresh-id' a caller-chosen id
   * already held by another run's gate becomes the first free `<id>-2`, `<id>-3`, … instead of
   * throwing below, so the declaring run grades its OWN criteria while the earlier gate stays with
   * the run that still references it (R43). The caller uses the returned id; `name` keeps the
   * declared one.
   */
  private chooseGateId(
    requested: string | undefined,
    onIdCollision?: 'throw' | 'fresh-id'
  ): string {
    if (!requested || !this.isValidCustomId(requested)) {
      return `temp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    }
    return onIdCollision === 'fresh-id' ? this.firstFreeId(requested) : requested;
  }

  /**
   * `id` when unheld, else the first unheld `<id>-N` from 2 — the node-id suffix convention. A
   * canonical id is held by its canonical gate.
   */
  private firstFreeId(id: string): string {
    let candidate = id;
    for (
      let suffix = 2;
      this.temporaryGates.has(candidate) || this.shadowsCanonicalGate(candidate);
      suffix += 1
    ) {
      candidate = `${id}-${suffix}`;
    }
    return candidate;
  }

  /**
   * Validate user-provided custom ID
   * Prevents collision with auto-generated IDs and enforces format requirements
   */
  private isValidCustomId(id: string): boolean {
    // Must not be empty
    if (!id || id.trim().length === 0) {
      return false;
    }

    // Prevent collision with auto-generated IDs
    // Auto-generated format: temp_${timestamp}_${random}
    if (id.startsWith('temp_') && /^temp_\d+_[a-z0-9]+$/.test(id)) {
      this.logger.warn(
        `[TEMP GATE REGISTRY] Rejecting user ID that matches auto-generated pattern: ${id}`
      );
      return false;
    }

    // Validate format (alphanumeric, dashes, underscores only)
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      this.logger.warn(`[TEMP GATE REGISTRY] Invalid ID format: ${id}`);
      return false;
    }

    return true;
  }
}

/**
 * Factory function for creating temporary gate registry
 */
export function createTemporaryGateRegistry(
  logger: Logger,
  options?: ConstructorParameters<typeof TemporaryGateRegistry>[1]
): TemporaryGateRegistry {
  return new TemporaryGateRegistry(logger, options);
}

/**
 * Lift a temporary gate into the converter's input, the way `GateDefinitionLoader` hands over a
 * parsed gate.yaml.
 *
 * Temporary-only keys (`scope`, `scope_id`, `created_at`, `expires_at`, `source`, `context`, the
 * step targets) stay behind: they drive this registry's lifecycle and selection, not what a
 * pipeline stage reads. `severity` and `gate_type` stay ABSENT rather than taking the schema
 * defaults — a temporary gate never declared them. The retry and activation values are the ones
 * every temporary gate has always carried: explicitly requested, three attempts.
 */
function liftTemporaryGate(tempGate: TemporaryGateDefinition): GateDefinitionSource {
  return {
    id: tempGate.id,
    name: tempGate.name,
    type: tempGate.type === 'guidance' ? 'guidance' : 'validation',
    description: tempGate.description,
    guidance: tempGate.guidance,
    ...(tempGate.pass_criteria !== undefined
      ? { pass_criteria: tempGate.pass_criteria as GatePassCriteria[] }
      : {}),
    ...(tempGate.enforcement_mode !== undefined
      ? { enforcementMode: tempGate.enforcement_mode }
      : {}),
    retry_config: { max_attempts: 3, improvement_hints: true, preserve_context: true },
    activation: { explicit_request: true },
  };
}

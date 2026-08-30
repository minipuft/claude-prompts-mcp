// @lifecycle canonical - Shared identity scope resolver for continuity semantics.
const DEFAULT_IDENTITY_SCOPE_ID = 'default';

export interface IdentityScopeInput {
  continuityScopeId?: unknown;
  workspaceId?: unknown;
  organizationId?: unknown;
}

function normalizeScopeValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Resolve the canonical continuity scope key for state/session isolation.
 *
 * Precedence:
 * 1) continuityScopeId (an already-resolved key — trust it rather than re-deriving)
 * 2) workspaceId (shared continuity across clients in same workspace)
 * 3) organizationId (canonical organization fallback)
 * 4) "default" (legacy compatibility only)
 *
 * `continuityScopeId` was added to this chain 2026-08-27 and is the reason the chain is
 * worth reading twice. Three conventions for reading a scope key had grown up in parallel:
 * this function (which read `workspaceId`/`organizationId` and DROPPED `continuityScopeId`),
 * the union form in `run-registry`/`chains/manager`, and a bare `scope.continuityScopeId` in
 * `execution-record-store`. A producer emitting only `continuityScopeId` was therefore
 * correct under two of the three and silently resolved to the literal `'default'` bucket
 * under this one.
 *
 * That is not a hypothetical. `sqlite-layer-remediation-2026-08-03` Tier 4.1 diagnosed it as
 * "stop truncating" and fixed ONE producer; three siblings kept the same expression, and the
 * consequence was measured 2026-08-27: `system_control` could not disable the gate system,
 * `framework switch` never persisted at all (`framework-state-store.ts:356` skips persistence
 * on a `'default'` key), and the advertised `inputSchema` never narrowed. Fixing the producers
 * alone would leave the trap armed for the next one written; this chain disarms it.
 *
 * Isolation deliberately TIGHTENS as a result: state previously pooled under `'default'` is no
 * longer reachable from a workspace-scoped read. Accepted rather than migrated — these are
 * runtime preferences (gate enablement, active framework, argument history) that re-derive from
 * config on first read, so the cost is a re-toggle. A startup backfill was considered and
 * rejected: it would have had to run against producers that were still truncating, which hides
 * the defect instead of fixing it, and nothing stated what would ever retire it.
 */
export function resolveContinuityScopeId(
  input?: IdentityScopeInput,
  fallback: string = DEFAULT_IDENTITY_SCOPE_ID
): string {
  return (
    normalizeScopeValue(input?.continuityScopeId) ??
    normalizeScopeValue(input?.workspaceId) ??
    normalizeScopeValue(input?.organizationId) ??
    fallback
  );
}

export { DEFAULT_IDENTITY_SCOPE_ID };

/**
 * Build the scope object a state store should be handed, from a resolved identity.
 *
 * THE canonical producer. Every site that turns an identity into `StateStoreOptions` calls
 * this rather than hand-rolling the object, because hand-rolling is what went wrong: four
 * sites each wrote their own version of
 *
 *   return scopeId !== 'default' ? { continuityScopeId: scopeId } : undefined;
 *
 * which emits ONE of the three keys. `sqlite-layer-remediation-2026-08-03` Tier 4.1 fixed that
 * expression at a single site and marked the row done; the other three kept it for four months
 * and were found by an unrelated probe. A site-by-site fix cannot generalize — a shared producer
 * can, and `validate:scope-producers` fails the build on anyone who reintroduces the shape.
 *
 * `'default'` is treated as absent for every field. It is the sentinel for "no scope", and
 * writing it into a column that is supposed to name a workspace trades a visible NULL for an
 * invisible placeholder that reads as a real workspace named "default".
 *
 * Returns undefined when nothing meaningful was resolved, so callers keep the "no scope"
 * signal they already branch on.
 */
export function buildIdentityScope(input?: IdentityScopeInput):
  | {
      continuityScopeId?: string;
      workspaceId?: string;
      organizationId?: string;
    }
  | undefined {
  const continuityScopeId = meaningfulScopeValue(input?.continuityScopeId);
  const workspaceId = meaningfulScopeValue(input?.workspaceId);
  const organizationId = meaningfulScopeValue(input?.organizationId);

  if (
    continuityScopeId === undefined &&
    workspaceId === undefined &&
    organizationId === undefined
  ) {
    return undefined;
  }

  return {
    ...(continuityScopeId !== undefined ? { continuityScopeId } : {}),
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    ...(organizationId !== undefined ? { organizationId } : {}),
  };
}

/** A scope value that names something. `'default'` is the "no scope" sentinel, not a name. */
function meaningfulScopeValue(value: unknown): string | undefined {
  const normalized = normalizeScopeValue(value);
  return normalized === DEFAULT_IDENTITY_SCOPE_ID ? undefined : normalized;
}

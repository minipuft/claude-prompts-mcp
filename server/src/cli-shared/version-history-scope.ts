// @lifecycle canonical - Which tenant key this CLI process reads and writes history under.
/**
 * Tenant/scope resolution for `cpm`'s `version_history` access.
 *
 * Kept in its own module deliberately. This is the one region where the CLI and the server can
 * legitimately disagree — the server resolves a scope the CLI cannot always derive — so the guess,
 * its precedence, and the read-back that corrects it belong together and nowhere else. Every other
 * module here takes the tenant id as a parameter rather than resolving one.
 *
 * Split out of `version-history.ts` when that file crossed the 1000-line gate; a pure move, with
 * both functions' doc comments carried across unchanged.
 */

import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { HistoryRequest } from './version-history-types.js';
import type { DatabaseSync } from 'node:sqlite';

import {
  configFileFormat,
  findWorkspaceConfigFiles,
  parseConfigText,
} from '#shared/utils/config-file-format.js';
import { deriveProjectScopeId } from '#shared/utils/project-scope.js';
import { resolveContinuityScopeId } from '#shared/utils/request-identity-scope.js';

/**
 * Guess the tenant this process would write `version_history` under, absent other evidence.
 *
 * Mirrors the SHAPE of `VersionHistoryService.resolveTenantId()` on the server —
 * `resolveContinuityScopeId(scope)` — but cannot mirror its INPUT: the server's `scope` there
 * comes from `identity.launchDefaults`, resolved at ITS launch from `--workspace-id`, its
 * config file, or its own `CLAUDE_PROJECT_DIR`/cwd (`applyRuntimeIdentityOverrides`,
 * `runtime/context.ts`) — none of which this process can observe. What it CAN observe: the
 * same `identity.launchDefaults.workspaceId` if the workspace's config file sets it explicitly
 * (`readConfiguredWorkspaceId`, matching rung 2 of the server's precedence), and its own
 * `CLAUDE_PROJECT_DIR`/cwd, which matches the server's only when both processes share an
 * environment (e.g. launched from the same shell/session) or happen to share a cwd.
 *
 * **This is a guess, not the answer, and `runSqlite` does not trust it blindly.** A `--workspace-id`
 * flag, or a server that derived its scope from a launch cwd this process never shares (the
 * common shape for a background daemon: one fixed install path serving many per-project
 * workspaces), both produce a guess that disagrees with the server's actual resolution. Rather
 * than let a wrong guess silently report "no history" or diverge a rollback onto a new tenant,
 * `resolveEffectiveTenantId` (below `runSqlite`) corrects it against `tenant_id` values already
 * recorded in this db — the server's resolution is the source of truth, and an existing row
 * already names it. What remains unclosed: a resource with NO history yet, first written by the
 * CLI itself under a guess the server would not have made — there is no prior row to correct
 * against, and closing that needs the server to persist its resolved scope somewhere this
 * process can read before any write happens, which is out of scope here.
 */
export function resolveTenantId(dbPath: string): string {
  const configured = readConfiguredWorkspaceId(dbPath);
  const derived = deriveProjectScopeId()?.value;
  return resolveContinuityScopeId({ workspaceId: configured ?? derived });
}

/**
 * Read `identity.launchDefaults.workspaceId` from the config file beside runtime-state.
 *
 * Either config name counts, in the same precedence the server reads them, and the text parses in
 * whichever dialect its extension declares — a workspace id commented around in a `config.jsonc`
 * would otherwise read as absent and silently scope this process's history to `'default'`.
 */
function readConfiguredWorkspaceId(dbPath: string): string | undefined {
  const configPath = findWorkspaceConfigFiles(dirname(dirname(dbPath)))[0];
  try {
    if (configPath === undefined) {
      return undefined;
    }
    const parsed: unknown = parseConfigText(
      readFileSync(configPath, 'utf8'),
      configFileFormat(configPath)
    );
    const workspaceId = (
      parsed as { identity?: { launchDefaults?: { workspaceId?: unknown } } } | null
    )?.identity?.launchDefaults?.workspaceId;
    return typeof workspaceId === 'string' && workspaceId.trim() !== ''
      ? workspaceId.trim()
      : undefined;
  } catch {
    // A malformed config is the server's problem to report, not the CLI's to crash on.
    return undefined;
  }
}

/**
 * Correct `resolveTenantId`'s guess against what this db actually holds for this resource.
 *
 * `resolveTenantId` derives a scope independently of the server — it cannot see the server's own
 * launch cwd, only `CLAUDE_PROJECT_DIR` (if the CLI process happens to share it) and a configured
 * `identity.launchDefaults.workspaceId`. Neither rung fires for a server that derived its scope
 * from its own launch cwd with nothing configured — a background-daemon deployment where
 * `MCP_WORKSPACE` names a per-project directory but the server binary itself always launches from
 * one fixed install path. In that shape the CLI's guess and the server's resolution are two
 * independent answers to the same question and agree only by accident (measured: `cpm rollback -w
 * <workspace>` from an unrelated cwd reports `Version 1 not found` against history that exists).
 *
 * The correction is not a second guess: `tenant_id` on an existing `version_history` row is not
 * derived, it is what the writer — the server — actually used, so reading it is consulting the
 * SSOT directly instead of re-predicting it. Applied only when unambiguous (the guessed tenant has
 * no rows for this exact resource, and exactly one OTHER tenant does): a shared `state.db` can
 * legitimately hold the same `resource_type`/`resource_id` under two unrelated projects. Two real
 * candidates is reported as `ambiguousCandidateCount`, not silently resolved — picking one would
 * serve the wrong project's history, and returning the guess unlabeled would read exactly like a
 * genuinely empty history, which is the same "nothing found" symptom this fix exists to remove.
 * Zero candidates (nobody, anywhere, has ever recorded this resource) is not ambiguous — there is
 * nothing to be ambiguous BETWEEN — so it returns the guess unlabeled too, and the caller reports
 * an ordinary empty result.
 *
 * `dispatch` calls this for every action whose SQL can only act on rows that already exist —
 * `load_history`, `get_version`, `compare_versions`, `rollback` (which reads its target before
 * writing the restored state, under the SAME resolved tenant so the two halves of one rollback
 * never split across tenants), and `delete_history` (a wrong guess must not leave the server's
 * rows behind as an undeletable orphan — `cpm delete` has the identical shape as `cpm rollback`:
 * both are reached only from `cli/src/commands/*.ts`, never from the server, which always writes
 * through `VersionHistoryService`'s own `this.scope`, not this guess). `save_version` and
 * `record_edit_result` deliberately do NOT go through this: they can legitimately be the
 * first-ever write for a genuinely different, correctly-resolved tenant that happens to share a
 * `resource_type`/`resource_id` with another tenant's resource — "correcting" that write would
 * silently merge two unrelated projects' histories. Measured while writing this fix's own test:
 * an unmodified `saveVersion` under a second real tenant was redirected into the first tenant's
 * existing history instead of starting its own. `rename_history` is left on the uncorrected guess
 * too, but for a different reason: its write path is being edited concurrently elsewhere in this
 * file (row renumbering); correcting it is the same shape and belongs with that change, not this
 * one — tracked as an open gap, not a decision that it should stay uncorrected.
 *
 * Only `load_history` currently inspects `ambiguousCandidateCount` and refuses loudly on it
 * (`dispatch`'s other four callers read `.tenantId` alone, unchanged from before this field
 * existed) — see that case for why an ambiguous result must not collapse into the same "nothing
 * found" shape a genuinely empty history produces.
 */
export function resolveEffectiveTenantId(
  db: DatabaseSync,
  guessedTenantId: string,
  request: HistoryRequest
): { tenantId: string; ambiguousCandidateCount?: number } {
  const guessHasRows =
    db
      .prepare(
        `SELECT 1 FROM version_history WHERE tenant_id = ? AND resource_type = ? AND resource_id = ? LIMIT 1`
      )
      .get(guessedTenantId, request.resource_type, request.resource_id) !== undefined;
  if (guessHasRows) {
    return { tenantId: guessedTenantId };
  }

  const candidates = db
    .prepare(
      `SELECT DISTINCT tenant_id FROM version_history WHERE resource_type = ? AND resource_id = ?`
    )
    .all(request.resource_type, request.resource_id) as { tenant_id: string }[];
  const onlyCandidate = candidates.length === 1 ? candidates[0] : undefined;
  if (onlyCandidate !== undefined) {
    return { tenantId: onlyCandidate.tenant_id };
  }
  if (candidates.length >= 2) {
    return { tenantId: guessedTenantId, ambiguousCandidateCount: candidates.length };
  }
  return { tenantId: guessedTenantId };
}

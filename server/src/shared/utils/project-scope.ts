// @lifecycle canonical - Sole definition of the per-project scope id derivation
/**
 * Derivation of the per-project scope id used for state isolation in `state.db`.
 *
 * Lives in `shared/` (L0) rather than beside its original caller in `runtime/` because
 * two layers need the same answer and cannot reach each other: `runtime/context.ts`
 * resolves it at startup, and `cli-shared/version-history.ts` must resolve the SAME id
 * or the CLI and the server write `version_history` rows under different tenants and
 * stop seeing each other's history. `cli-shared` cannot import `runtime` — `modules/`
 * already imports `cli-shared`, so that edge would close a cycle `no-circular` blocks.
 */

import * as path from 'node:path';

/** Where a derived project scope id came from. Reported at startup for diagnosis. */
export type ProjectScopeSource = 'CLAUDE_PROJECT_DIR' | 'cwd';

export interface ProjectScopeDerivation {
  value: string;
  source: ProjectScopeSource;
}

function normalizeString(value?: string): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Reduce a directory to the scope id used for state isolation.
 *
 * Basename rather than full path: the id is written to `kv_state.workspace_id` and
 * appears in startup logs, and a raw home-directory path there leaks more than it
 * identifies. Trailing separators are stripped first so `/a/b/` and `/a/b` agree.
 * Returns undefined for a path with no basename (e.g. a filesystem root).
 */
function toScopeBasename(directory: string): string | undefined {
  const withoutTrailingSeparators = directory.replace(/[/\\]+$/, '');
  return normalizeString(path.basename(withoutTrailingSeparators));
}

/**
 * Derive a per-project scope id from the launch environment.
 *
 * This is only the FALLBACK rung of the precedence chain. An explicit `--workspace-id`
 * or `identity.launchDefaults.workspaceId` outranks it, and applying that precedence is
 * the caller's job — deliberately not done here, because `resolveRuntimeLaunchOptions`
 * must not hydrate identity from the environment (see options.identity.test.ts).
 *
 * @param env - Process environment; injectable for testing.
 * @param cwd - Working directory; injectable for testing.
 * @returns The derived id and which source produced it, or undefined if neither yields one.
 */
export function deriveProjectScopeId(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): ProjectScopeDerivation | undefined {
  const projectDir = normalizeString(env['CLAUDE_PROJECT_DIR']);
  if (projectDir != null) {
    const value = toScopeBasename(projectDir);
    if (value != null) {
      return { value, source: 'CLAUDE_PROJECT_DIR' };
    }
  }

  const workingDir = normalizeString(cwd);
  if (workingDir != null) {
    const value = toScopeBasename(workingDir);
    if (value != null) {
      return { value, source: 'cwd' };
    }
  }

  return undefined;
}

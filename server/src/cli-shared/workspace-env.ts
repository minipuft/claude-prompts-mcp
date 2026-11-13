// @lifecycle canonical - The workspace an environment names, for code that has no PathResolver.
/**
 * The workspace the process environment names: `MCP_WORKSPACE`, else `CLAUDE_PLUGIN_DATA`.
 *
 * Restates the environment half of `PathResolver.getWorkspace()` (`server/src/runtime/paths.ts`)
 * rather than importing it, for the reason `version-history-location.ts` gives: `cli-shared/` may
 * not reach `runtime/`, and the standalone `cpm` CLI and the server's pre-resolver entry code need
 * the same answer. The Claude Code plugin ships no `env` block, so the plugin's data directory is
 * the workspace whenever the operator names none; a reader that looked only at `MCP_WORKSPACE`
 * would report "not set" and walk up from the cwd under that plugin.
 *
 * An empty value counts as unset, as it does for the resolver. The flag (`--workspace`) is the
 * caller's to apply first; this reads the environment only.
 */

type WorkspaceEnvName = 'MCP_WORKSPACE' | 'CLAUDE_PLUGIN_DATA';

export interface WorkspaceFromEnv {
  /** The variable's value, unresolved. */
  value: string;
  /** Which variable supplied it, so a refusal can name it. */
  source: WorkspaceEnvName;
}

export function workspaceFromEnv(
  env: NodeJS.ProcessEnv = process.env
): WorkspaceFromEnv | undefined {
  for (const source of ['MCP_WORKSPACE', 'CLAUDE_PLUGIN_DATA'] as const) {
    const value = env[source];
    if (value !== undefined && value !== '') return { value, source };
  }
  return undefined;
}

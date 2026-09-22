// @lifecycle canonical - Sole derivation of the tenant a config file's version history is keyed under.
/**
 * Which tenant `version_history` rows about a CONFIG FILE are keyed under (owner ruling, P4.109).
 *
 * WHY THIS IS NOT `deriveProjectScopeId`. Every other checkpointed thing belongs to a WORKSPACE:
 * a gate called `alpha` in one project and a gate called `alpha` in another are two resources, and
 * the scope id — the basename of `CLAUDE_PROJECT_DIR`/cwd, or a configured
 * `identity.launchDefaults.workspaceId` — is what tells them apart. A config file is not like
 * that. It belongs to ITSELF: one file on disk, written by up to four surfaces (`cpm config
 * set`/`reset`, `cpm enable`/`disable`, and the two `system_control` persist paths), each of which
 * resolves that file by a different route and, crucially, runs in a different process with a
 * different cwd.
 *
 * Measured on this tree 2026-09-21, before this module existed: a server launched from its own
 * install directory serving a workspace elsewhere (`MCP_WORKSPACE`, the daemon and Claude Code
 * plugin shape) recorded `system_control gates disable --persist` under tenant `server`, while
 * `cpm config set` against the SAME file recorded under the workspace's basename. One config file,
 * two histories, both numbered from 1, and `cpm config history` listed only the CLI's — the
 * server's change had silently vanished from the list an operator rolls back from.
 *
 * SO THE TENANT IS A FUNCTION OF THE FILE'S PATH, AND OF NOTHING ELSE. Two properties follow, and
 * they are the two requirements this derivation exists to satisfy:
 *
 *   - Two workspaces sharing one `state.db` hold two config files, so they hold two histories.
 *     They stay isolated without depending on a cwd either process happened to have.
 *   - One config file reached from two working directories, with or without `--workspace-id`, is
 *     ONE history — because the path is the same path.
 *
 * WHY A HASH RATHER THAN THE PATH ITSELF. `tenant_id` is read back in logs and diagnostics, and a
 * raw `/home/<user>/…` there leaks more than it identifies — the same reasoning that makes
 * `deriveProjectScopeId` take a basename. A basename cannot be used HERE (every workspace's file
 * is called `config.json`), so the identity is kept and the text discarded: 64 bits of SHA-256
 * over the normalized absolute path, behind a `config:` prefix that says what keyed it and can
 * never collide with a workspace-derived scope id, none of which contain a colon.
 *
 * THE IDENTITY IS THE DIRECTORY, NOT THE FILENAME, AND THAT IS DELIBERATE. A directory holds at
 * most one config: `ambiguousConfigError` (`cli-shared/config-operations.ts`) refuses a directory
 * holding both `config.json` and `config.jsonc`, everywhere, because nothing on disk would say
 * which one the server read. So the directory already identifies the file, and keying on the
 * basename instead would only add a way to LOSE a history: renaming `config.jsonc` to
 * `config.json` — the 4.x-to-5.0 move this repo documents — would orphan every recorded version of
 * the same settings, and `cpm config rollback`'s "restoring would leave both names in one
 * directory" refusal, which exists for exactly that rename, would become unreachable.
 *
 * The directory is realpath'd so `/tmp/ws` and a symlink to it are one history. The FILE is
 * deliberately not consulted at all, so the id is the same before and after it first exists —
 * `cpm config reset` in a workspace that has no config writes one, and a derivation that changed
 * the moment the file appeared would split a history at its first write.
 */

import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { hashBytes } from './hash.js';

/**
 * What every config tenant id starts with.
 *
 * Deliberately NOT exported: nothing outside this module should be branching on the SHAPE of a
 * tenant id, and an exported constant with no consumer reads as a surface someone is expected to
 * key on. A reader who needs the answer calls {@link configTenantId}.
 */
const CONFIG_TENANT_PREFIX = 'config:';

/** How many hex characters of the digest the id carries. 64 bits over a handful of paths. */
const DIGEST_LENGTH = 16;

/**
 * The absolute, symlink-resolved directory two processes must agree on for the same config.
 *
 * The directory is resolved through the filesystem rather than merely normalized, because a
 * workspace reached through a symlink by one process and by its real path by another is one
 * workspace. A directory that does not exist yet keeps its literal path — stable, and the only
 * identity available.
 */
function normalizeConfigDirectory(configPath: string): string {
  const absolute = isAbsolute(configPath) ? configPath : resolve(configPath);
  const directory = dirname(absolute);
  try {
    return realpathSync.native(directory);
  } catch {
    return directory;
  }
}

/**
 * The tenant every `version_history` row about `configPath` is written and read under.
 *
 * THE one derivation: `cli-shared/config-checkpoint.ts` (every writer) and
 * `cli-shared/config-restore.ts` (every reader) both call this and nothing else, and a config row
 * reaching the generic tenant guess is refused by name rather than resolved
 * (`version-history-scope.ts`).
 */
export function configTenantId(configPath: string): string {
  const digest = hashBytes(normalizeConfigDirectory(configPath)).replace(/^sha256:/, '');
  return `${CONFIG_TENANT_PREFIX}${digest.slice(0, DIGEST_LENGTH)}`;
}

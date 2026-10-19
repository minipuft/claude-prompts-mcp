// @lifecycle canonical - The values version_history.resource_type holds, across every writer.
/**
 * What `version_history.resource_type` can HOLD — one vocabulary for the column, whoever wrote it.
 *
 * The column is a bare `TEXT NOT NULL` with no CHECK, written by two surfaces that each type it
 * with their own narrower union. Each union is derived from this one, so a value one surface writes
 * cannot fall outside what the other surface's reader is typed to receive:
 *
 *   - `prompt`, `gate`, `framework` — both: `resource_manager`, and `cpm`'s resource commands.
 *   - `category` — the server only (`resource_manager`).
 *   - `config` — both: `system_control` persist and `cpm config`.
 *
 * Both `config` writers go through one function, `recordConfigWrite`
 * (`cli-shared/config-checkpoint.ts`). Nothing writes a `style` row, so `style` is not a value the
 * column holds. The server's `ResourceType` (`modules/versioning/types.ts`) excludes `config`, and
 * `cpm`'s `HistoryResourceType` (`cli-shared/version-history-types.ts`) excludes `category`; each
 * states why beside its own declaration.
 *
 * Kept in `shared/types` (Layer 0) because `shared/utils/resource-file-set.ts`, the versioning
 * module and `cli-shared` all name it, and only Layer 0 is importable from all three.
 */
export type StoredResourceType = 'prompt' | 'gate' | 'framework' | 'category' | 'config';

/**
 * The stored types that are FILES on disk: everything but `config`.
 *
 * A config row records the one config file, checkpointed by `cli-shared/config-checkpoint.ts`; it
 * has no resource root, no entry filename and no file set. Every other value names a resource whose
 * files `shared/utils/resource-file-set.ts` enumerates, records and restores, so this is the type
 * that table is keyed on and the type byte restore admits (`isByteRestorable`,
 * `modules/versioning/byte-restore.ts`).
 *
 * It equals the server's `ResourceType` today, for a different reason: that union drops `config` so
 * MCP gains no config write surface (R53), this one because config has no files to enumerate.
 */
export type FileBackedResourceType = Exclude<StoredResourceType, 'config'>;

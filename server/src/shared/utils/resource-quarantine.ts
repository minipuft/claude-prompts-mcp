// @lifecycle canonical - Records resource files a loader refused, so a repair tool can reach them.
/**
 * Quarantine — the resource files that exist on disk and are not in the catalog.
 *
 * THE DEFECT THIS CLOSES. `resource_manager` is the only tool allowed to author a resource, and it
 * resolves its target through the loaded catalog. A file whose defect stops it loading is therefore
 * absent from every surface that could repair it: measured 2026-09-11 against `dist/`, `inspect`
 * answers `Prompt not found` for a file the same server had just logged as invalid, and `update`
 * with a full body reported `✅ **Prompt Updated**` while writing a SECOND resource at the default
 * category and leaving the broken file untouched. The only remaining repair path was hand-editing,
 * which this project's MCP-Tooling-Only rule forbids.
 *
 * WHY IT LIVES IN `shared/` AND NOT BESIDE THE PROMPT LOADER. It was written for prompts and lived
 * at `modules/prompts/quarantine.ts` (P4.9). The two sibling loaders are in `engine/` and the two
 * consumers P4.14 names are in `infra/`, and `.dependency-cruiser.cjs` makes both of those an
 * `error`-severity value import from a lower layer into `modules/` — so the collection could not be
 * generalized where it stood. Layer 0 is the only place all five can reach, and `shared/utils`
 * already hosts stateful collections of exactly this shape (`ResourceCache`, `SimpleRegistry`).
 * Nothing here imports upward, which is what keeps that true.
 *
 * WHY A SEPARATE COLLECTION RATHER THAN A FLAG. Recording the failure ON the catalog entry would
 * put it back in front of `prompt_engine`, the `prompts/list` registration, `resource://` reads and
 * the chain-step resolver, each of which would then have to remember to check it. A record that
 * holds no content cannot be executed or rendered by any of them, whatever they remember — and the
 * type is the enforcement, not a convention.
 *
 * WHAT A RECORD MAY CARRY. Type, id, category, root, path, error. Deliberately NOT the
 * systemMessage, user template, description or argument descriptions: those four fields are the
 * instruction surface this repo's CLAUDE.md §Instruction surface prices as equivalent to letting a
 * third party write into the model's context, and `prompts/list` plus `list detail:"full"` deliver
 * them before anyone invokes anything. A file that failed validation is precisely the one whose
 * content has not been checked, so quarantine must not become the surface that publishes it.
 *
 * WHY IT NEVER PARTICIPATES IN ID RESOLUTION. All three loaders resolve an id as
 * `primary ?? additional[0] ?? …` with the bundled tree trailing (`runtime/resource-roots.ts`), so
 * a workspace file that fails to load is simply absent and the bundled definition answers. A
 * quarantine that re-entered the resolution chain at the winning position would take that id DARK
 * — a typo in a workspace resource would cost the bundled one. Availability is byte-identical to
 * before this module existed, because nothing here is reachable from a lookup: the registry maps
 * consumers read are built from loaded resources alone.
 */

/**
 * Resource kinds a loader can refuse and a tool can repair.
 *
 * Deliberately NOT every kind the indexer walks: `style` has no quarantine sink yet (P4.16), and a
 * member here with no loader writing to it would read as coverage this collection does not have.
 */
export type QuarantinedResourceType = 'prompt' | 'gate' | 'framework';

/**
 * One file a loader walked, read, and refused.
 *
 * Keyed by `(root, path)` rather than by id: the id is derived from the path and two roots may
 * legitimately hold the same id, which is the overlay contract. Keying on id would make a broken
 * workspace file evict the record of a broken bundled one, and lose the very path a repair needs.
 *
 * `type` is NOT part of the key, and the first draft of this file had it there with a reason that
 * measurement disproved. The reason given was that `beginRoot` clears, so a gate walk of a root
 * would otherwise erase that root's prompt records — true of the erasure, false of the key:
 * {@link ResourceQuarantine.forgetRoot} filters on the record's fields, so the key never
 * participates. Removing `type` from the key killed no test, while removing it from `forgetRoot`'s
 * filter killed one and removing it from the record stamp killed two. A path determines its own
 * type anyway (a `gate.yaml` is never a `prompt.yaml`), so a two-type collision on one key is not
 * reachable. Kept here as the worked example: a component justified by a mechanism it is not part
 * of reads as deliberate and is inert.
 */
export interface QuarantinedResource {
  /** Which loader refused it — the discriminator a merged view is read through. */
  readonly type: QuarantinedResourceType;
  /** Id the resource would have been served under — path-derived, so nested steps stay qualified. */
  readonly id: string;
  /**
   * Category directory the file sits under, for the layouts that have one.
   *
   * Optional because gates and frameworks are FLAT: `{root}/{id}/gate.yaml` has no category level,
   * so an empty string there would assert a category that does not exist. Prompts always supply it.
   */
  readonly category?: string;
  /** Resource root the file was walked from. Part of the key, and the copy-on-write source. */
  readonly root: string;
  /** Absolute path of the file that failed. Reported so an operator can find it. */
  readonly path: string;
  /** Why it was refused. Diagnostic text only — never the content that failed to load. */
  readonly error: string;
}

/**
 * What a record looks like before the walk's type and root are stamped on it.
 *
 * Not exported: both come from `beginRoot`, so no caller outside this module ever builds one.
 * Exporting it would invite a caller to construct a record whose root it picked itself.
 */
type QuarantineEntry = Omit<QuarantinedResource, 'type' | 'root'>;

/**
 * The write half, scoped to one type's walk of one root.
 *
 * The loader functions receive this rather than the collection itself so they cannot read it back,
 * forget a root, or clear someone else's records. `beginRoot` hands one out and drops that root's
 * prior records in the same call — a re-walk cannot leave a repaired file recorded as broken, which
 * is exactly the stale-`✓` failure in reverse.
 */
export interface QuarantineSink {
  readonly type: QuarantinedResourceType;
  /** Root every record from this sink is stamped with. */
  readonly root: string;
  record(entry: QuarantineEntry): void;
  /**
   * Drop this root's record for one file, because that same file has just loaded.
   *
   * The per-file counterpart of `beginRoot`'s clear, for the loaders that never walk a root: gates
   * and frameworks resolve ONE id at a time behind a cache, so there is no walk boundary at which
   * a whole root could be dropped and rebuilt. Without this, the record a repair is supposed to
   * clear would outlive the repair — `reload` loads exactly one id, and a stale record makes a
   * working file report as still refused.
   */
  forget(filePath: string): void;
}

/** The read half. Consumers hold this; none of them can write. */
export interface QuarantineView {
  list(): readonly QuarantinedResource[];
  /** Every record claiming this id, across roots. Empty when the id is healthy or unknown. */
  byId(id: string): readonly QuarantinedResource[];
  /**
   * True when this exact file was refused by the loader that owns it.
   *
   * Path-keyed rather than id-keyed on purpose: the consumers P4.14 names (`ResourceIndexer`,
   * `ResourceChangeTracker`) each run their OWN filesystem walk and hold a path, not a loaded
   * resource. Asking them to re-derive an id the way the loader derives it would be a third
   * derivation of a question the loader already answered.
   */
  isRefused(filePath: string): boolean;
  readonly size: number;
}

const keyOf = (root: string, filePath: string): string => `${root} ${filePath}`;

/**
 * Live collection of refused resource files, replaced per root on every load.
 *
 * One instance per owning loader, handed to consumers BY REFERENCE at wiring time the way
 * `PromptRegistry` publishes live content. Threading a snapshot through an update call instead
 * would give every reload path a chance to forget one, which is the shape that made a hot reload
 * rebuild the catalog from a single root.
 *
 * Per-loader ownership rather than one process-wide instance: `beginRoot` CLEARS, and a shared
 * instance would let the gate loader's walk of a root wipe the prompt loader's records for the same
 * root. Cross-cutting consumers get {@link mergeQuarantineViews} instead, which reads and never
 * writes, so the clearing stays scoped to the loader that did the walking.
 */
export class ResourceQuarantine implements QuarantineView {
  private readonly records = new Map<string, QuarantinedResource>();

  /**
   * Drop everything previously recorded for `(type, root)` and return this walk's write handle.
   *
   * Clearing on BEGIN rather than on a later "end" call is deliberate: a walk that throws partway
   * still leaves the collection describing the files it actually reached, and a repaired file
   * simply never gets re-recorded.
   */
  beginRoot(type: QuarantinedResourceType, root: string): QuarantineSink {
    this.forgetRoot(type, root);
    return this.sinkFor(type, root);
  }

  /**
   * A write handle for `(type, root)` that clears NOTHING.
   *
   * For the loaders whose unit of work is a file rather than a root. `PromptLoader` walks a whole
   * root inside one method, so clear-then-walk describes its disk exactly; `GateDefinitionLoader`
   * and `RuntimeFrameworkLoader` are called per id, from a registry loop at startup and from a
   * single-id `reload` afterwards, and clearing a root on either would erase the records for every
   * OTHER broken file in it. Those two record on refusal and `forget` on success instead, which
   * converges on the same set without a walk boundary to hang it on.
   */
  sinkFor(type: QuarantinedResourceType, root: string): QuarantineSink {
    return {
      type,
      root,
      record: (entry: QuarantineEntry): void => {
        this.records.set(keyOf(root, entry.path), { ...entry, type, root });
      },
      forget: (filePath: string): void => {
        this.records.delete(keyOf(root, filePath));
      },
    };
  }

  /**
   * Forget every record from one type's walk of one root.
   *
   * The `type` test in this filter is the whole cross-loader protection, and it is the only place
   * that protection lives: dropping it lets a gate walk of a root clear that root's prompt records,
   * so a file nobody repaired goes quiet. Mutation-verified — see the note on
   * {@link QuarantinedResource} for what the key does and does not contribute.
   */
  forgetRoot(type: QuarantinedResourceType, root: string): void {
    for (const [key, record] of this.records) {
      if (record.type === type && record.root === root) this.records.delete(key);
    }
  }

  clear(): void {
    this.records.clear();
  }

  list(): readonly QuarantinedResource[] {
    return [...this.records.values()];
  }

  byId(id: string): readonly QuarantinedResource[] {
    return this.list().filter((record) => record.id === id);
  }

  isRefused(filePath: string): boolean {
    for (const record of this.records.values()) {
      if (record.path === filePath) return true;
    }
    return false;
  }

  get size(): number {
    return this.records.size;
  }
}

/**
 * The view a consumer reads before its loader's collection exists.
 *
 * Gate and framework loaders are built during their registry's `initialize()`, so a consumer that
 * asks earlier has to be answered with something. An empty view says the honest thing — nothing has
 * been refused, because nothing has been read — where returning `undefined` would push a
 * null-check into every call site and invite one of them to treat absence as a finding.
 */
export const EMPTY_QUARANTINE_VIEW: QuarantineView = {
  list: () => [],
  byId: () => [],
  isRefused: () => false,
  size: 0,
};

/**
 * One read-only view over several loaders' collections.
 *
 * For the consumers that are not type-scoped: the indexer walks prompts, gates and frameworks in
 * one pass, and asking it to hold three views and pick one per type would re-encode the type
 * mapping it already has. Reads through to the live instances rather than copying, so a hot reload
 * is reflected without anything re-registering.
 */
export function mergeQuarantineViews(...views: readonly QuarantineView[]): QuarantineView {
  return {
    list: () => views.flatMap((view) => view.list()),
    byId: (id) => views.flatMap((view) => view.byId(id)),
    isRefused: (filePath) => views.some((view) => view.isRefused(filePath)),
    get size() {
      return views.reduce((total, view) => total + view.size, 0);
    },
  };
}

/**
 * The record a repair should write back to, when several roots hold the same broken id.
 *
 * Lowest-precedence-last mirrors `resolveResourceRoots`: `additional` trails the bundled tree, so
 * the record from the root NEAREST the operator is the one an unqualified `update` means. Returns
 * undefined for an id nothing quarantined.
 */
export function preferredRepairTarget(
  records: readonly QuarantinedResource[],
  primaryRoot: string | undefined
): QuarantinedResource | undefined {
  if (records.length === 0) return undefined;
  if (primaryRoot !== undefined) {
    const inPrimary = records.find((record) => record.root === primaryRoot);
    if (inPrimary !== undefined) return inPrimary;
  }
  return records[0];
}

// @lifecycle canonical - What state a cpm write records, read from disk through the shared projection.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// The projection files directly, not the `versioning` barrel: the barrel also exports
// `VersionHistoryService`, which the CLI neither uses nor can typecheck, and importing it cost
// 5.6 KB of bundle plus two pre-existing type errors surfacing in `cli`'s own `tsc`.
import { projectPromptFromDisk } from './prompt-projection.js';

import { projectFrameworkSnapshot } from '#modules/versioning/projections/framework-snapshot.js';
import { projectGateSnapshot } from '#modules/versioning/projections/gate-snapshot.js';

/** The versioned resource types `cpm` can address. */
export type CliVersionedResourceType = 'prompt' | 'gate' | 'framework';

/**
 * A snapshot, and whether it came from the projection the SERVER records with.
 *
 * Two members rather than one because the answer is currently different per type, and a caller
 * that could not tell would report a bridge row as if it were a change. `shared: false` carries the
 * reason, so the fact never has to be rediscovered from the row it produces.
 *
 * Every type now HAS a shared projection (the prompt's arrived 2026-09-21), so `shared: false` no
 * longer means "this type is blocked". It means this particular resource could not be projected
 * through it — a prompt the loader refuses — and the snapshot handed back is the same projection
 * run over the raw entry file, which keeps the key set and key ORDER right while the resolved
 * bodies are missing. The reason exists so a reply can say that out loud instead of recording a
 * quietly-wrong row.
 */
export type ResourceSnapshotProjection =
  | { shared: true; snapshot: Record<string, unknown> }
  | { shared: false; snapshot: Record<string, unknown>; reason: string };

/** Read a companion file's body, or `undefined` when the resource does not carry one. */
function readCompanion(entryPath: string, relativePath: string): string | undefined {
  try {
    return readFileSync(resolve(dirname(entryPath), relativePath), 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Project a resource on disk onto the snapshot a version row records.
 *
 * `declared` is the parsed entry file — the caller has already read it, and re-reading it here
 * would let the two reads disagree across a concurrent write. Companion bodies (`guidance.md`,
 * `system-prompt.md`) are read here, because only this function knows which ones the projection
 * for that type needs.
 */
export async function projectResourceSnapshot(
  resourceType: CliVersionedResourceType,
  id: string,
  entryPath: string,
  declared: Record<string, unknown>
): Promise<ResourceSnapshotProjection> {
  const project = SHARED_PROJECTORS[resourceType];
  if (project === undefined) {
    return {
      shared: false,
      snapshot: declared,
      reason: `no shared snapshot projection is declared for ${resourceType}`,
    };
  }
  return await project(id, entryPath, declared);
}

/**
 * Whether this type's snapshot comes from the SERVER's projection — the discriminant, in advance.
 *
 * A caller that has to DECIDE before it writes (a create cannot project a file that does not
 * exist yet) needs the same answer `projectResourceSnapshot` will give, and the only honest way to
 * get it early is to read the same table the projection dispatches on. A caller branching on its
 * own list of types would be a second statement of which types are shared, drifting the moment a
 * type joins or leaves the table — exactly the parallel-projection shape this module exists to
 * prevent. It answers `true` for all three types today; it is kept because the table is what
 * decides, and a caller asking the table cannot be wrong about it.
 */
export function sharesServerSnapshotProjection(resourceType: CliVersionedResourceType): boolean {
  return SHARED_PROJECTORS[resourceType] !== undefined;
}

/**
 * The projection per type, and the SSOT for which types have one.
 *
 * A missing entry is the `shared: false` branch — membership decides both the projection and the
 * discriminant, so the two cannot disagree.
 */
const SHARED_PROJECTORS: Partial<
  Record<
    CliVersionedResourceType,
    (
      id: string,
      entryPath: string,
      declared: Record<string, unknown>
    ) => Promise<ResourceSnapshotProjection>
  >
> = {
  // The one asynchronous projector, and the reason `projectResourceSnapshot` is async at all: a
  // prompt's authored state is what the LOADER resolves, not what `prompt.yaml` literally holds
  // (`prompt-projection.ts`). Gate and framework project from the parsed entry file plus a
  // companion body, both synchronous — they are wrapped rather than left sync so there is one
  // return shape for the dispatch to hand back.
  prompt: async (id, entryPath, declared) => {
    const projected = await projectPromptFromDisk(id, entryPath, declared);
    return projected.failure === undefined
      ? { shared: true, snapshot: projected.snapshot }
      : { shared: false, snapshot: projected.snapshot, reason: projected.failure.reason };
  },
  gate: (id, entryPath, declared) => {
    const guidanceFile =
      typeof declared['guidanceFile'] === 'string' ? declared['guidanceFile'] : 'guidance.md';
    return Promise.resolve({
      shared: true as const,
      snapshot: projectGateSnapshot(id, {
        name: declared['name'],
        type: declared['type'],
        description: declared['description'],
        // `''`, not `undefined`, when the file is absent: the server's `getGuidance()` returns
        // the empty string, and `canonicalizeSnapshot` keeps `''` while dropping a nullish value —
        // so the two would differ by a whole key on a gate that carries no guidance.md.
        guidance: readCompanion(entryPath, guidanceFile) ?? '',
        definition: declared,
      }),
    });
  },
  framework: (id, entryPath, declared) =>
    Promise.resolve({
      shared: true as const,
      snapshot: projectFrameworkSnapshot(id, {
        framework: declared,
        systemPrompt: readCompanion(entryPath, 'system-prompt.md'),
      }),
    }),
};

// @lifecycle canonical - What state a cpm write records, read from disk through the shared projection.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// The projection files directly, not the `versioning` barrel: the barrel also exports
// `VersionHistoryService`, which the CLI neither uses nor can typecheck, and importing it cost
// 5.6 KB of bundle plus two pre-existing type errors surfacing in `cli`'s own `tsc`.
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
 */
export type ResourceSnapshotProjection =
  | { shared: true; snapshot: Record<string, unknown> }
  | { shared: false; snapshot: Record<string, unknown>; reason: string };

/**
 * Why a prompt snapshot is still the raw YAML map rather than `canonicalPromptSnapshot`'s output.
 *
 * ☐ open as of 2026-09-21 · flips when a prompt's authored state is reachable from `cli-shared/`
 * for under the dev bundle's headroom. `canonicalPromptSnapshot` takes a `ConvertedPrompt` —
 * loader-RESOLVED, where `userMessageTemplate` is the inlined body and `prompt.yaml` holds only
 * `userMessageTemplateFile` — so producing its input needs `loadYamlPrompt` AND `PromptConverter`.
 * Measured 2026-09-21 as a reachable import: 855.4 KB → 914.4 KB, **+59.0 KB**, which is 35.5 KB
 * over the 900,000-byte `DEV_BUNDLE_BUDGET_BYTES`; `npm run build` fails outright. Writing a
 * second, YAML-shaped prompt projection instead is what this module exists to stop.
 *
 * Consequence, stated because it is observable: a `cpm rollback` of a prompt the SERVER last wrote
 * still records a bridge row, because the two shapes cannot compare equal.
 */
const PROMPT_PROJECTION_BLOCKED =
  'prompt snapshots are still the raw prompt.yaml map: the shared projection takes a ' +
  'loader-resolved prompt, and reaching the loader from the CLI bundle measured +59.0 KB ' +
  'against 24.1 KB of headroom (2026-09-21)';

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
export function projectResourceSnapshot(
  resourceType: CliVersionedResourceType,
  id: string,
  entryPath: string,
  declared: Record<string, unknown>
): ResourceSnapshotProjection {
  const project = SHARED_PROJECTORS[resourceType];
  if (project === undefined) {
    return { shared: false, snapshot: declared, reason: PROMPT_PROJECTION_BLOCKED };
  }
  return { shared: true, snapshot: project(id, entryPath, declared) };
}

/**
 * Whether this type's snapshot comes from the SERVER's projection — the discriminant, in advance.
 *
 * A caller that has to DECIDE before it writes (a create cannot project a file that does not
 * exist yet) needs the same answer `projectResourceSnapshot` will give, and the only honest way to
 * get it early is to read the same table the projection dispatches on. A caller branching on its
 * own list of types would be a second statement of which types are shared, drifting the moment the
 * prompt blocker is lifted — exactly the parallel-projection shape this module exists to prevent.
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
    (id: string, entryPath: string, declared: Record<string, unknown>) => Record<string, unknown>
  >
> = {
  gate: (id, entryPath, declared) => {
    const guidanceFile =
      typeof declared['guidanceFile'] === 'string' ? declared['guidanceFile'] : 'guidance.md';
    return projectGateSnapshot(id, {
      name: declared['name'],
      type: declared['type'],
      description: declared['description'],
      // `''`, not `undefined`, when the file is absent: the server's `getGuidance()` returns
      // the empty string, and `canonicalizeSnapshot` keeps `''` while dropping a nullish value —
      // so the two would differ by a whole key on a gate that carries no guidance.md.
      guidance: readCompanion(entryPath, guidanceFile) ?? '',
      definition: declared,
    });
  },
  framework: (id, entryPath, declared) =>
    projectFrameworkSnapshot(id, {
      framework: declared,
      systemPrompt: readCompanion(entryPath, 'system-prompt.md'),
    }),
};

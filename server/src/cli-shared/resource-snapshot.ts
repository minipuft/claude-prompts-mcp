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
  if (resourceType === 'gate') {
    const guidanceFile =
      typeof declared['guidanceFile'] === 'string' ? declared['guidanceFile'] : 'guidance.md';
    return {
      shared: true,
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
    };
  }

  if (resourceType === 'framework') {
    return {
      shared: true,
      snapshot: projectFrameworkSnapshot(id, {
        framework: declared,
        systemPrompt: readCompanion(entryPath, 'system-prompt.md'),
      }),
    };
  }

  return { shared: false, snapshot: declared, reason: PROMPT_PROJECTION_BLOCKED };
}

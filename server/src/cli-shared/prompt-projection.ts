// @lifecycle canonical - Builds the loader-resolved prompt `canonicalPromptSnapshot` projects from.
/**
 * How `cpm` reaches the SERVER's prompt projection, rather than writing a second one.
 *
 * THE PROBLEM THIS SOLVES. `canonicalPromptSnapshot` projects a loader-RESOLVED prompt: its
 * `userMessageTemplate` is the inlined body, while `prompt.yaml` may hold only
 * `userMessageTemplateFile`. A projection fed the raw YAML map therefore produces a different
 * VALUE for the same prompt — and `latestSnapshotMatches` is `JSON.stringify` equality, so the two
 * can never compare equal. Every server edit of a `cpm`-written prompt would record a bridge row
 * describing a change nobody made, for as long as both shapes existed. Writing a second,
 * YAML-shaped prompt projection in `cli-shared/` is the defect this slice removes, so this module
 * builds the projection's INPUT instead and calls the one projection.
 *
 * WHAT IT COSTS, MEASURED. Reaching `PromptLoader` and `PromptConverter` from `cli-shared/` pulls
 * the prompt loader graph into the `cpm` bundle: 918,220 B → 986,048 B, **+66.2 KB**, against the
 * 1,000,000-byte `DEV_BUNDLE_BUDGET_BYTES` (owner ruling, 2026-09-21 — spend it), leaving 13,952 B
 * of headroom. The shipped minified budget is untouched. Measure with `npm run build` in `cli/`;
 * the number above is not a bound, `DEV_BUNDLE_BUDGET_BYTES` is.
 *
 * WHY IT WALKS THE WHOLE PROMPTS ROOT FOR ONE PROMPT. `PromptLoader.loadFromDirectories` +
 * `PromptConverter.convertMarkdownPromptsToJson` is the pair `PromptAssetManager
 * .loadAndConvertPrompts` runs, and it is used here whole rather than reached past. Addressing
 * `loadYamlPrompt` directly is both cheaper and WRONG in a way nothing would report: the walk sets
 * `prompt.category` to the category DIRECTORY name (overriding whatever the YAML declares) and
 * prefixes `prompt.file` with it, and `category` is a projected field — so a prompt whose
 * `category:` disagrees with its folder would project differently on the two surfaces and bridge
 * every server edit. Restating those two lines here is the second-projection defect one layer
 * down. The cost is one walk of the prompts tree per projection, which is a `cpm` command's own
 * workspace.
 *
 * WHY THE LOGGER IS A LOCAL NO-OP. `infra/logging`'s `noopLogger` is the obvious reuse and
 * `cli-shared/` may not import `infra/` (`.dependency-cruiser.cjs`, `cli-shared-no-runtime`). The
 * loader and the converter log at `info` on every load, and `cpm --json` writes its reply to
 * stdout — a converter `info` line lands in the middle of the JSON a caller is parsing. Four
 * empty functions is what the boundary costs here.
 */

import * as path from 'node:path';

import { canonicalPromptSnapshot } from '#modules/versioning/projections/prompt-snapshot.js';

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { Logger } from '#shared/types/index.js';

import { PromptConverter } from '#modules/prompts/converter.js';
import { PromptLoader } from '#modules/prompts/loader.js';

/** See the module header: `infra/logging` is across a boundary `cli-shared/` may not cross. */
const SILENT_LOGGER: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** What the CLI could not do, in the words a reply prints. */
export interface PromptProjectionFailure {
  reason: string;
}

/**
 * Project the prompt whose entry file is `entryPath` exactly as `resource_manager` would.
 *
 * `declared` is the already-parsed entry file and is used ONLY for the degraded branch — the
 * shared path re-reads through the loader, because the resolved bodies are the whole point.
 *
 * A prompt the loader refuses is reported, never silently mis-shaped: the fallback runs the SAME
 * projection over the raw map, so the key set and key ORDER still match what the server records
 * (`canonicalizeSnapshot`'s reason for existing), and the caller is handed a reason to print.
 */
export async function projectPromptFromDisk(
  id: string,
  entryPath: string,
  declared: Record<string, unknown>
): Promise<{ snapshot: Record<string, unknown>; failure?: PromptProjectionFailure }> {
  const degraded = (
    reason: string
  ): { snapshot: Record<string, unknown>; failure: PromptProjectionFailure } => ({
    snapshot: canonicalPromptSnapshot(id, declared),
    failure: { reason },
  });

  // `{root}/{category}/{id}/prompt.yaml` and `{root}/{category}/{id}.yaml` sit at different
  // depths, and a nested chain step's id carries its own `/` — so the root is walked up from the
  // entry by the id's own shape rather than by a fixed number of levels.
  const isDirectoryPrompt = path.basename(entryPath) === 'prompt.yaml';
  const depth = isDirectoryPrompt ? id.split('/').length : 0;
  const categoryDir = path.resolve(path.dirname(entryPath), ...Array<string>(depth).fill('..'));
  const promptsRoot = path.dirname(categoryDir);

  let live: ConvertedPrompt | undefined;
  try {
    const loader = new PromptLoader(SILENT_LOGGER);
    const { promptsData } = await loader.loadFromDirectories(promptsRoot);
    const converted = await new PromptConverter(SILENT_LOGGER, loader).convertMarkdownPromptsToJson(
      promptsData,
      promptsRoot
    );
    live = converted.find((prompt) => prompt.id === id);
  } catch (error) {
    return degraded(
      `the prompt loader threw on ${promptsRoot}: ` +
        `${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (live === undefined) {
    return degraded(
      `the prompt loader served no prompt '${id}' under ${promptsRoot}, so its resolved state is ` +
        `unknown — the snapshot below is projected from ${entryPath} alone`
    );
  }
  return { snapshot: canonicalPromptSnapshot(id, live) };
}

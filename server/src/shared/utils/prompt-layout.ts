// @lifecycle canonical - Sole owner of where a prompt sits in a prompts tree and what it is called.
/**
 * What counts as a prompt, where it may sit, and what id it is served under — answered once.
 *
 * A prompt can be written two ways: as a directory (`{category}/{id}/prompt.yaml`) or as one file
 * (`{category}/{id}.yaml`). The directory form announces itself — the filename IS the rule — while
 * the file form does not, because a prompts tree also holds YAML files that are NOT prompts:
 * `category.yaml` declares the category, `tool.yaml` declares a script tool under a prompt's
 * reserved `tools/` directory, `prompts.yaml` is a legacy registry, and a leading `_` or `.` marks
 * a file the loaders skip.
 *
 * THREE WALKS ASK THIS QUESTION AND THEY DID NOT AGREE. `discoverYamlPrompts` (the loader, and
 * therefore the definition of what is served) excluded all four reserved names.
 * `compareResourceBaseline` excluded only the `_` prefix, so it reported a prompt with the id
 * `category` at every startup — `resources/prompts/guidance/category.yaml` exists on disk, and the
 * change log announced an addition for a file no loader ever serves. `ResourceIndexer.scanResources`
 * skipped non-directory entries entirely, so it indexed no single-file prompt at all. Three
 * derivations of one question, wrong in two different directions.
 *
 * THE DIRECTORY HALF WAS THE LAST COPY STANDING. The opening paragraph above has called `tools/`
 * reserved since this module was written, while only `ResourceIndexer` enforced it, from an
 * `entry.name === 'tools'` literal of its own, and the loader held its own inline copy of the
 * `.`/`_` skip. A rule written in one module and implemented in two others is three chances to
 * disagree; `isReservedPromptDirectoryName` and `isIgnoredPromptEntryName` are now the single
 * implementation every walk calls.
 *
 * WHY IT LIVES IN `shared/utils/` (Layer 0). The three callers are in `modules/` (the loader),
 * `infra/` (the indexer) and `runtime/` (the baseline comparison). `.dependency-cruiser.cjs` makes
 * an `infra/` value-import of `modules/` an `error`, so Layer 0 is the only place all three can
 * reach — the same placement rationale as `resource-ids.ts` and `resource-quarantine.ts`.
 *
 * WHERE A FILE MAY SIT WAS THE HALF THAT STAYED UNSHARED, and it cost more than the filename rule
 * did. This module originally declined to answer it, on the reasoning that depth is a property of
 * each walk and a filename predicate would have to be handed a root it has no other use for. The
 * root turned out to be the cheap part. `compareResourceBaseline` stopped descending at any
 * directory holding `prompt.yaml` — "that directory IS the resource, not a container" — while
 * `discoverYamlPrompts` always recurses, because a chain directory holds its OWN `prompt.yaml`
 * alongside its steps' directories. Measured 2026-09-15: 15 step prompts ship at that depth under
 * `resources/prompts` and not one of them reached the baseline, so an external edit to any step of
 * `deep_analysis`, `implementation_plan`, `quick_decision` or `scaffold_project` was reported as
 * nothing at all. The indexer had already paid for the same rule separately, at
 * `MAX_SCAN_DEPTH` (measured 2026-08-29, 20 step prompts missing from `resource_index`).
 *
 * SO THE ID IS HERE TOO, because reaching the files is only half of agreeing about them. The
 * loader serves a nested step under its path below the CATEGORY (`deep_analysis/deep_dive`), not
 * under its own directory name, and a walk that reached the file while keying it `deep_dive` would
 * have swapped an absence for a disagreement — `resource_changes` is keyed by
 * `${resourceType}/${resourceId}`, so it would log every change against an id no MCP surface
 * answers. One derivation, so the two cannot drift apart again.
 */

import * as path from 'node:path';

/**
 * YAML filenames inside a prompts tree that are never a prompt of their own.
 *
 * `prompt.yaml` is the DIRECTORY form's entry point, so as a bare file entry it belongs to the
 * directory being walked, not to a sibling prompt. The other three declare something else
 * entirely. Every one of them parses as YAML, which is why a walk that only checks the extension
 * cannot tell them apart from a prompt.
 */
const RESERVED_PROMPT_FILENAMES: ReadonlySet<string> = new Set([
  'prompt.yaml',
  'prompts.yaml',
  'category.yaml',
  'tool.yaml',
]);

/**
 * True when a file entry inside a prompts tree is a single-file prompt definition.
 *
 * Takes a bare filename, not a path: every caller is mid-`readdir` and holds exactly that, and
 * accepting a path would invite one of them to pass a directory and get an answer.
 *
 * `.yaml` only, matching the loader — a `.yml` prompt is not served today, and accepting one here
 * would make the index promise something `prompt_engine` cannot answer.
 */
export function isSingleFilePromptName(fileName: string): boolean {
  if (!fileName.endsWith('.yaml')) return false;
  if (isIgnoredPromptEntryName(fileName)) return false;
  return !RESERVED_PROMPT_FILENAMES.has(fileName);
}

/**
 * Directory names inside a prompts tree that hold something other than prompts.
 *
 * `tools/` is a prompt's script-tool directory (`{promptId}/tools/{toolId}/tool.yaml`), and a
 * script tool is already served under a COMPOSITE id — `{promptId}/{toolId}`. A prompt admitted
 * below it would be served under `{promptId}/tools/{toolId}`, so one directory on disk would
 * answer to two id schemes and the collision would arrive with the first `tools/` entry that
 * happens to hold a `prompt.yaml`.
 */
const RESERVED_PROMPT_DIRECTORY_NAMES: ReadonlySet<string> = new Set(['tools']);

/**
 * True when a walk must not descend into this directory and must not read a prompt out of it.
 *
 * THE RULE WAS STATED HERE AND IMPLEMENTED ELSEWHERE. This module's own header has called
 * `tools/` reserved since it was written, while the only walk enforcing it was
 * `ResourceIndexer.scanResources`, with an `entry.name === 'tools'` literal of its own.
 * `discoverYamlPrompts` — which DEFINES the served catalog — and `compareResourceBaseline`
 * recursed straight in, so a `prompt.yaml` under any prompt's `tools/` was served, and announced
 * in `resource_changes`, under an id belonging to the script-tool namespace. Prose that states a
 * rule the module does not enforce is one derivation more, not one fewer.
 *
 * Takes a bare entry name, for the same reason `isSingleFilePromptName` does: every caller is
 * mid-`readdir` and holds exactly that.
 */
export function isReservedPromptDirectoryName(entryName: string): boolean {
  return RESERVED_PROMPT_DIRECTORY_NAMES.has(entryName);
}

/**
 * True when a walk must skip this entry outright — file or directory, at any depth.
 *
 * The loader's own rule, which it applies before it looks at anything else —
 * `discoverYamlPrompts` carried this expression inline until it was folded into this predicate.
 * Stated here as its own predicate because it is not a filename convention for prompts — it is a
 * property of the ENTRY, and a walk that applied it to files only would descend into `_drafts/`
 * and announce everything inside it.
 */
export function isIgnoredPromptEntryName(entryName: string): boolean {
  return entryName.startsWith('.') || entryName.startsWith('_');
}

/**
 * Directory names at the prompts ROOT that are never a category, on top of the ignored prefixes.
 *
 * `backup` is where earlier tooling parked copies of a prompts tree; `node_modules` appears when a
 * prompt library is itself a package. Neither holds prompts anyone meant to serve.
 */
const EXCLUDED_CATEGORY_DIRECTORY_NAMES: ReadonlySet<string> = new Set(['backup', 'node_modules']);

/**
 * True when a directory directly under the prompts root is NOT a category, so a walk must neither
 * serve, index, announce, validate, watch nor export anything below it.
 *
 * THE ROOT RULE HAD FIVE COPIES AND THREE ANSWERS. The loader's category scan (and a private copy
 * of it in the resource tool's file operations) excluded `.`/`_` names and `backup`. The watcher
 * excluded those plus `node_modules`, so a `node_modules` category was served but never watched.
 * The indexer, the startup baseline, `validate:prompts`, skills-sync and the `cpm` CLI excluded
 * no `backup`, so a `backup/` category was indexed, announced, validated and exported while no
 * MCP surface served it. Measured 2026-09-16.
 *
 * Root only. Below a category, `backup` and `node_modules` are ordinary names, and the rules there
 * are {@link isIgnoredPromptEntryName} and {@link isReservedPromptDirectoryName}. Conversely
 * `tools` IS a category at the root, so this predicate does not include the reserved names.
 *
 * `cli/src/lib/workspace.ts` calls this function itself rather than mirroring it: the CLI reaches
 * server source through its `@shared/*` alias, and esbuild bundles it into `cpm`, so there is one
 * rule and no copy to keep in step.
 */
export function isExcludedCategoryDirectoryName(entryName: string): boolean {
  return isIgnoredPromptEntryName(entryName) || EXCLUDED_CATEGORY_DIRECTORY_NAMES.has(entryName);
}

/**
 * The id segment a single-file prompt contributes: its basename without the extension.
 *
 * The caller prepends whatever path prefix its own layout implies (`{folder}/{id}` for a nested
 * step), because only the caller knows where it is in the tree.
 */
export function singleFilePromptBaseName(fileName: string): string {
  return fileName.replace(/\.yaml$/, '');
}

/**
 * Path segments of `target` below `promptsRoot`, or `undefined` when it is not below it at all.
 *
 * `[]` means `target` IS the root, which is a different answer from "outside the root" and the two
 * must not collapse: the first is a place a walk legitimately stands, the second is a caller bug.
 */
function rootRelativeSegments(promptsRoot: string, target: string): string[] | undefined {
  const relative = path.relative(promptsRoot, target);
  if (relative === '') return [];
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep);
}

/**
 * The id a prompt at these root-relative segments is served under, or `undefined` for a location
 * the loader does not serve.
 *
 * The FIRST segment is the category and is not part of the id; everything below it is, joined with
 * `/`. Fewer than two segments means the prompt would be its own category — a `prompt.yaml` in a
 * directory directly under the root, or a `.yaml` at the root itself — and the loader serves
 * neither, because it takes its categories from the root's directories and only looks for prompts
 * inside one.
 */
function promptIdFromSegments(segments: readonly string[]): string | undefined {
  if (segments.length < 2) return undefined;
  return segments.slice(1).join('/');
}

/**
 * The id a `{category}/…/{id}/prompt.yaml` directory is served under, or `undefined` when that
 * directory is not a place the loader serves a prompt from.
 *
 * Takes the prompt's own DIRECTORY, not its `prompt.yaml`: that is what a walk holds mid-`readdir`,
 * and it is the path the id is derived from either way.
 *
 * Finding a `prompt.yaml` here is not a reason to stop descending — a chain directory holds its own
 * definition AND its steps — which is the rule this module now owns and the baseline walk used to
 * contradict.
 */
export function promptIdFromDirectory(promptsRoot: string, promptDir: string): string | undefined {
  const segments = rootRelativeSegments(promptsRoot, promptDir);
  if (segments === undefined) return undefined;
  return promptIdFromSegments(segments);
}

/**
 * The id a `{category}/…/{id}.yaml` file is served under, or `undefined` when the file is not a
 * prompt or does not sit where the loader looks.
 *
 * Answers the filename question and the location question in ONE call, so a caller cannot ask one
 * and forget the other — which is how `category.yaml` came to be announced as a prompt at every
 * startup, and how a `.yaml` at the prompts root came to be announced as one too.
 */
export function promptIdFromSingleFile(promptsRoot: string, filePath: string): string | undefined {
  const fileName = path.basename(filePath);
  if (!isSingleFilePromptName(fileName)) return undefined;
  const segments = rootRelativeSegments(promptsRoot, path.dirname(filePath));
  if (segments === undefined) return undefined;
  return promptIdFromSegments([...segments, singleFilePromptBaseName(fileName)]);
}

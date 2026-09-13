// @lifecycle canonical - Sole owner of which YAML filenames under a prompts tree are a prompt.
/**
 * What counts as a single-file prompt, answered once.
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
 * WHY IT LIVES IN `shared/utils/` (Layer 0). The three callers are in `modules/` (the loader),
 * `infra/` (the indexer) and `runtime/` (the baseline comparison). `.dependency-cruiser.cjs` makes
 * an `infra/` value-import of `modules/` an `error`, so Layer 0 is the only place all three can
 * reach — the same placement rationale as `resource-ids.ts` and `resource-quarantine.ts`.
 *
 * WHAT IT DELIBERATELY DOES NOT DECIDE: where in the tree a file may sit. That is a property of
 * each walk (the loader only descends into category directories; the indexer bounds its depth), and
 * a filename predicate that also encoded depth would have to be handed a root it has no other use
 * for. Each caller applies this to the entries it has decided to look at.
 */

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
  if (fileName.startsWith('.') || fileName.startsWith('_')) return false;
  return !RESERVED_PROMPT_FILENAMES.has(fileName);
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

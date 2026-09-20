// @lifecycle canonical - Generic on-disk-base overlay shared by every YAML resource writer.
/**
 * Apply a write's decided values onto the document already on disk, key by key.
 *
 * Shared by the prompt, gate, and category writers (P4.67; the shape was first fixed for prompts
 * at P4.57, `resource-manager/prompt/operations/file-operations.ts`). Each of the three schemas
 * this backs is `.passthrough()` — or, for `CategorySchema`, plain `z.object` whose default
 * "strip" parse mode never rejects an extra key it does not itself carry forward — so a document
 * REBUILT from only the keys a writer's own fields model deletes every key the writer has no
 * field for: comments aside, an authored `artifacts:` block, `edges:`, `budget:`, or any other
 * passthrough key a hand-authored file declares.
 *
 * The disk document is the base, not the writer's output. Only `decidedKeys` may move: a decided
 * key the writer left unset in `written` is removed from the result, a decided key `written`
 * supplies overwrites the base, and every other key — including one the writer's schema does not
 * even model — passes through byte-for-byte, in the file's own order (with no prior file, the
 * result is exactly the document the writer built, since there is nothing else to overlay onto).
 * Pure: no I/O, no schema knowledge, just three objects and one set.
 */
export function overlayDecidedYamlKeys(
  existingYaml: Record<string, unknown> | undefined,
  written: Record<string, unknown>,
  decidedKeys: ReadonlySet<string>
): Record<string, unknown> {
  const document: Record<string, unknown> = { ...existingYaml };
  for (const key of decidedKeys) {
    if (written[key] === undefined) {
      delete document[key];
    }
  }
  for (const [key, value] of Object.entries(written)) {
    if (decidedKeys.has(key) && value !== undefined) {
      document[key] = value;
    }
  }
  return document;
}

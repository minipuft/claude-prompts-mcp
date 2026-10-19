// @lifecycle canonical - Source-preserving YAML serialization for resource writes.
/**
 * Serializing a resource edit WITHOUT rewriting the parts of the file the edit did not name.
 *
 * `serializeYaml` renders a whole JS value from scratch. That is correct for a
 * file this server authored and nobody has touched since, and wrong for every file a human has
 * opened: it discards every comment, re-wraps block scalars to its own line width, and re-quotes
 * strings to its own taste. Measured on the bundled catalogue: 22 of 105 shipped resources carry
 * comments, and a one-field edit of `gates/math-fidelity/gate.yaml` through `serializeYaml`
 * rewrote all 29 lines and dropped all 6 comment lines.
 *
 * The `yaml` package exposes two layers, and only the lower one is byte-faithful:
 *
 *   - The DOCUMENT layer (`parseDocument` / `setIn` / `toString`) keeps comments, but re-renders
 *     every node from the parsed value. An untouched folded scalar wrapped at 96 columns comes
 *     back wrapped at 80, so editing one short key rewrote 19 lines of that same gate file.
 *   - The CST layer (`Parser` -> tokens -> `CST.stringify`) reproduces the source token by token.
 *     Round-tripping all 105 bundled resources through it is byte-identical 105/105, and editing
 *     one scalar through `CST.setScalarValue` changed exactly the one line that key occupies.
 *
 * So an edit goes through the CST wherever it has a token-level form, and is byte-exact everywhere
 * else. Two shapes have one: a scalar replaced by a scalar, and a list that gained or lost items.
 * A list whose length changed is aligned item by item (`alignSequences`); a removed item's tokens
 * are cut out, and an added item is rendered on its own and spliced in at the list's indentation.
 * Replacing the whole list through the document layer instead, measured on the bundled
 * `reference_demo` prompt with one of its two tools dropped, kept 1 of its 5 comments and
 * re-wrapped a 133-column `description` the edit never named. Through the CST the same edit
 * removes that tool's line and nothing else.
 *
 * Every other STRUCTURAL edit — a key added or removed, a value that changed kind, a multi-line
 * string replacing a scalar, a list at the document root emptied — has no CST equivalent that
 * does not amount to hand-building tokens, and falls back to the document layer, which still
 * keeps comments but may re-wrap a long scalar. So does a token edit whose output would not load
 * back as exactly the value asked for, such as the string `'5'` written unquoted. A list edit in
 * the same write goes with it, and there the list's items are removed and inserted as nodes
 * rather than the list being replaced, so comments on the items that stay survive too. The tier
 * is reported rather than hidden, so a caller that cares can assert which one ran.
 *
 * A comment goes where the `yaml` package attaches it. One above the FIRST item of a block list
 * belongs to the list and stays while the list does, even if that item goes; one between two items
 * belongs to the item below it and leaves with it. A reorder is not a move: a list that kept its
 * length is compared position by position, so its comments stay put and the values change under
 * them, and a list that also changed length expresses a moved item as removed and re-added,
 * without its comments.
 *
 * The document tier makes two more measured normalizations beside the re-wrap: it re-pads an
 * untouched flow list (`[a, b]` to `[ a, b ]`) and inserts a blank line before a trailing comment.
 * Both are accepted for the edits that still reach that tier. Adding to or removing from a list,
 * the edit that used to surface them, no longer does, and no client has reported either.
 */

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { CST, Composer, Document, Parser, isSeq, parseDocument } from 'yaml';

import { serializeYaml } from './yaml-parser.js';

/**
 * The prior text of a file about to be rewritten, or `undefined` if there is none to preserve.
 *
 * Every writer reads its prior file through this rather than widening its own "read the existing
 * declarations" helper. `readCategoryYamlDocument` alone has four callers and only the write path
 * needs the source text, so threading it through the parsed-value helpers would be a contract
 * change in service of a concern three of those callers do not have. A missing or unreadable file
 * yields `undefined`, which the serializer reads as "no prior layout to preserve".
 */
export async function readYamlSource(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * `readYamlSource` for a caller that cannot await.
 *
 * The framework writer plans its files from a synchronous method whose result is consumed inside
 * an object literal, and making that path async would turn a private planning helper's signature
 * into a change across every caller of the write plan. It already resolves its directories with
 * `existsSync`, so a synchronous read is the established shape there rather than a new one.
 */
export function readYamlSourceSync(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Which mechanism produced the output — see the module comment for what each guarantees.
 *
 * Not exported: it reaches callers through `YamlWriteResult['fidelity']`, and exporting it as
 * well left a name nothing imported.
 */
type YamlWriteFidelity =
  /** No prior file: rendered from scratch. */
  | 'created'
  /** Nothing differed: the source was returned unchanged. */
  | 'unchanged'
  /**
   * Every change was made on the source tokens — a scalar replaced, a list item added or
   * removed — so untouched bytes are preserved exactly.
   */
  | 'source-preserved'
  /**
   * A change with no token-level form forced a document-level re-render; comments survive,
   * layout may shift.
   */
  | 'reserialized';

export interface YamlWriteResult {
  content: string;
  fidelity: YamlWriteFidelity;
}

type YamlPath = readonly (string | number)[];

/** An item a list gains, at its index in the NEW list. */
interface SequenceAddition {
  index: number;
  value: unknown;
}

/** A list whose length changed, as the items it lost and gained; every other item is kept. */
interface SequenceDifference {
  kind: 'sequence';
  path: YamlPath;
  /** Indices in the OLD list, ascending. */
  removed: readonly number[];
  /** Ascending by index in the NEW list. */
  added: readonly SequenceAddition[];
  nextValue: readonly unknown[];
}

type Difference =
  /** Both sides scalars at a path that already exists: one source-token edit. */
  | { kind: 'scalar'; path: YamlPath; nextValue: unknown }
  | SequenceDifference
  /** Anything else — a key added or removed (`nextValue: undefined` removes), a change of kind. */
  | { kind: 'structural'; path: YamlPath; nextValue: unknown };

/** The differences the source-token path can attempt. */
type TokenDifference = Exclude<Difference, { kind: 'structural' }>;

const isTokenDifference = (difference: Difference): difference is TokenDifference =>
  difference.kind !== 'structural';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isScalar = (value: unknown): boolean =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

/**
 * Every path at which `next` disagrees with `prev`.
 *
 * A difference is `scalar` only when BOTH sides are scalars at a path that already exists, because
 * that is precisely the case `CST.setScalarValue` can express, and `sequence` when a list changed
 * length (`collectSequenceDifferences`). Everything else — an added key, a removed key, a scalar
 * that became a map — is `structural`, and one structural difference is enough to send the whole
 * write through the document layer. Mixing the two layers in one write is not possible: the CST
 * serializer reads tokens and `Document.toString` reads the node tree, and an edit applied to one
 * is invisible to the other.
 */
function collectDifferences(prev: unknown, next: unknown, path: YamlPath, out: Difference[]): void {
  if (Object.is(prev, next)) {
    return;
  }

  if (isScalar(prev) && isScalar(next)) {
    if (prev !== next) {
      out.push({ kind: path.length > 0 ? 'scalar' : 'structural', path, nextValue: next });
    }
    return;
  }

  if (Array.isArray(prev) && Array.isArray(next)) {
    collectSequenceDifferences(prev, next, path, out);
    return;
  }

  if (isPlainObject(prev) && isPlainObject(next)) {
    collectMapDifferences(prev, next, path, out);
    return;
  }

  out.push({ kind: 'structural', path, nextValue: next });
}

/** Whether two values are the same by this module's own measure: nothing differs between them. */
function isSameValue(prev: unknown, next: unknown): boolean {
  const differences: Difference[] = [];
  collectDifferences(prev, next, [], differences);
  return differences.length === 0;
}

/**
 * The list half of `collectDifferences`.
 *
 * Two lists of one length are compared position by position, so a replaced item is one scalar
 * edit on its own line. A list whose length changed is aligned (`alignSequences`) and reported as
 * ONE sequence difference naming the items removed and added, plus the differences inside each
 * item edited in place, addressed by its OLD index. Recording the whole list as one replacement
 * instead would send every length change through the document layer.
 */
function collectSequenceDifferences(
  prev: readonly unknown[],
  next: readonly unknown[],
  path: YamlPath,
  out: Difference[]
): void {
  if (prev.length === next.length) {
    for (let index = 0; index < next.length; index += 1) {
      collectDifferences(prev[index], next[index], [...path, index], out);
    }
    return;
  }

  const alignment = alignSequences(prev, next);
  for (const [oldIndex, newIndex] of alignment.edited) {
    collectDifferences(prev[oldIndex], next[newIndex], [...path, oldIndex], out);
  }
  out.push({
    kind: 'sequence',
    path,
    removed: alignment.removed,
    added: alignment.added.map((index) => ({ index, value: next[index] })),
    nextValue: next,
  });
}

interface SequenceAlignment {
  /** Old and new index of each item kept in place whose content changed. */
  edited: Array<readonly [number, number]>;
  /** Old indices, ascending. */
  removed: number[];
  /** New indices, ascending. */
  added: number[];
}

/**
 * Pair the items of two lists of different length, keeping their order.
 *
 * Equal items are matched first, by a longest common subsequence, so an item that survived the
 * edit is recognised wherever its neighbours went. Between two matches, old and new items of the
 * same container kind (two mappings, or two lists) are paired in order as one item edited in
 * place — an `arguments` entry whose description changed in the same write that added another.
 * What is left over was removed or added. A scalar is never paired with a different scalar: its
 * value is its identity, so a changed scalar in a list that also changed length is one item
 * removed and one added, and a comment on the old one's line leaves with it.
 */
function alignSequences(prev: readonly unknown[], next: readonly unknown[]): SequenceAlignment {
  const alignment: SequenceAlignment = { edited: [], removed: [], added: [] };
  const anchors = [...commonSubsequence(prev, next), [prev.length, next.length] as const];
  let oldIndex = 0;
  let newIndex = 0;
  for (const [anchorOld, anchorNew] of anchors) {
    while (
      oldIndex < anchorOld &&
      newIndex < anchorNew &&
      isSameContainerKind(prev[oldIndex], next[newIndex])
    ) {
      alignment.edited.push([oldIndex, newIndex]);
      oldIndex += 1;
      newIndex += 1;
    }
    while (oldIndex < anchorOld) {
      alignment.removed.push(oldIndex);
      oldIndex += 1;
    }
    while (newIndex < anchorNew) {
      alignment.added.push(newIndex);
      newIndex += 1;
    }
    oldIndex = anchorOld + 1;
    newIndex = anchorNew + 1;
  }
  return alignment;
}

const isSameContainerKind = (prev: unknown, next: unknown): boolean =>
  (isPlainObject(prev) && isPlainObject(next)) || (Array.isArray(prev) && Array.isArray(next));

/** Index pairs of a longest common subsequence of equal items, ascending in both lists. */
function commonSubsequence(
  prev: readonly unknown[],
  next: readonly unknown[]
): Array<readonly [number, number]> {
  const width = next.length + 1;
  const cell = (oldIndex: number, newIndex: number): number => oldIndex * width + newIndex;
  const equal = new Array<boolean>(prev.length * width).fill(false);
  // `suffix[cell(i, j)]` is the length of a longest common subsequence of prev[i..] and next[j..].
  const suffix = new Array<number>((prev.length + 1) * width).fill(0);
  const at = (oldIndex: number, newIndex: number): number => suffix[cell(oldIndex, newIndex)] ?? 0;

  for (let oldIndex = prev.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = next.length - 1; newIndex >= 0; newIndex -= 1) {
      const same = isSameValue(prev[oldIndex], next[newIndex]);
      equal[cell(oldIndex, newIndex)] = same;
      suffix[cell(oldIndex, newIndex)] = same
        ? at(oldIndex + 1, newIndex + 1) + 1
        : Math.max(at(oldIndex + 1, newIndex), at(oldIndex, newIndex + 1));
    }
  }

  const matches: Array<readonly [number, number]> = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < prev.length && newIndex < next.length) {
    if (equal[cell(oldIndex, newIndex)] === true) {
      matches.push([oldIndex, newIndex]);
      oldIndex += 1;
      newIndex += 1;
    } else if (at(oldIndex + 1, newIndex) >= at(oldIndex, newIndex + 1)) {
      oldIndex += 1;
    } else {
      newIndex += 1;
    }
  }
  return matches;
}

/**
 * The mapping half of `collectDifferences`.
 *
 * A key order change alone is not reported: the values are identical, and the authored order is
 * exactly what this module exists to keep. A key present on only one side is structural, because
 * neither adding nor removing a mapping entry is something a scalar token edit can express.
 */
function collectMapDifferences(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  path: YamlPath,
  out: Difference[]
): void {
  for (const key of Object.keys(next)) {
    if (key in prev) {
      collectDifferences(prev[key], next[key], [...path, key], out);
    } else {
      out.push({ kind: 'structural', path: [...path, key], nextValue: next[key] });
    }
  }

  for (const key of Object.keys(prev)) {
    if (!(key in next)) {
      out.push({ kind: 'structural', path: [...path, key], nextValue: undefined });
    }
  }
}

/** What the token edits need to know about the file they edit. */
interface SourceLayout {
  source: string;
  /** The file's own line ending, so a spliced-in item does not put `\n` into a `\r\n` file. */
  eol: string;
}

/**
 * Apply every difference to the CST tokens and re-stringify.
 *
 * Returns `undefined` when any difference has no token-level form, or when the result does not
 * load back as `next`. Either sends the caller to the document layer rather than writing a
 * partially-applied file. That is a loud-ish failure by design: a silently skipped edit would
 * report success and change nothing.
 */
function applyThroughSourceTokens(
  doc: Document,
  tokens: readonly CST.Token[],
  differences: readonly TokenDifference[],
  layout: SourceLayout,
  next: unknown
): string | undefined {
  for (const difference of differences) {
    const applied =
      difference.kind === 'sequence'
        ? editSequenceTokens(doc, difference, layout)
        : editScalarToken(doc, difference.path, difference.nextValue);
    if (!applied) {
      return undefined;
    }
  }

  let out = '';
  for (const token of tokens) {
    out += CST.stringify(token);
  }
  return loadsAs(out, next) ? out : undefined;
}

/** Replace one scalar's token text; `false` when the value has no faithful token form there. */
function editScalarToken(doc: Document, path: YamlPath, next: unknown): boolean {
  const node: unknown = doc.getIn(path, true);
  const srcToken = (node as { srcToken?: CST.Token } | undefined)?.srcToken;
  if (srcToken === undefined || !CST.isScalar(srcToken)) {
    return false;
  }

  if (typeof next === 'string') {
    // A value carrying newlines is refused here, not written. `CST.setScalarValue` drops a
    // multi-line string into a block scalar's token without re-indenting its continuation
    // lines, which ends the block early and produces a file that no longer parses: replacing
    // a framework's folded `systemPromptGuidance` emitted `## Method` at column 0 and the
    // mutation transaction rejected the result. The document layer renders block scalars
    // correctly, so multi-line values go there.
    if (next.includes('\n')) {
      return false;
    }
    CST.setScalarValue(srcToken, next);
    return true;
  }
  // A number or boolean is written as its own text, and only into a PLAIN token. Writing `5`
  // into a token the author quoted would leave `"5"` on disk — still a string, so the edit
  // would report success and not take effect. Anything else defers to the document layer,
  // which re-renders the node with the right type at the cost of possible re-wrapping.
  if ((typeof next === 'number' || typeof next === 'boolean') && srcToken.type === 'scalar') {
    CST.setScalarValue(srcToken, String(next));
    return true;
  }
  return false;
}

/**
 * Whether `text` parses cleanly AND loads as exactly `next`.
 *
 * The source-token path edits TEXT, so a token helper that mis-renders a value produces a file
 * that no longer PARSES rather than one that parses differently. The multi-line block-scalar case
 * in `editScalarToken` is one such helper; this check closes the class rather than that one
 * instance, by refusing any output this module cannot read back. Refusing returns the caller to
 * the document layer, which renders from the node tree and cannot emit malformed YAML, so the
 * cost of a future mis-render is a re-wrapped file and never a corrupt one.
 *
 * Parsing alone is not enough. Text can parse and MEAN something else: `CST.setScalarValue`
 * writes the string `'5'` into a plain token as `5`, and `'true'` as `true`, which load as a number
 * and a boolean, and a spliced-in list item means whatever its neighbours' tokens make of it. So
 * the reloaded value is compared with the one asked for, by this module's own measure (key order
 * is not a difference).
 *
 * `parseDocument` COLLECTS syntax errors instead of throwing, so a bare try/catch here is a
 * guard that never fires. It was written that way first, and the mutation re-introducing the
 * block-scalar defect walked straight through it.
 */
function loadsAs(text: string, next: unknown): boolean {
  try {
    const reloaded = parseDocument(text);
    return reloaded.errors.length === 0 && isSameValue(reloaded.toJS(), next);
  } catch {
    return false;
  }
}

/** One `- item` of a block list, as the CST holds it. */
type BlockEntry = CST.BlockSequence['items'][number];

/**
 * Tokens this module creates. Their offsets are never read: `CST.stringify` concatenates
 * `source` alone, and the output is re-parsed before it is trusted.
 */
const syntheticToken = (type: CST.SourceToken['type'], source: string): CST.SourceToken => ({
  type,
  offset: 0,
  indent: 0,
  source,
});

const descending = (indices: readonly number[]): number[] => [...indices].sort((a, b) => b - a);

/** The single document token `text` parses to, if there is one. */
function parseDocumentToken(text: string): CST.Document | undefined {
  return Array.from(new Parser().parse(text)).find(
    (token): token is CST.Document => token.type === 'document'
  );
}

/**
 * Remove and insert the items a list-length difference names, on the list's own tokens.
 *
 * `false` for a list this cannot address item by item: a block list whose token items do not line
 * up one to one with its parsed items, a flow list holding `key: value` pairs or a trailing comma,
 * or a value that is not a list token at all (an alias, say).
 */
function editSequenceTokens(
  doc: Document,
  difference: SequenceDifference,
  layout: SourceLayout
): boolean {
  const node: unknown = doc.getIn(difference.path, true);
  if (!isSeq(node)) {
    return false;
  }
  const token = node.srcToken;
  if (token?.type === 'block-seq') {
    return editBlockSequence(doc, token, node.items.length, difference, layout);
  }
  if (token?.type === 'flow-collection' && token.start.type === 'flow-seq-start') {
    return editFlowSequence(token, node.items.length, difference);
  }
  return false;
}

/**
 * The block-list half of `editSequenceTokens`.
 *
 * A block list's items are whole lines. Every item after the first starts at its own line's
 * indentation and carries the comment lines above it, and ends with its line break, so cutting an
 * item's tokens out removes exactly its lines. The first item is the exception: its indentation,
 * and any comment above it, sit in the tokens BEFORE the list (the separator after its key), so
 * removing or inserting at index 0 moves an indentation token between neighbours. A trailer of
 * comment lines after the last item stays last.
 */
function editBlockSequence(
  doc: Document,
  token: CST.BlockSequence,
  itemCount: number,
  difference: SequenceDifference,
  layout: SourceLayout
): boolean {
  const split = splitBlockEntries(token);
  if (split?.entries.length !== itemCount) {
    return false;
  }
  // A block list's token starts at its first `-`, so this is the column every item sits at.
  const column = token.offset - (layout.source.lastIndexOf('\n', token.offset - 1) + 1);

  const rendered: Array<{ index: number; entry: BlockEntry }> = [];
  for (const { index, value } of difference.added) {
    const entry = renderBlockEntry(value, column, layout.eol);
    if (entry === undefined) {
      return false;
    }
    rendered.push({ index, entry });
  }

  const { entries, trailer } = split;
  for (const index of descending(difference.removed)) {
    removeBlockEntry(entries, index);
  }
  for (const { index, entry } of rendered) {
    insertBlockEntry(entries, index, entry, column);
  }
  if (entries.length === 0) {
    return replaceWithEmptyList(doc, difference.path, token, trailer, layout.eol);
  }
  token.items = [...entries, ...trailer];
  return true;
}

/**
 * A block list's items split into its entries and a trailer of comment lines after the last one.
 * `undefined` if a comment-only item sits anywhere but the end, which this cannot keep in place.
 */
function splitBlockEntries(
  token: CST.BlockSequence
): { entries: BlockEntry[]; trailer: BlockEntry[] } | undefined {
  const isEntry = (item: BlockEntry): boolean =>
    item.start.some((part) => part.type === 'seq-item-ind');
  const firstTrailing = token.items.findIndex((item) => !isEntry(item));
  const cut = firstTrailing === -1 ? token.items.length : firstTrailing;
  const trailer = token.items.slice(cut);
  if (trailer.some((item) => isEntry(item) || item.value !== undefined)) {
    return undefined;
  }
  return { entries: token.items.slice(0, cut), trailer };
}

/**
 * Cut entry `index` out. When it was the first, the entry promoted in its place drops its leading
 * indentation and blank lines, because the tokens before the list already end at its column.
 */
function removeBlockEntry(entries: BlockEntry[], index: number): void {
  entries.splice(index, 1);
  const promoted = entries[0];
  if (index !== 0 || promoted === undefined) {
    return;
  }
  while (promoted.start[0]?.type === 'space' || promoted.start[0]?.type === 'newline') {
    promoted.start.shift();
  }
}

/**
 * Splice a rendered entry in at `index` of the NEW list. Whichever entry ends up second or later
 * needs its own line indentation; the one that ends up first borrows the tokens before the list.
 */
function insertBlockEntry(
  entries: BlockEntry[],
  index: number,
  entry: BlockEntry,
  column: number
): void {
  const indented = index === 0 ? entries[0] : entry;
  if (indented !== undefined && column > 0) {
    indented.start.unshift(syntheticToken('space', ' '.repeat(column)));
  }
  entries.splice(index, 0, entry);
}

/**
 * An added item as the tokens of one `- item` entry at `column`.
 *
 * Rendered by `serializeYaml`, the renderer a new file gets, so an added item reads like one that
 * `create` wrote. It is indented and parsed under a throwaway key, rather than at column 0, so a
 * multi-line item's continuation lines carry their final indentation.
 */
function renderBlockEntry(value: unknown, column: number, eol: string): BlockEntry | undefined {
  const pad = ' '.repeat(column);
  const body = serializeYaml([value], { sortKeys: false })
    .split('\n')
    .map((line) => (line === '' ? line : `${pad}${line}`))
    .join(eol);
  const holder = parseDocumentToken(`item:${eol}${body}`)?.value;
  const list = holder?.type === 'block-map' ? holder.items[0]?.value : undefined;
  return list?.type === 'block-seq' && list.items.length === 1 ? list.items[0] : undefined;
}

const SEPARATOR_LAYOUT: ReadonlySet<string> = new Set(['map-value-ind', 'space', 'newline']);

/**
 * A block list that lost every item becomes `[]` in place.
 *
 * A block list cannot be empty (`key:` followed by nothing loads as `null`), so its token is
 * swapped for an empty flow list on the item that holds it. Where only whitespace separates the
 * key from the list, `[]` moves up beside the key. A comment there stays, with `[]` on its own line
 * beneath it, which is also where the document layer puts it. A list at the document root is
 * left to the document layer.
 */
function replaceWithEmptyList(
  doc: Document,
  path: YamlPath,
  token: CST.BlockSequence,
  trailer: readonly BlockEntry[],
  eol: string
): boolean {
  if (path.length === 0) {
    return false;
  }
  const parent: unknown = doc.getIn(path.slice(0, -1), true);
  const parentToken = (parent as { srcToken?: CST.Token } | undefined)?.srcToken;
  if (parentToken?.type !== 'block-map' && parentToken?.type !== 'block-seq') {
    return false;
  }
  const items: readonly CST.CollectionItem[] = parentToken.items;
  const holder = items.find((item) => item.value === token);
  if (holder === undefined) {
    return false;
  }

  holder.value = {
    type: 'flow-collection',
    offset: token.offset,
    indent: token.indent,
    start: syntheticToken('flow-seq-start', '['),
    items: [],
    end: [
      syntheticToken('flow-seq-end', ']'),
      syntheticToken('newline', eol),
      ...trailer.flatMap((item) => item.start),
    ],
  };
  const separator = holder.sep;
  const indicator = separator?.find((part) => part.type === 'map-value-ind');
  if (
    separator !== undefined &&
    indicator !== undefined &&
    separator.every((part) => SEPARATOR_LAYOUT.has(part.type))
  ) {
    holder.sep = [indicator, syntheticToken('space', ' ')];
  }
  return true;
}

/**
 * The flow-list half of `editSequenceTokens`.
 *
 * In `[a, b]` every item after the first starts with its separating comma, the first item holds
 * whatever follows `[`, and the last item's value ends with whatever precedes `]`. Those two
 * layouts stay at the ends of the list whatever is removed or inserted, so `[ a, b ]` keeps its
 * padding and a list written across lines keeps its closing line.
 */
function editFlowSequence(
  token: CST.FlowCollection,
  itemCount: number,
  difference: SequenceDifference
): boolean {
  const entries = token.items;
  const addressable = entries.every(
    (entry) => entry.key === undefined && entry.sep === undefined && entry.value !== undefined
  );
  if (!addressable || entries.length !== itemCount) {
    return false;
  }

  const rendered: Array<{ index: number; value: CST.Token }> = [];
  for (const { index, value } of difference.added) {
    const valueToken = renderFlowValue(value);
    if (valueToken === undefined) {
      return false;
    }
    rendered.push({ index, value: valueToken });
  }

  const separator = flowSeparator(entries);
  const closing = detachTrailingLayout(entries[entries.length - 1]?.value);
  for (const index of descending(difference.removed)) {
    removeFlowEntry(entries, index);
  }
  for (const { index, value } of rendered) {
    insertFlowEntry(entries, index, value, separator);
  }
  const last = entries[entries.length - 1]?.value;
  if (last !== undefined) {
    trailingTokens(last)?.push(...closing);
  }
  return true;
}

/**
 * The tokens between two items of this list, so an inserted item matches its neighbours. Comments
 * are left out: one after a comma annotates the item before it, and must not be copied.
 */
function flowSeparator(entries: readonly CST.CollectionItem[]): CST.SourceToken[] {
  const sample = entries[1]?.start;
  if (sample === undefined) {
    return [syntheticToken('comma', ','), syntheticToken('space', ' ')];
  }
  return sample.filter(
    (part, position) =>
      part.type !== 'comment' &&
      !(part.type === 'space' && sample[position + 1]?.type === 'comment')
  );
}

/** Cut item `index` out; when it was the first, its opening layout passes to the one promoted. */
function removeFlowEntry(entries: CST.CollectionItem[], index: number): void {
  const [removed] = entries.splice(index, 1);
  const promoted = entries[0];
  if (index === 0 && removed !== undefined && promoted !== undefined) {
    promoted.start = removed.start;
  }
}

/** Splice a value in at `index` of the NEW list; the item that ends up first keeps the opening. */
function insertFlowEntry(
  entries: CST.CollectionItem[],
  index: number,
  value: CST.Token,
  separator: readonly CST.SourceToken[]
): void {
  const copySeparator = (): CST.SourceToken[] => separator.map((part) => ({ ...part }));
  if (index > 0) {
    entries.splice(index, 0, { start: copySeparator(), value });
    return;
  }
  const displaced = entries[0];
  entries.unshift({ start: displaced?.start ?? [], value });
  if (displaced !== undefined) {
    displaced.start = copySeparator();
  }
}

/** The tokens a flow value ends with, which is where the layout before a closing `]` lives. */
function trailingTokens(value: CST.Token): CST.SourceToken[] | undefined {
  if (value.type === 'flow-collection') {
    return value.end;
  }
  if (
    value.type === 'scalar' ||
    value.type === 'single-quoted-scalar' ||
    value.type === 'double-quoted-scalar' ||
    value.type === 'alias'
  ) {
    value.end ??= [];
    return value.end;
  }
  return undefined;
}

const TRAILING_LAYOUT: ReadonlySet<string> = new Set(['space', 'newline', 'comment']);

/** Cut the whitespace and comments a flow value ends with off it, and return them. */
function detachTrailingLayout(value: CST.Token | undefined): CST.SourceToken[] {
  const end = value === undefined ? undefined : trailingTokens(value);
  if (end === undefined) {
    return [];
  }
  let cut = end.length;
  while (cut > 0 && TRAILING_LAYOUT.has(end[cut - 1]?.type ?? '')) {
    cut -= 1;
  }
  return end.splice(cut);
}

/**
 * An added item as one flow value token, rendered on one line (`lineWidth: 0`). A value folded
 * across lines inside a flow list would need continuation indentation that depends on where it
 * lands.
 */
function renderFlowValue(value: unknown): CST.Token | undefined {
  const holder = new Document([value], { aliasDuplicateObjects: false });
  if (!isSeq(holder.contents)) {
    return undefined;
  }
  holder.contents.flow = true;
  const text = holder.toString({ flowCollectionPadding: false, lineWidth: 0 });
  const list = parseDocumentToken(text)?.value;
  const token =
    list?.type === 'flow-collection' && list.items.length === 1 ? list.items[0]?.value : undefined;
  if (token !== undefined) {
    detachTrailingLayout(token);
  }
  return token;
}

/**
 * Apply every difference to the node tree and re-render it.
 *
 * Deepest paths go first. A list-length difference addresses its kept items by their OLD index,
 * and so do the differences inside them, so every edit inside an item lands before its list's
 * items move. A list's items are removed and inserted as nodes, never replaced wholesale, so the
 * comments on the items that stay survive the re-render.
 */
function applyThroughDocument(doc: Document, differences: readonly Difference[]): string {
  const deepestFirst = [...differences].sort((a, b) => b.path.length - a.path.length);
  for (const difference of deepestFirst) {
    if (difference.kind === 'sequence') {
      editSequenceNodes(doc, difference);
    } else if (difference.nextValue === undefined) {
      doc.deleteIn(difference.path);
    } else {
      doc.setIn(difference.path, difference.nextValue);
    }
  }
  return doc.toString();
}

function editSequenceNodes(doc: Document, difference: SequenceDifference): void {
  const node: unknown = doc.getIn(difference.path, true);
  if (!isSeq(node)) {
    // Not a list node (an alias, say), so there is no item to edit in place: replace the value.
    doc.setIn(difference.path, difference.nextValue);
    return;
  }
  for (const index of descending(difference.removed)) {
    node.items.splice(index, 1);
  }
  for (const { index, value } of difference.added) {
    node.items.splice(index, 0, doc.createNode(value));
  }
}

/**
 * Serialize `next` as the new contents of a YAML file, preserving whatever of `existingSource`
 * the change does not touch.
 *
 * @param next - The complete value the file should hold after the write.
 * @param existingSource - The file's current text, or `undefined` for a create.
 */
export function serializeYamlPreservingSource(
  next: unknown,
  existingSource?: string
): YamlWriteResult {
  if (existingSource === undefined || existingSource.trim() === '') {
    return { content: serializeYaml(next, { sortKeys: false }), fidelity: 'created' };
  }

  let tokens: CST.Token[];
  let doc: Document | undefined;
  try {
    tokens = Array.from(new Parser().parse(existingSource));
    doc = Array.from(new Composer({ keepSourceTokens: true }).compose(tokens))[0];
  } catch {
    // An unparseable file has no layout worth preserving and no safe path to edit in place.
    // Rendering from scratch is the honest outcome, and the same one the writers produced before
    // this module existed.
    //
    // This catch covers a genuine throw out of the parser or composer only. It is NOT the guard
    // against a malformed file: composition COLLECTS syntax problems onto the document instead of
    // throwing them, so the `doc.errors` test below is the load-bearing half and this branch may
    // never run for an input a reader would call broken.
    return { content: serializeYaml(next, { sortKeys: false }), fidelity: 'created' };
  }

  // A multi-document stream has no single value this write could be editing, and `doc.errors` is
  // where a malformed file actually surfaces — see the note in the catch above.
  const documentCount = tokens.filter((token) => token.type === 'document').length;
  if (doc === undefined || documentCount !== 1 || doc.errors.length > 0) {
    return { content: serializeYaml(next, { sortKeys: false }), fidelity: 'created' };
  }

  const differences: Difference[] = [];
  collectDifferences(doc.toJS(), next, [], differences);

  if (differences.length === 0) {
    return { content: existingSource, fidelity: 'unchanged' };
  }

  if (differences.every(isTokenDifference)) {
    const layout: SourceLayout = {
      source: existingSource,
      eol: existingSource.includes('\r\n') ? '\r\n' : '\n',
    };
    const preserved = applyThroughSourceTokens(doc, tokens, differences, layout, next);
    if (preserved !== undefined) {
      return { content: preserved, fidelity: 'source-preserved' };
    }
    // The CST attempt may have edited tokens before it gave up (a list's items cut or spliced,
    // a scalar rewritten), and `doc` shares those tokens, so the fallback re-composes below.
    const reparsed = Array.from(
      new Composer().compose(Array.from(new Parser().parse(existingSource)))
    )[0];
    if (reparsed !== undefined) {
      return { content: applyThroughDocument(reparsed, differences), fidelity: 'reserialized' };
    }
  }

  return { content: applyThroughDocument(doc, differences), fidelity: 'reserialized' };
}

// @lifecycle canonical - Source-preserving YAML serialization for resource writes.
/**
 * Serializing a resource edit WITHOUT rewriting the parts of the file the edit did not name.
 *
 * `serializeYaml` (js-yaml `dump`) renders a whole JS value from scratch. That is correct for a
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
 * So a scalar-only edit goes through the CST and is byte-exact everywhere else. A STRUCTURAL edit
 * — a key added or removed, a sequence that changed length, a value that changed kind — has no
 * CST equivalent that does not amount to hand-building tokens, and falls back to the document
 * layer, which still keeps comments but may re-wrap a long scalar. The tier is reported rather
 * than hidden, so a caller that cares can assert which one ran.
 */

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { CST, Composer, Parser, parseDocument, type Document } from 'yaml';

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
  /** Every change was a scalar replacement; untouched bytes are preserved exactly. */
  | 'source-preserved'
  /** A structural change forced a document-level re-render; comments survive, layout may shift. */
  | 'reserialized';

export interface YamlWriteResult {
  content: string;
  fidelity: YamlWriteFidelity;
}

type YamlPath = readonly (string | number)[];

interface Difference {
  path: YamlPath;
  /** `true` when both sides are scalars at an existing path — the only CST-editable shape. */
  scalarReplacement: boolean;
  nextValue: unknown;
}

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
 * A difference is marked `scalarReplacement` only when BOTH sides are scalars at a path that
 * already exists, because that is precisely the case `CST.setScalarValue` can express. Everything
 * else — an added key, a removed key, a sequence whose length moved, a scalar that became a map —
 * is reported as structural, and one structural difference is enough to send the whole write
 * through the document layer. Mixing the two layers in one write is not possible: the CST
 * serializer reads tokens and `Document.toString` reads the node tree, and an edit applied to one
 * is invisible to the other.
 */
function collectDifferences(prev: unknown, next: unknown, path: YamlPath, out: Difference[]): void {
  if (Object.is(prev, next)) {
    return;
  }

  if (isScalar(prev) && isScalar(next)) {
    if (prev !== next) {
      out.push({ path, scalarReplacement: path.length > 0, nextValue: next });
    }
    return;
  }

  if (Array.isArray(prev) && Array.isArray(next) && prev.length === next.length) {
    for (let index = 0; index < next.length; index += 1) {
      collectDifferences(prev[index], next[index], [...path, index], out);
    }
    return;
  }

  if (isPlainObject(prev) && isPlainObject(next)) {
    collectMapDifferences(prev, next, path, out);
    return;
  }

  out.push({ path, scalarReplacement: false, nextValue: next });
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
      out.push({ path: [...path, key], scalarReplacement: false, nextValue: next[key] });
    }
  }

  for (const key of Object.keys(prev)) {
    if (!(key in next)) {
      out.push({ path: [...path, key], scalarReplacement: false, nextValue: undefined });
    }
  }
}

/**
 * Apply scalar-only differences to the CST tokens and re-stringify.
 *
 * Returns `undefined` when any path turns out not to resolve to an editable scalar token, which
 * sends the caller to the document layer rather than writing a partially-applied file. That is a
 * loud-ish failure by design: a silently skipped edit would report success and change nothing.
 */
function applyThroughSourceTokens(
  doc: Document,
  tokens: readonly CST.Token[],
  differences: readonly Difference[]
): string | undefined {
  for (const difference of differences) {
    const node: unknown = doc.getIn(difference.path, true);
    const srcToken = (node as { srcToken?: CST.Token } | undefined)?.srcToken;
    if (srcToken === undefined || !CST.isScalar(srcToken)) {
      return undefined;
    }

    const next = difference.nextValue;
    if (typeof next === 'string') {
      // A value carrying newlines is refused here, not written. `CST.setScalarValue` drops a
      // multi-line string into a block scalar's token without re-indenting its continuation
      // lines, which ends the block early and produces a file that no longer parses: replacing
      // a framework's folded `systemPromptGuidance` emitted `## Method` at column 0 and the
      // mutation transaction rejected the result. The document layer renders block scalars
      // correctly, so multi-line values go there.
      if (next.includes('\n')) {
        return undefined;
      }
      CST.setScalarValue(srcToken, next);
      continue;
    }
    // A number or boolean is written as its own text, and only into a PLAIN token. Writing `5`
    // into a token the author quoted would leave `"5"` on disk — still a string, so the edit
    // would report success and not take effect. Anything else defers to the document layer,
    // which re-renders the node with the right type at the cost of possible re-wrapping.
    if ((typeof next === 'number' || typeof next === 'boolean') && srcToken.type === 'scalar') {
      CST.setScalarValue(srcToken, String(next));
      continue;
    }
    return undefined;
  }

  let out = '';
  for (const token of tokens) {
    out += CST.stringify(token);
  }

  // The source-token path edits TEXT, so a token helper that mis-renders a value produces a file
  // that no longer PARSES rather than one that parses differently. The multi-line block-scalar
  // case above is one such helper; this check closes the class rather than that one instance, by
  // refusing any output this module cannot read back. Refusing returns the caller to the document
  // layer, which renders from the node tree and cannot emit malformed YAML, so the cost of a
  // future mis-render is a re-wrapped file and never a corrupt one.
  //
  // `parseDocument` COLLECTS syntax errors instead of throwing, so a bare try/catch here is a
  // guard that never fires. It was written that way first, and the mutation re-introducing the
  // block-scalar defect walked straight through it.
  try {
    if (parseDocument(out).errors.length > 0) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return out;
}

function applyThroughDocument(doc: Document, differences: readonly Difference[]): string {
  for (const difference of differences) {
    if (difference.nextValue === undefined) {
      doc.deleteIn(difference.path);
      continue;
    }
    doc.setIn(difference.path, difference.nextValue);
  }
  return doc.toString();
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
    return { content: serializeYaml(next, { sortKeys: false }), fidelity: 'created' };
  }

  // A multi-document stream has no single value this write could be editing.
  const documentCount = tokens.filter((token) => token.type === 'document').length;
  if (doc === undefined || documentCount !== 1 || doc.errors.length > 0) {
    return { content: serializeYaml(next, { sortKeys: false }), fidelity: 'created' };
  }

  const differences: Difference[] = [];
  collectDifferences(doc.toJS(), next, [], differences);

  if (differences.length === 0) {
    return { content: existingSource, fidelity: 'unchanged' };
  }

  if (differences.every((difference) => difference.scalarReplacement)) {
    const preserved = applyThroughSourceTokens(doc, tokens, differences);
    if (preserved !== undefined) {
      return { content: preserved, fidelity: 'source-preserved' };
    }
    // The CST attempt mutated nothing durable (it returns before stringifying on the first
    // unresolvable path), but `doc` shares those tokens, so the fallback re-composes below.
    const reparsed = Array.from(
      new Composer().compose(Array.from(new Parser().parse(existingSource)))
    )[0];
    if (reparsed !== undefined) {
      return { content: applyThroughDocument(reparsed, differences), fidelity: 'reserialized' };
    }
  }

  return { content: applyThroughDocument(doc, differences), fidelity: 'reserialized' };
}

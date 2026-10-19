// @lifecycle canonical - JSON file text in the layout the repository's Prettier contract prints.
/**
 * Text for a JSON file a person may commit: a tool's `schema.json`, an exported skill's
 * `tool.json` or `gates/index.json`.
 *
 * `JSON.stringify(value, null, 2)` is not that text. It ends without a newline and puts every
 * array element on its own line, while Prettier (which `validate:format` runs over every tracked
 * JSON file) keeps a short array on one line — so one `resource_manager` update of a bundled tool
 * produced a `schema.json` the format gate refused. Prettier is a devDependency and user
 * workspaces carry no config for it, so the writer prints the formatter's layout itself.
 *
 * The layout reproduces Prettier 3's `json` parser output at `server/.prettierrc.json`'s JSON
 * settings (`printWidth` 80 through the `*.json` override, 2-space indent), measured shape by shape:
 *
 * - a non-empty object always spreads one key per line (Prettier keeps an object expanded when its
 *   source was, and this writer's source always is);
 * - an array goes on one line when nothing inside it forces a break and that line, counting its
 *   indentation, key and trailing comma, fits in 80 columns;
 * - a non-empty object inside an array forces the array to break, and so do two or more arrays of
 *   the same kind that each hold more than one element (`[[1, 2], [3, 4]]`);
 * - a broken array of numbers only is filled, as many per line as fit; any other broken array has
 *   one element per line;
 * - an exponent is printed without its `+` (`1e21`, as Prettier normalizes it);
 * - strings and keys are escaped exactly as `JSON.stringify` escapes them, and their width is
 *   measured the way Prettier measures it (a CJK or emoji character takes two columns).
 *
 * `tests/unit/shared/utils/json-document-format.test.ts` checks every shape against Prettier
 * itself, and the bundled `resources/**` JSON files against their own bytes.
 */

/** Prettier's `printWidth` for `*.json` in `server/.prettierrc.json` (an override of the 100 default). */
const PRINT_WIDTH = 80;
const INDENT_UNIT = '  ';

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
interface JsonObject {
  [key: string]: JsonValue;
}

/** Where a value starts on its line, and whether a comma follows it there. */
interface LinePosition {
  readonly indent: string;
  readonly column: number;
  readonly trailing: number;
}

/**
 * The file text for `value`: the repository formatter's layout, ending with one newline.
 *
 * Accepts what `JSON.stringify` accepts and keeps its semantics (`toJSON`, dropped `undefined`
 * members, non-finite numbers as `null`). Throws for a value with no JSON text at all.
 */
export function formatJsonDocument(value: unknown): string {
  // Typed `string`, but `undefined` for a function, a symbol or `undefined` itself.
  const text = JSON.stringify(value) as string | undefined;
  if (text === undefined) {
    throw new TypeError(`formatJsonDocument: a ${typeof value} has no JSON representation`);
  }
  const root = JSON.parse(text) as JsonValue;
  return `${printValue(root, { indent: '', column: 0, trailing: 0 })}\n`;
}

function printValue(value: JsonValue, at: LinePosition): string {
  if (Array.isArray(value)) return printArray(value, at);
  if (isObject(value)) return printObject(value, at.indent);
  return printScalar(value);
}

function printScalar(value: null | boolean | number | string): string {
  const text = JSON.stringify(value);
  return typeof value === 'number' ? text.replace('e+', 'e') : text;
}

function printObject(value: JsonObject, indent: string): string {
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  const inner = indent + INDENT_UNIT;
  const lines = entries.map(([key, member], index) => {
    const prefix = `${inner}${JSON.stringify(key)}: `;
    const trailing = index < entries.length - 1 ? 1 : 0;
    return prefix + printValue(member, { indent: inner, column: textWidth(prefix), trailing });
  });
  return `{\n${lines.join(',\n')}\n${indent}}`;
}

function printArray(items: JsonValue[], at: LinePosition): string {
  if (items.length === 0) return '[]';
  if (!arrayForcesBreak(items)) {
    const flat = printFlat(items);
    if (at.column + textWidth(flat) + at.trailing <= PRINT_WIDTH) return flat;
  }
  const inner = at.indent + INDENT_UNIT;
  const body = items.every((item) => typeof item === 'number')
    ? fillLines(items, inner)
    : items
        .map((item, index) => {
          const trailing = index < items.length - 1 ? 1 : 0;
          return inner + printValue(item, { indent: inner, column: inner.length, trailing });
        })
        .join(',\n');
  return `[\n${body}\n${at.indent}]`;
}

/** A broken numbers-only array: as many elements per line as fit, each followed by its comma. */
function fillLines(items: number[], inner: string): string {
  const parts = items.map(
    (item, index) => printScalar(item) + (index < items.length - 1 ? ',' : '')
  );
  const lines: string[] = [];
  let line = inner + parts[0];
  for (const part of parts.slice(1)) {
    if (line.length + 1 + part.length <= PRINT_WIDTH) {
      line += ` ${part}`;
    } else {
      lines.push(line);
      line = inner + part;
    }
  }
  lines.push(line);
  return lines.join('\n');
}

/** One-line text of a value nothing inside forces to break. */
function printFlat(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(printFlat).join(', ')}]`;
  if (isObject(value)) {
    if (Object.keys(value).length > 0) {
      throw new Error('formatJsonDocument: a non-empty object cannot be printed on one line');
    }
    return '{}';
  }
  return printScalar(value);
}

function valueForcesBreak(value: JsonValue): boolean {
  if (Array.isArray(value)) return arrayForcesBreak(value);
  return isObject(value) && Object.keys(value).length > 0;
}

/**
 * Prettier breaks an array whose elements are two or more objects or arrays of one kind, each
 * holding more than one member, and any array holding something that itself must break.
 */
function arrayForcesBreak(items: JsonValue[]): boolean {
  return items.some(valueForcesBreak) || isMatrixLike(items);
}

function isMatrixLike(items: JsonValue[]): boolean {
  if (items.length < 2) return false;
  return items.every((item, index) => {
    const next = items[index + 1];
    if (next !== undefined && containerKind(next) !== containerKind(item)) return false;
    return containerSize(item) > 1;
  });
}

function containerKind(value: JsonValue): 'array' | 'object' | 'scalar' {
  if (Array.isArray(value)) return 'array';
  return isObject(value) ? 'object' : 'scalar';
}

function containerSize(value: JsonValue): number {
  if (Array.isArray(value)) return value.length;
  return isObject(value) ? Object.keys(value).length : 0;
}

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ── Display width ────────────────────────────────────────────────────────────
//
// Prettier measures a line in terminal columns, not UTF-16 units: an emoji sequence or an East
// Asian wide character is 2, a combining mark or variation selector is 0. These ranges cover the
// wide blocks (Hangul, kana, CJK ideographs, fullwidth forms) rather than Unicode's whole
// East_Asian_Width table; a rare wide symbol outside them is measured as 1.

const ASCII_ONLY = /^[\x20-\x7F]*$/;
const EMOJI_SEQUENCE = new RegExp('\\p{RGI_Emoji}', 'gv');

/** Inclusive code point ranges measured as two columns. */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x17000, 0x18cff],
  [0x1b000, 0x1b2ff],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];

function textWidth(text: string): number {
  if (ASCII_ONLY.test(text)) return text.length;
  let width = 0;
  const rest = text.replace(EMOJI_SEQUENCE, () => {
    width += 2;
    return '';
  });
  for (const character of rest) {
    width += codePointWidth(character.codePointAt(0) ?? 0);
  }
  return width;
}

function codePointWidth(codePoint: number): number {
  const isControl = codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  const isZeroWidthMark =
    (codePoint >= 0x300 && codePoint <= 0x36f) || (codePoint >= 0xfe00 && codePoint <= 0xfe0f);
  if (isControl || isZeroWidthMark) return 0;
  return WIDE_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end) ? 2 : 1;
}

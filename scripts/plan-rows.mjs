/**
 * The plan-row vocabulary and table parser — one definition for every reader of a plan's tables.
 *
 * WHY THIS EXISTS. Before this module the same question ("which lines are rows, and what status
 * does each one carry?") was answered in four places: a consumer's plan-row gate, the managed
 * `validate-pr-body.mjs`, and two Python hook libraries. They disagreed on the status-column
 * header, on separator rows, on escaped pipes, on fenced code, on a cell holding two glyphs, and
 * on whether `⊘` meant "closed" or "killed". A ✓ row that quoted `⊘` in its text was refused by
 * one reader and accepted by another on the same day. Two parsers drift silently, because both
 * still return rows; one parser cannot disagree with itself.
 *
 * Pure: no I/O, no dependencies. `validate-plan-rows.mjs` runs the rules over files; the
 * `Plan:` footer check in `validate-pr-body.mjs` reads `planRowStates`. The grammar it encodes
 * is written down in `conventions/plan-rows.md` upstream.
 */

/**
 * The status glyphs a plan row may carry — the one vocabulary.
 *
 * `lifecycle` is what a caller reducing to "finished or not" reads: `open` rows still owe work,
 * `terminal` rows are settled. `stamp` names the stamp rule that makes the row re-checkable
 * (`null` for ✓, whose evidence is the artifact it names, checked by a consumer's own gate).
 */
export const STATUS_GLYPHS = Object.freeze([
  Object.freeze({
    glyph: "☐",
    name: "open",
    lifecycle: "open",
    stamp: "open",
    asserts: "measured and still open; names what would close it",
  }),
  Object.freeze({
    glyph: "⚠",
    name: "premise-falsified",
    lifecycle: "open",
    stamp: "warning",
    asserts:
      "still open, but the row's premise was falsified and it needs rewriting",
  }),
  Object.freeze({
    glyph: "✓",
    name: "done",
    lifecycle: "terminal",
    stamp: null,
    asserts: "done; the artifact it names is in the repository",
  }),
  Object.freeze({
    glyph: "⊘",
    name: "closed-no-change",
    lifecycle: "terminal",
    stamp: "closed",
    asserts: "investigated and settled, and no change was required",
  }),
  Object.freeze({
    glyph: "✗",
    name: "killed",
    lifecycle: "terminal",
    stamp: "killed",
    asserts: "judged not worth its cost; names what would revive it",
  }),
]);

const GLYPH_INFO = new Map(STATUS_GLYPHS.map((entry) => [entry.glyph, entry]));

/** The vocabulary entry for one character, or `undefined` when it is not a status glyph. */
export function glyphInfo(character) {
  return GLYPH_INFO.get(character);
}

/** The plan `status:` vocabulary (`conventions/plan-frontmatter.md`) — exactly four. */
export const STATUSES = Object.freeze([
  "active",
  "backlog",
  "done",
  "reference",
]);

/**
 * Plan statuses that are not final, as the `Plan:` footer check reads them. Wider than the
 * vocabulary on purpose: a value outside it (`draft`, `proposal`…) is still unfinished there.
 */
export const NON_FINAL_STATUSES = new Set([
  "active",
  "backlog",
  "proposal",
  "draft",
  "loaded",
  "reserved",
]);

/** A companion document beside a plan; exempt from every row rule whatever its `status:`. */
export const NOTES_SUFFIX = "-implementation-notes.md";

/**
 * Stamp matchers. Each is matched against the whole row, because a stamp may sit in any cell.
 * Both halves of every stamp are required: a date alone cannot say what would change the row,
 * and a reason alone cannot be aged.
 */
export const STAMPS = Object.freeze({
  /** ☐ and ⚠: `(as of YYYY-MM-DD · flips when <observation>)`. */
  open: /as of (\d{4}-\d{2}-\d{2})\s*[·|-]\s*flips when\s+\S/,
  warning: /as of (\d{4}-\d{2}-\d{2})\s*[·|-]\s*flips when\s+\S/,
  /** ⊘: `(verified YYYY-MM-DD · <reason>)`. */
  closed: /verified (\d{4}-\d{2}-\d{2})\s*[·|-]\s*\S/,
  /** ✗: `KILLED (YYYY-MM-DD · <reason> · revives if <observation>)`. */
  killed:
    /KILLED\s*\(?\s*(\d{4}-\d{2}-\d{2})\s*[·|-]\s*\S.*?[·|-]\s*revives[ -]if\s+\S/,
});

/** The stamp grammar per stamp kind, as a reader writes it. */
export const STAMP_GRAMMAR = Object.freeze({
  open: "(as of YYYY-MM-DD · flips when <observation>)",
  warning: "(as of YYYY-MM-DD · flips when <observation>)",
  closed: "(verified YYYY-MM-DD · <reason>)",
  killed: "✗ KILLED (YYYY-MM-DD · <reason> · revives if <observation>)",
});

/** Does `row` (the whole line) carry the stamp its glyph requires? `true` when none is required. */
export function hasStamp(glyph, row) {
  const kind = glyphInfo(glyph)?.stamp;
  if (!kind) return true;
  return STAMPS[kind].test(row);
}

/** The header cell that names the status column: `St` or `Status`, nothing else (R19). */
const STATUS_HEADER = /^(?:st|status)$/i;

/**
 * Split a markdown table row into trimmed cells, honouring `\|` escapes.
 *
 * Plan prose puts shell pipelines inside cells (`rg … \| grep -c`); splitting on those would
 * shift every later column, and the status column with them.
 */
export function cellsOf(line) {
  const trimmed = line.trim();
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const body =
    inner.endsWith("|") && !inner.endsWith("\\|") ? inner.slice(0, -1) : inner;
  return body.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

/** A separator row: every cell is three or more dashes, optionally colon-aligned. */
export function isSeparatorRow(line) {
  const cells = cellsOf(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

/** Per line: is it inside a ``` fence (delimiter lines included)? */
export function fencedLineMask(lines) {
  const fenced = new Array(lines.length).fill(false);
  let inFence = false;
  for (const [index, line] of lines.entries()) {
    if (/^\s*```/.test(line)) {
      fenced[index] = true;
      inFence = !inFence;
      continue;
    }
    fenced[index] = inFence;
  }
  return fenced;
}

function isTableLine(line) {
  return line.trim().startsWith("|");
}

/** The first character of a cell, by code point (R20: a cell is read by its first character). */
function firstCharacter(text) {
  const [first] = text.trim();
  return first ?? "";
}

/** The first vocabulary glyph anywhere in `text`, or `""`. */
function firstGlyphIn(text) {
  for (const character of text) {
    if (GLYPH_INFO.has(character)) return character;
  }
  return "";
}

function rowIdOf(cells) {
  return (cells[0] ?? "").replace(/[*`]/g, "").trim();
}

/**
 * Every table row of a plan, outside fenced code.
 *
 * A row in a table whose header names a `St`/`Status` column carries `status` = the FIRST
 * character of that cell (`statusFromHeader: true`), whatever else the cell quotes. A row in a
 * table with no status column — or with no header at all — falls back to the first vocabulary
 * glyph anywhere in the row (`statusFromHeader: false`), so an open row in an unusual table is
 * still seen rather than silently skipped. Header and separator lines are not rows.
 *
 * @param {string} content
 * @returns {{ line: number, rowId: string, status: string, cell: string, tableIndex: number,
 *   statusFromHeader: boolean, text: string }[]}
 */
export function parsePlanTables(content) {
  const lines = content.split("\n");
  const fenced = fencedLineMask(lines);
  const rows = [];
  let tableIndex = -1;
  let column;
  let inBlock = false;

  for (const [index, line] of lines.entries()) {
    if (fenced[index] || !isTableLine(line)) {
      inBlock = false;
      column = undefined;
      continue;
    }
    if (!inBlock) {
      inBlock = true;
      tableIndex += 1;
    }
    if (isSeparatorRow(line)) continue;

    const next = lines[index + 1];
    if (
      next !== undefined &&
      !fenced[index + 1] &&
      isTableLine(next) &&
      isSeparatorRow(next)
    ) {
      // A header opens a table, including a second table sharing this block.
      if (rows.some((row) => row.tableIndex === tableIndex)) tableIndex += 1;
      const found = cellsOf(line).findIndex((cell) => STATUS_HEADER.test(cell));
      column = found === -1 ? undefined : found;
      continue;
    }

    const cells = cellsOf(line);
    const fromHeader = column !== undefined;
    const cell = fromHeader ? (cells[column] ?? "") : "";
    rows.push({
      line: index + 1,
      rowId: rowIdOf(cells),
      status: fromHeader ? firstCharacter(cell) : firstGlyphIn(line),
      cell,
      tableIndex,
      statusFromHeader: fromHeader,
      text: line,
    });
  }

  return rows;
}

/**
 * Maximal runs of consecutive table lines (outside fences) that do not open with a header +
 * separator pair. Every row in such a run is invisible to a header-keyed reader.
 *
 * A run that opens on a separator (a table missing its header outright) is a different defect
 * and is not reported here.
 *
 * @returns {{ line: number, rowId: string }[]}
 */
export function orphanTableBlocks(content) {
  const lines = content.split("\n");
  const fenced = fencedLineMask(lines);
  const orphans = [];
  let index = 0;
  while (index < lines.length) {
    if (fenced[index] || !isTableLine(lines[index])) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < lines.length && !fenced[index] && isTableLine(lines[index]))
      index += 1;
    const first = lines[start];
    if (isSeparatorRow(first)) continue;
    const second = index - start > 1 ? lines[start + 1] : undefined;
    if (second !== undefined && isSeparatorRow(second)) continue;
    orphans.push({
      line: start + 1,
      rowId: rowIdOf(cellsOf(first)) || "(no id cell)",
    });
  }
  return orphans;
}

/**
 * The frontmatter block's scalar fields, without a YAML dependency: the `key: value` subset
 * plans use. Quotes around a value are dropped. `null` when the file opens no terminated block.
 *
 * @returns {Record<string, string> | null}
 */
export function readFrontmatter(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end === -1) return null;
  const fields = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(line);
    if (match) fields[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return fields;
}

/**
 * Every gradable plan row, as `{ id, state, line }`, where `state` is `open`, `terminal`, or
 * `unmarked`. `unmarked` counts as unfinished wherever a caller reduces to a boolean — a row
 * nobody has spoken for cannot certify that a plan is complete.
 *
 * A row is skipped when its table declares no status column, when its first cell is empty (an id
 * is what lets the same row be recognised on both sides of a diff), or when it sits inside a
 * fenced code block. The state is read from the status cell's first character.
 *
 * @param {string} content
 * @returns {{ id: string, state: 'open' | 'terminal' | 'unmarked', line: number }[]}
 */
export function planRowStates(content) {
  return parsePlanTables(content)
    .filter((row) => row.statusFromHeader && row.rowId)
    .map((row) => ({
      id: row.rowId,
      state: glyphInfo(row.status)?.lifecycle ?? "unmarked",
      line: row.line,
    }));
}

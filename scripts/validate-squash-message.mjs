#!/usr/bin/env node
/**
 * Checks that the commit a squash merge writes for this pull request is one release-please can
 * read, and so one the next release will contain.
 *
 * WHY THIS EXISTS. Release Please reads every commit on the default branch with
 * `@conventional-commits/parser` and drops any commit the parser rejects: no changelog line, no
 * version bump, no BREAKING CHANGE note, and the only trace is a debug-level log line. Measured
 * 2026-10-19 in claude-prompts-mcp: #501 (a `refactor!:` breaking change) and #503 merged with
 * bodies that passed every PR Conventions check and were both left out of the release, and the
 * release PR went stale and conflicting. The bodies were fine as written. The squash commits were
 * not: GitHub re-flows the PR body at 72 columns when it writes the squash message, and that
 * left a Demonstration example, `resource_manager(resource_type:"gate", action:"create", …,`, at
 * the start of a line whose parenthesis closed on the next one. The parser reads a line that
 * starts `word(` as a footer token with a scope, and throws when the scope does not close on the
 * same line. Parsing the body as written passes both PRs; only the message GitHub writes fails,
 * so this check rebuilds that message rather than reading the body.
 *
 * WHAT IT REPRODUCES, stated exactly:
 *   · the squash message GitHub writes under the contract's merge settings (title PR_TITLE, body
 *     PR_BODY): `<title> (#<number>)`, a blank line, then the body with every line longer than 72
 *     characters outside a fenced block re-flowed at 72, runs of spaces collapsing to one.
 *     Measured 2026-10-19 against 40 merged claude-prompts-mcp squash commits: byte-identical on
 *     38. The other two were a release PR whose body release-please rewrote after the merge, and
 *     a squash that gained a `Co-authored-by:` trailer, which cannot change the verdict because a
 *     trailer token carries no parenthesis. Inferred, not measured, because no sampled body had
 *     one: a re-flowed line also loses its leading indentation.
 *   · release-please's reading of that message (release-please 17.6.0, the version
 *     googleapis/release-please-action v5.0.0 bundles): a `BEGIN_COMMIT_OVERRIDE` …
 *     `END_COMMIT_OVERRIDE` block anywhere in the PR body replaces the whole message; the message
 *     splits into one entry per `BEGIN_NESTED_COMMIT` block and per paragraph that opens with a
 *     conventional type; each entry is parsed on its own, and each one that throws is dropped.
 *   · the parser itself: `@conventional-commits/parser` 0.4.1, vendored as
 *     scripts/vendor/conventional-commits-parser.cjs (its header records the provenance).
 *   FAIL when any entry fails to parse. The report names the squash-message line, the PR-body
 *   line it came from, the parser's message, and the fixes.
 *   CRLF line endings are read as LF; the parser treats both as one newline, so they cannot
 *   change the verdict, only the line numbers a reader would have to translate.
 *
 * ZERO DEPENDENCIES BEYOND THE VENDORED PARSER, like validate-pr-body.mjs: the workflow runs it
 * before any install. A missing or unloadable parser is a FAILURE that names the remedy, never a
 * skip. A squash message nobody parsed is the hole this file exists to close.
 *
 * Usage:
 *   node scripts/validate-squash-message.mjs --body-file <path> --title "<pr title>" [--pr-number <n>]
 *   PR_BODY="..." PR_TITLE="..." PR_NUMBER="..." node scripts/validate-squash-message.mjs
 *   node scripts/validate-squash-message.mjs --self-test
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** GitHub's re-flow width for the squash body, measured (see header). */
export const SQUASH_WRAP_COLUMNS = 72;
export const VENDORED_PARSER = fileURLToPath(
  new URL("./vendor/conventional-commits-parser.cjs", import.meta.url),
);
export const OVERRIDE_BEGIN = "BEGIN_COMMIT_OVERRIDE";
export const OVERRIDE_END = "END_COMMIT_OVERRIDE";
/** release-please's README section on the override block, at the version this file reproduces. */
const OVERRIDE_DOCS =
  "https://github.com/googleapis/release-please/tree/v17.6.0#how-can-i-fix-release-notes";
const NESTED_BEGIN = "BEGIN_NESTED_COMMIT";
const NESTED_END = "END_NESTED_COMMIT";
/** release-please 17.6.0 `splitMessages`: a paragraph opening with one of these starts an entry. */
const ENTRY_BOUNDARY =
  /\r?\n\r?\n(?=(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\(.*?\))?: )/;

/**
 * Loads the vendored parser, or throws an error that names the missing file and the remedy. The
 * caller reports it as a failure: an unchecked squash message must never read as a passing one.
 */
export function loadParser(parserPath = VENDORED_PARSER) {
  const shown = path.join("scripts", "vendor", path.basename(parserPath));
  if (!existsSync(parserPath)) {
    throw new Error(
      `the vendored parser ${shown} is missing, so the squash message was NOT checked. ` +
        "Restore it with `delivery-contract update`.",
    );
  }
  const { parser } = createRequire(import.meta.url)(parserPath);
  if (typeof parser !== "function") {
    throw new Error(
      `${shown} does not export a parser, so the squash message was NOT checked. ` +
        "Restore it with `delivery-contract update`.",
    );
  }
  return parser;
}

const normalizeNewlines = (text) => (text ?? "").replace(/\r\n?/g, "\n");

/** Characters, not UTF-16 units, so an emoji counts once. */
const columns = (text) => [...text].length;

function reflow(line) {
  if (columns(line) <= SQUASH_WRAP_COLUMNS) return [line];
  const out = [];
  let current = null;
  for (const word of line.trim().split(/ +/)) {
    if (current === null) {
      current = word;
    } else if (columns(`${current} ${word}`) <= SQUASH_WRAP_COLUMNS) {
      current = `${current} ${word}`;
    } else {
      out.push(current);
      current = word;
    }
  }
  if (current !== null) out.push(current);
  return out;
}

/**
 * The squash message GitHub writes for this pull request, one entry per line, each carrying the
 * 1-based PR-body line it came from (`null` for the title and the blank line after it).
 */
export function squashMessage({ title, body, prNumber }) {
  const header = normalizeNewlines(title).trim();
  const lines = [
    { text: prNumber ? `${header} (#${prNumber})` : header, bodyLine: null },
  ];
  const bodyLines = normalizeNewlines(body).split("\n");
  const first = bodyLines.findIndex((line) => line.trim() !== "");
  if (first === -1) return lines;
  let last = bodyLines.length - 1;
  while (bodyLines[last].trim() === "") last -= 1;

  lines.push({ text: "", bodyLine: null });
  let fenceMarker = null;
  for (let index = first; index <= last; index += 1) {
    const line = bodyLines[index];
    const opener = /^\s*(```|~~~)/.exec(line);
    let pieces;
    if (fenceMarker === null && opener) {
      fenceMarker = opener[1];
      pieces = [line];
    } else if (fenceMarker !== null) {
      if (opener && opener[1] === fenceMarker) fenceMarker = null;
      pieces = [line];
    } else {
      pieces = reflow(line);
    }
    for (const text of pieces) lines.push({ text, bodyLine: index + 1 });
  }
  return lines;
}

/**
 * release-please's `preprocessCommitMessage`: the text between the first `BEGIN_COMMIT_OVERRIDE`
 * and the next `END_COMMIT_OVERRIDE`, trimmed; `null` when that is empty, in which case the squash
 * message stands. Each line carries its 1-based PR-body line.
 */
export function commitOverride(body) {
  const text = normalizeNewlines(body);
  const begin = text.indexOf(OVERRIDE_BEGIN);
  if (begin === -1) return null;
  const after = text.slice(begin + OVERRIDE_BEGIN.length);
  const override = after.split(OVERRIDE_END)[0].trim();
  if (override === "") return null;
  const start =
    begin + OVERRIDE_BEGIN.length + (after.length - after.trimStart().length);
  const firstBodyLine = text.slice(0, start).split("\n").length;
  return override
    .split("\n")
    .map((line, offset) => ({ text: line, bodyLine: firstBodyLine + offset }));
}

/**
 * release-please's `splitMessages`: nested-commit blocks become their own entries, and the rest
 * splits before each paragraph that opens with a conventional type. Each entry records whether it
 * is `nested`, because nested entries come last but sit earlier in the message.
 */
export function releasePleaseEntries(message) {
  const parts = message.split(NESTED_BEGIN);
  let main = parts.shift();
  const nested = [];
  for (const part of parts) {
    const [inner, ...rest] = part.split(NESTED_END);
    nested.push(inner);
    main += rest.join(NESTED_END);
  }
  return [
    ...main
      .split(ENTRY_BOUNDARY)
      .filter(Boolean)
      .map((text) => ({ text, nested: false })),
    ...nested.map((text) => ({ text, nested: true })),
  ];
}

/**
 * Index into `lines` of `entry`'s first content line, searching from `from`; -1 when the entry
 * does not appear verbatim (a main entry that straddled a removed nested block).
 */
function entryStart(lines, entry, from) {
  const firstContent = entry.text.trim().split("\n")[0];
  for (let index = from; index < lines.length; index += 1) {
    if (lines[index].text.endsWith(firstContent)) return index;
  }
  return -1;
}

/** The parser's position (`at <line>:<column>`), relative to the trimmed entry it was given. */
function errorLine(error) {
  const match = /at (\d+):(\d+)/.exec(error.message);
  return match ? Number(match[1]) : null;
}

function judgeEntry(parse, lines, entry, start) {
  const header = entry.text.trim().split("\n")[0];
  try {
    parse(entry.text);
    return { header, ok: true };
  } catch (error) {
    const relative = errorLine(error);
    const entryLines = entry.text.trim().split("\n");
    const text = relative === null ? null : (entryLines[relative - 1] ?? null);
    const index = start === -1 || relative === null ? -1 : start + relative - 1;
    const located = index >= 0 && lines[index]?.text.endsWith(text ?? "");
    return {
      header,
      ok: false,
      parserMessage: error.message,
      text,
      messageLine: located ? index + 1 : null,
      bodyLine: located ? lines[index].bodyLine : null,
    };
  }
}

/**
 * The verdict for one pull request: what release-please reads (`source` is `override` or
 * `squash`), the message it reads, and one result per entry it splits that message into.
 * `options.parse` replaces the vendored parser in tests.
 */
export function checkSquashMessage({ title, body, prNumber }, options = {}) {
  const parse = options.parse ?? loadParser();
  const override = commitOverride(body);
  const lines = override ?? squashMessage({ title, body, prNumber });
  const message = lines.map((line) => line.text).join("\n");
  let cursor = 0;
  const entries = releasePleaseEntries(message).map((entry) => {
    const start = entryStart(lines, entry, entry.nested ? 0 : cursor);
    if (!entry.nested && start !== -1) cursor = start + 1;
    return judgeEntry(parse, lines, entry, start);
  });
  return {
    source: override ? "override" : "squash",
    message,
    entries,
    failures: entries.filter((entry) => !entry.ok),
  };
}

// ---------------------------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------------------------

const printable = (text) =>
  text.replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");

function whereLine(failure, source) {
  if (failure.messageLine === null) {
    return `in the entry release-please reads as \`${failure.header}\``;
  }
  if (source === "override") {
    return `line ${failure.messageLine} of the override block, PR body line ${failure.bodyLine}`;
  }
  if (failure.bodyLine === null) {
    return `squash message line ${failure.messageLine}, the PR title`;
  }
  return `squash message line ${failure.messageLine}, from PR body line ${failure.bodyLine}`;
}

/**
 * A marker as this script prints it: split before `OVERRIDE`, never whole. release-please finds
 * the block with `body.split(marker)`, an exact match anywhere in the PR body, backticks and code
 * fences included, and the PR template asks for pasted transcripts. A whole marker printed here
 * would open an override block in any body this output is pasted into. The reader joins the halves.
 */
const splitMarker = (marker) => marker.replace(/OVERRIDE$/, " + OVERRIDE");

const SQUASH_FIXES = [
  "Fix it in the PR body, any one of:",
  "  · put an example call on ONE line inside a fenced code block (```). GitHub re-flows the",
  `    squash body at ${SQUASH_WRAP_COLUMNS} columns everywhere except inside fences, and a line that starts`,
  "    `name(` without closing the parenthesis on that same line is what the parser refuses.",
  "    A call split over several lines fails inside a fence too.",
  "  · reword the paragraph so that no line of the squash message starts with `name(` left open.",
  "  · add a block release-please reads INSTEAD of the whole squash message. Its two markers are",
  '    printed split so this advice stays inert if pasted: write each as one word, without " + ".',
  `      ${splitMarker(OVERRIDE_BEGIN)}`,
  "      <the commit as release-please should read it, e.g. the PR title>",
  `      ${splitMarker(OVERRIDE_END)}`,
  `    release-please documents the block at ${OVERRIDE_DOCS}`,
];
const OVERRIDE_FIXES = [
  "Fix the text between the two commit-override markers: release-please reads it instead of the",
  "squash message, so its first line must be a conventional commit header (the PR title is one),",
  "and no later line may start with `name(` left open. Any mention of the begin marker opens a",
  "block, inside backticks or a code fence too: release-please splits on the bare word.",
  `The block is documented at ${OVERRIDE_DOCS}`,
];

/** Lines to print for a verdict; the first failure line carries `::error::` under Actions. */
export function formatVerdict(verdict, { ci = false } = {}) {
  const what =
    verdict.source === "override"
      ? "the commit-override block in the PR body"
      : "the squash commit this pull request merges as";
  if (verdict.failures.length === 0) {
    const count = verdict.entries.length;
    return [
      `squash commit: release-please can parse ${what}; it reads ${count} ` +
        `${count === 1 ? "entry" : "entries"}: ${verdict.entries
          .map((entry) => `\`${entry.header}\``)
          .join(", ")}.`,
    ];
  }
  const out = [];
  const lead =
    `release-please cannot parse ${what}, so the release would leave it out: ` +
    "no changelog line, no version bump, no BREAKING CHANGE note.";
  out.push(ci ? `::error::${lead}` : `error: ${lead}`);
  for (const failure of verdict.failures) {
    out.push(`  ${whereLine(failure, verdict.source)}:`);
    if (failure.text !== null) out.push(`    ${failure.text}`);
    out.push(`  parser: ${printable(failure.parserMessage)}`);
  }
  out.push(...(verdict.source === "override" ? OVERRIDE_FIXES : SQUASH_FIXES));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Self-test: the check can fail, and can pass
// ---------------------------------------------------------------------------------------------

/**
 * The #501 Demonstration line: valid as written, unparseable once GitHub re-flows it. Exported for
 * pr-check.mjs's self-test, which needs a body that passes every rule but this one.
 */
export const REFLOWED_CALL =
  '`resource_manager(resource_type:"gate", action:"create", …, retry_config:{improvement_hints: 5})`, from a live server run:';

function selfTest() {
  const title = "fix(scope): a call example survives the squash";
  const demonstration = (lines) =>
    ["## Demonstration", "", ...lines, "", "## Notes", "", "None."].join("\n");
  const refused = (expectedBodyLine) => (verdict) =>
    verdict.failures.length === 1 &&
    verdict.failures[0].bodyLine === expectedBodyLine &&
    verdict.failures[0].text?.startsWith("`resource_manager(");
  const parses = (verdict) => verdict.failures.length === 0;

  const cases = [
    {
      name: "a call re-flowed across two lines is refused, naming its body line",
      body: demonstration([REFLOWED_CALL]),
      expect: refused(3),
    },
    {
      name: "the same call on one line inside a fence parses",
      body: demonstration([
        "From a live server run:",
        "",
        "```",
        REFLOWED_CALL.slice(1, REFLOWED_CALL.indexOf("`,")),
        "```",
      ]),
      expect: parses,
    },
    {
      name: "a CRLF body is judged as its LF twin",
      body: demonstration([REFLOWED_CALL]).replace(/\n/g, "\r\n"),
      expect: refused(3),
    },
    {
      name: "a commit-override block that parses replaces an unparseable message",
      body: `${demonstration([REFLOWED_CALL])}\n\n${OVERRIDE_BEGIN}\n${title}\n${OVERRIDE_END}\n`,
      expect: (verdict) => verdict.source === "override" && parses(verdict),
    },
    {
      name: "a commit-override block that does not parse is refused",
      body: `## Summary\n\nx\n\n${OVERRIDE_BEGIN}\nnot a conventional header\n${OVERRIDE_END}\n`,
      expect: (verdict) =>
        verdict.source === "override" &&
        verdict.failures.length === 1 &&
        verdict.failures[0].bodyLine === 6,
    },
  ];

  let parse;
  try {
    parse = loadParser();
  } catch (error) {
    console.log(`FAIL  the vendored parser loads — ${error.message}`);
    return false;
  }
  console.log("PASS  the vendored parser loads");

  let failed = 0;
  for (const testCase of cases) {
    const verdict = checkSquashMessage(
      { title, body: testCase.body, prNumber: 1 },
      { parse },
    );
    const ok = testCase.expect(verdict);
    console.log(`${ok ? "PASS" : "FAIL"}  ${testCase.name}`);
    if (!ok) {
      failed += 1;
      console.log(`      ${JSON.stringify(verdict.failures)}`);
    }
  }
  return failed === 0;
}

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main() {
  if (process.argv.includes("--self-test")) {
    process.exit(selfTest() ? 0 : 1);
  }
  const bodyFile = readArg("--body-file");
  const body = bodyFile
    ? readFileSync(bodyFile, "utf8")
    : (process.env.PR_BODY ?? "");
  const title = readArg("--title") ?? process.env.PR_TITLE ?? "";
  const prNumber = readArg("--pr-number") ?? process.env.PR_NUMBER ?? "";
  const ci = process.env.GITHUB_ACTIONS === "true";

  if (title.trim() === "") {
    console.error(
      'usage: node scripts/validate-squash-message.mjs --body-file <path> --title "<pr title>" [--pr-number <n>]\n' +
        "The title is the first line of the squash commit, so the message cannot be built without it.",
    );
    process.exit(2);
  }

  let verdict;
  try {
    verdict = checkSquashMessage({ title, body, prNumber });
  } catch (error) {
    console.log(ci ? `::error::${error.message}` : `error: ${error.message}`);
    process.exit(1);
  }
  for (const line of formatVerdict(verdict, { ci })) console.log(line);
  process.exit(verdict.failures.length === 0 ? 0 : 1);
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  main();
}

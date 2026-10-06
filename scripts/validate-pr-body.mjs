#!/usr/bin/env node
/**
 * Checks that a pull-request body was written FOR A READER, not just written.
 *
 * WHY THIS EXISTS. The template has been enforced since #250 (2026-08-28): three sections must
 * exist and be non-empty. Both #254 and #255 complied, and both were still unreadable at a glance —
 * 651 and 866 words, Summary bullets packing four facts each in plan-internal vocabulary, a
 * verification section that was a wall of test counts with no baseline, and no demonstration of a
 * feature that shipped a state machine. Presence is not the property; the property is that a
 * reader who was not in the session can see what changed. This script measures the parts of that
 * a machine can measure, and no more.
 *
 * WHAT IT MEASURES, stated exactly:
 *   FAIL  · `Summary`, `How it was verified`, `Notes for Reviewers` exist and are non-empty once
 *           HTML comments are stripped (unchanged from the workflow's inline check it replaces).
 *   FAIL  · `Demonstration` exists and is non-empty when the title's conventional-commit type is
 *           feat / fix / perf / refactor. `n/a: <reason>` satisfies it — the point is that the
 *           author DECIDED, not that every PR carries a diagram.
 *   FAIL  · a `___` placeholder survives outside HTML comments — the `pr:body` skeleton seeds
 *           them, so a surviving one means the body was generated and never edited. Without this
 *           rule the generator+gate pair would MINT a new theatre path: a body that passes while
 *           saying nothing (ruled 2026-09-02, blind-spot pass).
 *   FAIL  · a row of the verification table has every cell after the first empty — the skeleton's
 *           unfilled shape, same reasoning as the placeholder rule.
 *   FAIL  · a `Plan:` footer names a plan whose frontmatter `status:` is still non-final
 *           (active / backlog / proposal / draft / loaded / reserved), or names a file that does
 *           not exist at this checkout. Ruled 2026-09-02: the footer is a CONTRACT, not a
 *           pointer — a PR carrying a plan does not merge until that plan is finalized in it.
 *           The footer is also the ONLY sanctioned plan mention; row ids and plan vocabulary in
 *           the body are the session voice this whole file exists to keep out.
 *   OK    · a `Plan:` footer alone is complete: it is the join key. The initiative slug is a pure
 *           function of the plan path, so a reader assembles a multi-PR initiative's history with
 *           `git log --grep='Plan: .*<slug>'`. An `Initiative:` trailer left in an older body is
 *           ignored, never an error (the trailer was retired 2026-10-06).
 *   FAIL  · a `Decision:` trailer naming an ADR number with no `<adrDir>/<NNNN>-*.md` file at this
 *           checkout — the trailer asserts a decision exists; this checks that assertion the same
 *           way the `Plan:` footer's existence check does.
 *   WARN  · above-the-fold text over WORD_BUDGET words. Fenced blocks, tables, and everything
 *           inside `<details>` are NOT counted: the body is a two-register document (reader voice
 *           above the fold, collapsed archive appendix below), and the budget bounds only the
 *           part a reader must traverse. The first version counted transcripts and warned
 *           hardest on the most compliant PRs — the advisory-rot path.
 *   WARN  · `How it was verified` carries no table and no fenced block.
 *
 * It does NOT judge prose quality, and it does not read the title beyond its type — the title is
 * commitlint's job (the workflow runs commitlint on it with the repo's own config, so the two
 * cannot drift).
 *
 * ZERO DEPENDENCIES, ON PURPOSE, AND SELF-CONTAINED. The workflow runs this before any install so
 * it works on the docs route, and this file has zero imports outside `node:` built-ins — including
 * the plan-row lifecycle primitive (`planRowStates`), which is defined and exported here rather
 * than imported from a sibling repository, so a consumer of this template never reaches outside
 * its own tree. `scripts/pr-body.mjs` imports `checkBody` (and, transitively, `planRowStates`) from
 * this one file, so the generator and the gate share one definition of "ready".
 *
 * Usage:
 *   node scripts/validate-pr-body.mjs --body-file <path> --title "<pr title>"
 *   PR_BODY="..." PR_TITLE="..." node scripts/validate-pr-body.mjs
 *   node scripts/validate-pr-body.mjs --self-test
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Fallback required-section names, used only when this checkout has no
 * `.github/pull_request_template.md` to derive them from (see `deriveRequiredSections` below).
 * Kept exported and unchanged for any consumer still relying on the constant directly.
 */
export const REQUIRED_SECTIONS = [
  "Summary",
  "How it was verified",
  "Notes for Reviewers",
];
export const DEMONSTRATION_SECTION = "Demonstration";
export const STILL_OPEN_SECTION = "Still open";
export const DEMONSTRATION_TYPES = new Set(["feat", "fix", "perf", "refactor"]);
export const WORD_BUDGET = 400;
/** Non-final plan statuses; anything else (reference, done, complete, closed…) is final. */
export const NON_FINAL_STATUSES = new Set([
  "active",
  "backlog",
  "proposal",
  "draft",
  "loaded",
  "reserved",
]);
/** Default ADR directory when `.delivery-contract.json` is absent or names none. */
export const DEFAULT_ADR_DIR = "docs/adr";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// ---------------------------------------------------------------------------------------------
// Plan row lifecycle primitive. This template is the ONE definition of "what counts as a row" and
// "what counts as closed". A consumer's own plan-row gate that reads the same tables must agree
// with it rather than carry a second parser. It is not imported across repositories because the
// managed copy is what ships: every consumer receives this file byte-identical.
// ---------------------------------------------------------------------------------------------

/** Rows are markdown table rows; ✓ may sit in any cell, usually the status column. */
const DONE_MARK = "✓";
/** The unmarked status. An open row asserts nothing yet. */
const OPEN_MARK = "☐";
/** Closed, no change required — settled but produced no edit. */
const CLOSED_MARK = "⊘";
/** Killed — judged not worth its cost. */
const KILLED_MARK = "✗";
const TERMINAL_MARKS = [DONE_MARK, CLOSED_MARK, KILLED_MARK];

function cellsOf(line) {
  const trimmed = line.trim();
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const body =
    inner.endsWith("|") && !inner.endsWith("\\|") ? inner.slice(0, -1) : inner;
  return body.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

/** A markdown separator row: `| --- | :--: |`. */
function isSeparatorRow(line) {
  const cells = cellsOf(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

/** Line indices inside a fenced code block (``` ... ```), delimiter lines included. */
function fencedLineMask(lines) {
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

/** The header cell that names the status column. `St` is this repo's convention; `Status` is spelled out elsewhere. */
const STATUS_HEADER = /^(?:st|status)$/i;

/** For every line index, the status-column index of the table it belongs to. */
function statusColumnByLine(lines) {
  const byLine = new Array(lines.length).fill(undefined);
  const fenced = fencedLineMask(lines);
  let current;

  for (const [index, line] of lines.entries()) {
    if (fenced[index]) continue;
    if (!line.trim().startsWith("|")) {
      current = undefined;
      continue;
    }
    if (isSeparatorRow(line)) continue;

    const next = lines[index + 1];
    const isHeader =
      next !== undefined && next.trim().startsWith("|") && isSeparatorRow(next);
    if (isHeader) {
      const found = cellsOf(line).findIndex((cell) => STATUS_HEADER.test(cell));
      current = found === -1 ? undefined : found;
      continue;
    }
    byLine[index] = current;
  }

  return byLine;
}

/** The text a status mark must appear in for the row to count as carrying it. */
function statusTextOf(line, column) {
  if (column === undefined) return line;
  return cellsOf(line)[column] ?? "";
}

/**
 * Every gradable plan row, as `{ id, state, line }`, where `state` is `open`, `terminal`, or
 * `unmarked`. `unmarked` counts as unfinished wherever a caller reduces to a boolean — a row
 * nobody has spoken for cannot certify that a plan is complete.
 *
 * A row is skipped when its table declares no status column, when its first cell is empty (an id
 * is what lets the same row be recognised on both sides of a diff), or when it sits inside a
 * fenced code block.
 *
 * @param {string} content
 * @returns {{ id: string, state: 'open' | 'terminal' | 'unmarked', line: number }[]}
 */
export function planRowStates(content) {
  const lines = content.split("\n");
  const statusColumn = statusColumnByLine(lines);
  const rows = [];

  for (const [index, line] of lines.entries()) {
    if (!line.trim().startsWith("|")) continue;
    if (isSeparatorRow(line)) continue;

    const column = statusColumn[index];
    if (column === undefined) continue;

    const id = (cellsOf(line)[0] ?? "").replace(/[*`]/g, "").trim();
    if (!id) continue;

    const status = statusTextOf(line, column);
    const state = status.includes(OPEN_MARK)
      ? "open"
      : TERMINAL_MARKS.some((mark) => status.includes(mark))
        ? "terminal"
        : "unmarked";

    rows.push({ id, state, line: index + 1 });
  }

  return rows;
}

// ---------------------------------------------------------------------------------------------
// Body checks
// ---------------------------------------------------------------------------------------------

/** `type(scope)!: subject` → `type`; null when the title is not conventional. */
export function commitType(title) {
  const match = /^([a-z]+)(?:\([^)]*\))?!?:/.exec(title || "");
  return match ? match[1] : null;
}

function stripComments(text) {
  return (text || "").replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Every fenced code block (``` or ~~~) blanked line-by-line, line count preserved. A fenced block
 * is CONTENT, never a trailer: a `## Demonstration` example showing what a `Plan:` footer or a
 * `Decision:` trailer looks like must not be read as one.
 */
function stripFences(text) {
  const lines = (text || "").split("\n");
  let fenceMarker = null;
  return lines
    .map((line) => {
      const opener = /^\s*(```|~~~)/.exec(line);
      if (fenceMarker === null && opener) {
        fenceMarker = opener[1];
        return "";
      }
      if (fenceMarker !== null) {
        if (opener && opener[1] === fenceMarker) fenceMarker = null;
        return "";
      }
      return line;
    })
    .join("\n");
}

/**
 * Comments, fenced blocks, AND `<details>` archives stripped. Trailers (`Plan:`, `Decision:`) are only real outside all three — the generated skeleton's own comment block
 * mentions the trailer names as guidance, a `## Demonstration` fenced example may show what one
 * looks like, and a collapsed appendix may quote an example body that names one too.
 */
function stripTrailerNoise(text) {
  return stripFences(stripComments(text)).replace(
    /<details>[\s\S]*?<\/details>/gi,
    "",
  );
}

/** Section name → body text, HTML comments stripped so an untouched template reads as empty. */
export function splitSections(body) {
  const sections = {};
  let current = null;
  for (const line of stripComments(body).split("\n")) {
    const heading = /^#{2,3}\s+(.*?)\s*$/.exec(line);
    if (heading) {
      current = heading[1];
      sections[current] = "";
    } else if (current !== null) {
      sections[current] += `${line}\n`;
    }
  }
  return sections;
}

function isEmpty(text) {
  return text === undefined || text.trim().length === 0;
}

/** Reader-facing words only: drop <details> archives, fenced blocks, and table rows. */
function aboveTheFoldWords(body) {
  const visible = stripComments(body)
    .replace(/<details>[\s\S]*?<\/details>/gi, "")
    .replace(/```[\s\S]*?```/g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("|"))
    .join("\n");
  return visible.split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * The `## ` headings declared by `<repoRoot>/.github/pull_request_template.md` (or
 * `templatePath`, for tests), each paired with the text of its own `<!-- -->` guidance block —
 * the same block `pr-body.mjs`'s `fill()` inserts content beneath. `null` when no template file
 * exists at this checkout, which signals the caller to fall back to the historical constants.
 *
 * The template file is the SSOT for what a body must carry (see `pr-body.mjs`'s header comment);
 * this is the validator reading that same SSOT instead of hardcoding a second copy of it.
 */
function readTemplateHeadings(repoRoot, templatePath) {
  const resolved =
    templatePath ?? path.join(repoRoot, ".github", "pull_request_template.md");
  if (!existsSync(resolved)) return null;

  const lines = readFileSync(resolved, "utf8").split("\n");
  const marks = [];
  lines.forEach((line, index) => {
    const match = /^##\s+(.*?)\s*$/.exec(line);
    if (match) marks.push({ name: match[1], index });
  });
  if (marks.length === 0) return null;

  const comments = new Map();
  marks.forEach(({ name, index }, i) => {
    const next = marks[i + 1]?.index ?? lines.length;
    const block = lines.slice(index + 1, next).join("\n");
    comments.set(name, /<!--([\s\S]*?)-->/.exec(block)?.[1] ?? "");
  });

  return { names: marks.map((m) => m.name), comments };
}

/**
 * Required section names for this checkout: every `## ` heading in the template EXCEPT the ones
 * this contract calls optional —
 *   `Demonstration` — required only for certain commit types (checked separately below)
 *   `Still open`    — informational, never gated on non-empty
 *   any heading whose own comment block contains the token `optional` (case-insensitive) — a
 *     fork's template opts a section out by writing that word into its own `<!-- -->` guidance
 *
 * Falls back to `REQUIRED_SECTIONS` when no template exists at this checkout (`templateHeadings`
 * is `null`) — the pre-derivation baseline shared by every consumer before headings became
 * per-repo.
 */
function deriveRequiredSections(templateHeadings) {
  if (templateHeadings === null) return REQUIRED_SECTIONS;
  return templateHeadings.names.filter((name) => {
    if (name === DEMONSTRATION_SECTION || name === STILL_OPEN_SECTION)
      return false;
    return !/optional/i.test(templateHeadings.comments.get(name) ?? "");
  });
}

function checkRequiredSections(sections, failures, requiredSections) {
  for (const name of requiredSections) {
    if (!(name in sections)) failures.push(`missing section \`## ${name}\``);
    else if (isEmpty(sections[name]))
      failures.push(`section \`## ${name}\` is present but empty`);
  }
}

function checkDemonstration(
  sections,
  title,
  failures,
  hasDemonstrationHeading,
) {
  if (!hasDemonstrationHeading) return;
  const type = commitType(title);
  if (type === null || !DEMONSTRATION_TYPES.has(type)) return;
  const section = sections[DEMONSTRATION_SECTION];
  if (section === undefined || isEmpty(section)) {
    failures.push(
      `\`## ${DEMONSTRATION_SECTION}\` is required for a \`${type}\` PR — show the consumer-` +
        "observable delta (transcript, mermaid, before/after table) or write `n/a: <reason>`",
    );
  }
}

function checkPlaceholders(body, failures) {
  if (/___/.test(stripComments(body))) {
    failures.push(
      "a `___` placeholder survives — the generated skeleton was not filled in. Every `___` is a " +
        "sentence the reader needed.",
    );
  }
}

function checkVerificationRows(sections, failures, hasVerifiedHeading) {
  if (!hasVerifiedHeading) return;
  const verified = sections["How it was verified"];
  if (isEmpty(verified)) return;
  for (const line of verified.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || /^\|[\s|:-]+\|$/.test(trimmed)) continue;
    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (
      cells.length >= 2 &&
      !isEmpty(cells[0]) &&
      cells.slice(1).every(isEmpty)
    ) {
      failures.push(
        `verification row \`${cells[0].slice(0, 60)}\` has no probe, baseline, or mutation — an ` +
          "unfilled skeleton row is a claim without evidence",
      );
    }
  }
}

/**
 * The commit this PR forked from, as `{ mergeBase }`, or `{ error }` when no honest comparison is
 * available from this checkout.
 *
 * Merge base rather than the base branch tip: rows closed on `main` after this branch forked are
 * not this PR's progress, and counting them would let a stale branch pass on someone else's work.
 */
function resolveMergeBase(repoRoot) {
  const baseRef = process.env.GITHUB_BASE_REF
    ? `origin/${process.env.GITHUB_BASE_REF}`
    : "origin/HEAD";
  const git = (args) =>
    execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

  if (git(["rev-parse", "--is-shallow-repository"]).trim() === "true") {
    return {
      error:
        "the checkout is shallow, so there is no merge base to compare against",
    };
  }

  let mergeBase;
  try {
    mergeBase = git(["merge-base", baseRef, "HEAD"]).trim();
  } catch {
    return { error: `\`${baseRef}\` is not present in this checkout` };
  }

  if (mergeBase === git(["rev-parse", "HEAD"]).trim()) {
    return {
      error: `\`${baseRef}\` resolves to this branch's own tip, so the comparison would be vacuous`,
    };
  }

  return { mergeBase, git };
}

/** The plan as it stood at the merge base; `{ text: null }` when this PR introduces it. */
function planAtMergeBase(repoRoot, relPath) {
  const resolved = resolveMergeBase(repoRoot);
  if (resolved.error) return { error: resolved.error };
  try {
    return { text: resolved.git(["show", `${resolved.mergeBase}:${relPath}`]) };
  } catch {
    return { text: null };
  }
}

/**
 * A `Plan:` footer asserts that this PR advances the plan it names. This checks that assertion.
 *
 * The guarantee splits into two separately checkable halves, both derived from the diff rather
 * than asserted by the author:
 *
 *   PROGRESS — the PR must move at least one row from ☐ to a terminal mark.
 *   CLOSURE — when no row is left unfinished, the plan must carry a final `status:`.
 *
 * Plans with no gradable ☐ row at the merge base fall back to the original strict rule: the
 * footer's plan must already carry a final `status:`.
 */
function checkPlanFooter(body, failures, repoRoot, readPlanAtMergeBase) {
  const match = /^Plan:\s*`?(plans\/\S+?)`?\s*$/m.exec(stripTrailerNoise(body));
  if (!match) return;
  const relPath = match[1];
  const planPath = path.join(repoRoot, relPath);
  if (!existsSync(planPath)) {
    failures.push(
      `\`Plan:\` footer names \`${relPath}\`, which does not exist at this checkout`,
    );
    return;
  }

  const head = readFileSync(planPath, "utf8");
  const status = /^status:\s*(\S+)/m.exec(head)?.[1]?.toLowerCase();
  if (status === undefined) {
    failures.push(
      `\`Plan:\` footer names \`${relPath}\`, which declares no \`status:\``,
    );
    return;
  }

  const mustFinalize = () =>
    failures.push(
      `\`Plan:\` footer names \`${relPath}\` with status \`${status}\` — a PR carrying a plan ` +
        "merges only once that plan is finalized (retired with every row terminal) in this same PR",
    );

  const rows = planRowStates(head);
  const unfinished = rows.filter((row) => row.state !== "terminal");

  if (rows.length === 0) {
    if (NON_FINAL_STATUSES.has(status)) mustFinalize();
    return;
  }

  if (unfinished.length === 0) {
    if (NON_FINAL_STATUSES.has(status)) {
      failures.push(
        `\`Plan:\` footer names \`${relPath}\`, whose ${rows.length} rows are all terminal while ` +
          `\`status:\` is still \`${status}\` — the PR that closes a plan's last row retires the ` +
          "plan. Set a final `status:` in this PR.",
      );
    }
    return;
  }

  if (!NON_FINAL_STATUSES.has(status)) return;

  const base = readPlanAtMergeBase(relPath);
  if (base.error) {
    failures.push(
      `\`Plan:\` footer names \`${relPath}\`, but the rows this PR closes cannot be measured: ` +
        `${base.error}. The workflow checkout needs full history (\`fetch-depth: 0\`) and a ` +
        "fetched base ref.",
    );
    return;
  }

  if (base.text === null) return;

  const baseState = new Map(
    planRowStates(base.text).map((row) => [row.id, row.state]),
  );
  if (![...baseState.values()].includes("open")) {
    mustFinalize();
    return;
  }

  const closed = rows.filter(
    (row) => row.state === "terminal" && baseState.get(row.id) === "open",
  );
  if (closed.length === 0) {
    failures.push(
      `\`Plan:\` footer names \`${relPath}\` with status \`${status}\` and ${unfinished.length} ` +
        "unfinished row(s), and this PR closes none of them. A plan footer asserts that this PR " +
        "advances that plan — mark the rows it finishes terminal (✓, ✗ or ⊘), or drop the footer.",
    );
  }
}

/** `.delivery-contract.json` → `answers.adrDir`, or `DEFAULT_ADR_DIR` when absent or unset. */
function defaultAdrDir(repoRoot) {
  const answersPath = path.join(repoRoot, ".delivery-contract.json");
  if (!existsSync(answersPath)) return DEFAULT_ADR_DIR;
  try {
    const parsed = JSON.parse(readFileSync(answersPath, "utf8"));
    return parsed?.answers?.adrDir || DEFAULT_ADR_DIR;
  } catch {
    return DEFAULT_ADR_DIR;
  }
}

/**
 * Every `Decision:` trailer names an ADR number; this checks that the ADR file actually exists,
 * the same way the `Plan:` footer's existence check does for a plan.
 */
function checkDecisionTrailer(body, failures, repoRoot, adrDir) {
  const visible = stripTrailerNoise(body);
  const matches = [...visible.matchAll(/^Decision:\s*(ADR-)?(\d{4})\b/gm)];
  if (matches.length === 0) return;

  const dir = path.join(repoRoot, adrDir);
  const files = existsSync(dir) ? readdirSync(dir) : [];
  for (const match of matches) {
    const number = match[2];
    const found = files.some(
      (f) => f.startsWith(`${number}-`) && f.endsWith(".md"),
    );
    if (!found) {
      failures.push(
        `\`Decision: ${match[1] ?? ""}${number}\` names no ADR file under \`${adrDir}\` — ` +
          `expected \`${adrDir}/${number}-*.md\``,
      );
    }
  }
}

function collectWarnings(body, sections) {
  const warnings = [];
  const words = aboveTheFoldWords(body);
  if (words > WORD_BUDGET) {
    warnings.push(
      `above-the-fold text is ${words} words (budget ${WORD_BUDGET}; transcripts, tables and ` +
        "<details> are not counted). Move prose into the collapsed appendix or the implementation-notes.",
    );
  }
  const verified = sections["How it was verified"];
  if (
    !isEmpty(verified) &&
    !/^\s*\|/m.test(verified) &&
    !/```/.test(verified)
  ) {
    warnings.push(
      "`## How it was verified` has no table and no fenced block — the template asks for one row " +
        "per claim (claim · probe · baseline → measured · mutation that fails it).",
    );
  }
  return warnings;
}

/**
 * @returns {{ failures: string[], warnings: string[] }}
 */
export function checkBody(body, title, options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  // Injected so the self-test drives the plan rules off fixtures rather than a real git history,
  // which keeps every rule in this file pure and replayable.
  const readPlanAtMergeBase =
    options.readPlanAtMergeBase ??
    ((relPath) => planAtMergeBase(repoRoot, relPath));
  const adrDir = options.adrDir ?? defaultAdrDir(repoRoot);
  const templateHeadings = readTemplateHeadings(repoRoot, options.templatePath);
  const requiredSections = deriveRequiredSections(templateHeadings);
  const hasDemonstrationHeading =
    templateHeadings === null ||
    templateHeadings.names.includes(DEMONSTRATION_SECTION);
  const hasVerifiedHeading =
    templateHeadings === null ||
    templateHeadings.names.includes("How it was verified");
  const sections = splitSections(body);
  const failures = [];
  checkRequiredSections(sections, failures, requiredSections);
  checkDemonstration(sections, title, failures, hasDemonstrationHeading);
  checkPlaceholders(body, failures);
  checkVerificationRows(sections, failures, hasVerifiedHeading);
  checkPlanFooter(body, failures, repoRoot, readPlanAtMergeBase);
  checkDecisionTrailer(body, failures, repoRoot, adrDir);
  return { failures, warnings: collectWarnings(body, sections) };
}

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** A minimal plan whose table carries the `St` column `planRowStates` grades. */
function fixturePlan(status, rows) {
  const body = rows
    .map(([id, mark]) => `| ${id} | ${mark} | change |`)
    .join("\n");
  return `---\nstatus: ${status}\n---\n\n| Id | St | Change |\n|---|---|---|\n${body}\n`;
}

const OPEN_PAIR = [
  ["R1", "☐"],
  ["R2", "☐"],
];

/**
 * Plan fixtures as `{ [relPath]: [headText, baseText] }`; a `null` base models one that cannot be
 * read.
 *
 * Every plan rule is exercised in BOTH directions — a case where it must fire and a case where it
 * must stay silent — because a rule that only ever fires is indistinguishable from one that always
 * fires.
 */
const PLAN_FIXTURES = {
  // Rowless plans: the original rule, unchanged.
  "plans/active.md": ["---\nstatus: active\n---\n", null],
  "plans/retired.md": ["---\nstatus: reference\n---\n", null],
  // PROGRESS, in each of the three terminal marks.
  "plans/progress.md": [
    fixturePlan("active", [
      ["R1", "✓"],
      ["R2", "☐"],
    ]),
    fixturePlan("active", OPEN_PAIR),
  ],
  "plans/killed.md": [
    fixturePlan("active", [
      ["R1", "✗"],
      ["R2", "☐"],
    ]),
    fixturePlan("active", OPEN_PAIR),
  ],
  "plans/no-change-needed.md": [
    fixturePlan("active", [
      ["R1", "⊘"],
      ["R2", "☐"],
    ]),
    fixturePlan("active", OPEN_PAIR),
  ],
  // PROGRESS, converse: nothing moved.
  "plans/stalled.md": [
    fixturePlan("active", OPEN_PAIR),
    fixturePlan("active", OPEN_PAIR),
  ],
  // CLOSURE, both directions.
  "plans/all-terminal-active.md": [
    fixturePlan("active", [
      ["R1", "✓"],
      ["R2", "⊘"],
    ]),
    fixturePlan("active", OPEN_PAIR),
  ],
  "plans/all-terminal-retired.md": [
    fixturePlan("reference", [
      ["R1", "✓"],
      ["R2", "⊘"],
    ]),
    fixturePlan("active", OPEN_PAIR),
  ],
  // An unmarked row is not terminal: closure must NOT demand retirement while one survives.
  "plans/unmarked-row.md": [
    fixturePlan("active", [
      ["R1", "✓"],
      ["R2", "RULED"],
    ]),
    fixturePlan("active", [
      ["R1", "☐"],
      ["R2", "RULED"],
    ]),
  ],
  // Graded by words rather than glyphs: no ☐ at base, so the original rule applies.
  "plans/word-vocabulary.md": [
    fixturePlan("active", [
      ["R1", "RULED"],
      ["R2", "REVISED"],
    ]),
    fixturePlan("active", [
      ["R1", "RULED"],
      ["R2", "REVISED"],
    ]),
  ],
  // A merge base that cannot be measured (a shallow checkout): must fail, never silently pass.
  "plans/unreadable-base.md": [
    fixturePlan("active", [
      ["R1", "✓"],
      ["R2", "☐"],
    ]),
    {
      error:
        "the checkout is shallow, so there is no merge base to compare against",
    },
  ],
  // Absent at the merge base: this PR introduces the plan, which is itself the advance.
  "plans/brand-new.md": [
    fixturePlan("active", [
      ["R1", "☐"],
      ["R2", "☐"],
    ]),
    { text: null },
  ],
};

function selfTestFixtures() {
  const root = mkdtempSync(path.join(tmpdir(), "pr-body-selftest-"));
  mkdirSync(path.join(root, "plans"), { recursive: true });
  for (const [relPath, [head]] of Object.entries(PLAN_FIXTURES)) {
    writeFileSync(path.join(root, relPath), head);
  }
  // An ADR fixture for the Decision trailer rule: 0007 exists, 0008 deliberately does not.
  mkdirSync(path.join(root, "docs", "adr"), { recursive: true });
  writeFileSync(
    path.join(root, "docs", "adr", "0007-vendor-plan-row-states.md"),
    "# ADR 0007\n",
  );
  return root;
}

/**
 * Serves the fixture base state in the shape `planAtMergeBase` returns: `{ text }` for a readable
 * base, `{ text: null }` for a plan this PR introduces, `{ error }` for one that cannot be
 * measured. A bare string is sugar for `{ text }`.
 */
function fixtureBaseReader(relPath) {
  const base = PLAN_FIXTURES[relPath]?.[1];
  if (base === undefined || base === null) return { text: null };
  return typeof base === "string" ? { text: base } : base;
}

/** Writes `content` to a temp file and returns its path — a `templatePath` fixture. */
function writeTempTemplate(content) {
  const dir = mkdtempSync(path.join(tmpdir(), "pr-body-template-"));
  const file = path.join(dir, "pull_request_template.md");
  writeFileSync(file, content);
  return file;
}

function selfTest() {
  const root = selfTestFixtures();
  const filled = [
    "## Summary\n\nAfter this merges, x.\n",
    "## Demonstration\n\n```\nbefore\n```\n",
    "## How it was verified\n\n| Claim | Probe |\n|---|---|\n| a | b |\n",
    "## Notes for Reviewers\n\nDistrust commit abc.\n",
  ].join("\n");
  const noFail = (r) => r.failures.length === 0;
  /** A `Plan:` footer: the only plan line a body carries, and the join key. */
  const withPlanFooter = (relPath) => `\nPlan: \`${relPath}\`\n`;
  const cases = [
    {
      name: "filled feat body passes",
      body: filled,
      title: "feat(chains): x",
      expect: noFail,
    },
    {
      name: "untouched template reads as empty",
      body: [
        "## Summary",
        "",
        "## Demonstration",
        "",
        "## How it was verified",
        "",
        "## Notes for Reviewers",
        "",
      ].join("\n"),
      title: "feat(chains): x",
      expect: (r) => r.failures.length >= REQUIRED_SECTIONS.length,
    },
    {
      name: "feat without Demonstration fails",
      body: filled.replace(/## Demonstration[\s\S]*?(?=## How)/, ""),
      title: "feat(chains): x",
      expect: (r) => r.failures.some((f) => f.includes("Demonstration")),
    },
    {
      name: "docs without Demonstration passes",
      body: filled.replace(/## Demonstration[\s\S]*?(?=## How)/, ""),
      title: "docs(docs): x",
      expect: noFail,
    },
    {
      name: "n/a satisfies Demonstration",
      body: filled.replace("```\nbefore\n```", "n/a: config-only change"),
      title: "fix(ci): x",
      expect: noFail,
    },
    {
      name: "surviving ___ placeholder fails",
      body: filled.replace("After this merges, x.", "After this merges, ___."),
      title: "feat(chains): x",
      expect: (r) => r.failures.some((f) => f.includes("placeholder")),
    },
    {
      name: "placeholder inside a comment is fine",
      body: filled.replace(
        "After this merges, x.",
        "After this merges, x. <!-- fill ___ -->",
      ),
      title: "feat(chains): x",
      expect: noFail,
    },
    {
      name: "unfilled verification row fails",
      body: filled.replace("| a | b |", "| `tests/x.test.ts` |  |"),
      title: "feat(chains): x",
      expect: (r) => r.failures.some((f) => f.includes("verification row")),
    },
    {
      name: "active plan footer fails",
      body: `${filled}${withPlanFooter("plans/active.md")}`,
      title: "feat(chains): x",
      expect: (r) => r.failures.some((f) => f.includes("finalized")),
    },
    {
      name: "retired plan footer passes",
      body: `${filled}${withPlanFooter("plans/retired.md")}`,
      title: "feat(chains): x",
      expect: noFail,
    },
    {
      name: "dangling plan footer fails",
      body: `${filled}${withPlanFooter("plans/gone.md")}`,
      title: "feat(chains): x",
      expect: (r) => r.failures.some((f) => f.includes("does not exist")),
    },
    {
      name: "a PR that closes an open row passes though the plan stays active",
      body: `${filled}${withPlanFooter("plans/progress.md")}`,
      title: "feat(chains): x",
      expect: noFail,
    },
    {
      name: "a ✗ kill closes a row",
      body: `${filled}${withPlanFooter("plans/killed.md")}`,
      title: "feat(chains): x",
      expect: noFail,
    },
    {
      name: "a ⊘ no-change-required closes a row",
      body: `${filled}${withPlanFooter("plans/no-change-needed.md")}`,
      title: "feat(chains): x",
      expect: noFail,
    },
    {
      name: "a footer on a plan this PR does not advance fails",
      body: `${filled}${withPlanFooter("plans/stalled.md")}`,
      title: "feat(chains): x",
      expect: (r) => r.failures.some((f) => f.includes("closes none of them")),
    },
    {
      name: "closing the last row without retiring the plan fails",
      body: `${filled}${withPlanFooter("plans/all-terminal-active.md")}`,
      title: "feat(chains): x",
      expect: (r) => r.failures.some((f) => f.includes("retires the")),
    },
    {
      name: "closing the last row and retiring the plan passes",
      body: `${filled}${withPlanFooter("plans/all-terminal-retired.md")}`,
      title: "feat(chains): x",
      expect: noFail,
    },
    {
      name: "an unmarked row is unfinished, so closure does not demand retirement",
      body: `${filled}${withPlanFooter("plans/unmarked-row.md")}`,
      title: "feat(chains): x",
      expect: (r) =>
        noFail(r) && !r.failures.some((f) => f.includes("retires the")),
    },
    {
      name: "a plan graded by words keeps the original finalize-in-this-PR rule",
      body: `${filled}${withPlanFooter("plans/word-vocabulary.md")}`,
      title: "feat(chains): x",
      expect: (r) => r.failures.some((f) => f.includes("finalized")),
    },
    {
      name: "an unmeasurable merge base fails, naming the checkout rather than the plan",
      body: `${filled}${withPlanFooter("plans/unreadable-base.md")}`,
      title: "feat(chains): x",
      expect: (r) =>
        r.failures.some(
          (f) => f.includes("shallow") && f.includes("fetch-depth"),
        ) && !r.failures.some((f) => f.includes("closes none of them")),
    },
    {
      name: "a plan this PR introduces needs no prior row to close",
      body: `${filled}${withPlanFooter("plans/brand-new.md")}`,
      title: "feat(chains): x",
      expect: noFail,
    },
    {
      name: "prose over budget warns, transcripts and details do not count",
      body:
        filled.replace(
          "After this merges, x.",
          `${"word ".repeat(WORD_BUDGET + 1)}`,
        ) +
        `\n<details><summary>appendix</summary>\n\n${"archive ".repeat(2000)}\n</details>\n`,
      title: "feat(chains): x",
      expect: (r) =>
        noFail(r) &&
        r.warnings.filter((w) => w.includes("budget")).length === 1,
    },
    {
      name: "details-only bulk stays under budget",
      body: `${filled}\n<details><summary>appendix</summary>\n\n${"archive ".repeat(2000)}\n</details>\n`,
      title: "feat(chains): x",
      expect: (r) => noFail(r) && !r.warnings.some((w) => w.includes("budget")),
    },
    {
      name: "prose verification warns",
      body: filled.replace(
        "| Claim | Probe |\n|---|---|\n| a | b |",
        "ran the suite, 2823 passed",
      ),
      title: "feat(chains): x",
      expect: (r) => r.warnings.some((w) => w.includes("no table")),
    },
    // --- Plan footer is the join key ---
    {
      name: "a Plan footer alone passes",
      body: `${filled}${withPlanFooter("plans/retired.md")}`,
      title: "feat(chains): x",
      expect: noFail,
    },
    {
      name: "a retired Initiative trailer beside a Plan footer is ignored",
      body: `${filled}${withPlanFooter("plans/retired.md")}Initiative: old-slug\n`,
      title: "feat(chains): x",
      expect: noFail,
    },
    // --- Decision trailer ---
    {
      name: "Decision: ADR-0007 with a matching fixture file passes",
      body: `${filled}\nDecision: ADR-0007\n`,
      title: "feat(chains): x",
      expect: noFail,
    },
    {
      name: "Decision: ADR-0008 with no file fails",
      body: `${filled}\nDecision: ADR-0008\n`,
      title: "feat(chains): x",
      expect: (r) => r.failures.some((f) => f.includes("0008")),
    },
    // --- Fenced example text is content, never a trailer ---
    {
      name: "Plan/Decision lines inside a fenced Demonstration example are content, not trailers",
      body: filled.replace(
        "```\nbefore\n```",
        "```\nPlan: `plans/gone.md`\nDecision: ADR-0008\n```",
      ),
      title: "feat(chains): x",
      expect: noFail,
    },
    {
      name: "the same lines outside a fence still trigger the existing failures",
      body: `${filled}\nPlan: \`plans/gone.md\`\nDecision: ADR-0008\n`,
      title: "feat(chains): x",
      expect: (r) =>
        r.failures.some((f) => f.includes("does not exist")) &&
        r.failures.some((f) => f.includes("0008")),
    },
    // --- Template-derived required sections (a fork's own headings) ---
    {
      name: "a fork template's three headings become required, replacing the constants",
      body: "## What Changed\n\nRewired the widget.\n\n## Why\n\nThe old one broke.\n\n## Checklist\n\n- [x] done\n",
      title: "feat(widget): x",
      templatePath: writeTempTemplate(
        "## What Changed\n\n<!-- what changed -->\n\n## Why\n\n<!-- why -->\n\n## Checklist\n\n<!-- checklist -->\n",
      ),
      expect: noFail,
    },
    {
      name: "a body missing a fork template heading fails, and `Summary` is not demanded",
      body: "## What Changed\n\nRewired the widget.\n\n## Checklist\n\n- [x] done\n",
      title: "feat(widget): x",
      templatePath: writeTempTemplate(
        "## What Changed\n\n<!-- what changed -->\n\n## Why\n\n<!-- why -->\n\n## Checklist\n\n<!-- checklist -->\n",
      ),
      expect: (r) =>
        r.failures.some((f) => f.includes("Why")) &&
        !r.failures.some((f) => f.includes("Summary")),
    },
    {
      name: "a template with no Demonstration heading does not demand one for a feat title",
      body: "## What Changed\n\nRewired the widget.\n\n## Why\n\nThe old one broke.\n\n## Checklist\n\n- [x] done\n",
      title: "feat(widget): x",
      templatePath: writeTempTemplate(
        "## What Changed\n\n<!-- what changed -->\n\n## Why\n\n<!-- why -->\n\n## Checklist\n\n<!-- checklist -->\n",
      ),
      expect: (r) => !r.failures.some((f) => f.includes("Demonstration")),
    },
    {
      name: "a heading marked optional in its own comment block is not required",
      body: "## What Changed\n\nRewired the widget.\n\n## Why\n\nThe old one broke.\n",
      title: "feat(widget): x",
      templatePath: writeTempTemplate(
        "## What Changed\n\n<!-- what changed -->\n\n## Why\n\n<!-- why -->\n\n## Checklist\n\n<!-- optional: skip for docs-only changes -->\n",
      ),
      expect: noFail,
    },
    {
      name: "no template at this checkout falls back to the four core names",
      body: filled,
      title: "feat(chains): x",
      templatePath: path.join(root, "no-such-template.md"),
      expect: noFail,
    },
    {
      name: "no template at this checkout still fails a body missing a core name",
      body: filled.replace(/## Summary[\s\S]*?(?=## Demonstration)/, ""),
      title: "feat(chains): x",
      templatePath: path.join(root, "no-such-template.md"),
      expect: (r) => r.failures.some((f) => f.includes("Summary")),
    },
  ];
  let failed = 0;
  for (const c of cases) {
    const result = checkBody(c.body, c.title, {
      repoRoot: root,
      readPlanAtMergeBase: fixtureBaseReader,
      adrDir: "docs/adr",
      templatePath: c.templatePath,
    });
    const ok = c.expect(result);
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}`);
    if (!ok) {
      failed += 1;
      console.log(`      ${JSON.stringify(result)}`);
    }
  }
  return failed === 0;
}

/**
 * Asserts this checkout can answer "which rows did this PR close" AT ALL.
 *
 * A positive control for the plan-footer check, and deliberately built on `resolveMergeBase` — the
 * same call the check itself makes — so the control cannot report a measurable checkout while the
 * gate reads an unmeasurable one.
 */
function assertBaseMeasurable() {
  const resolved = resolveMergeBase(REPO_ROOT);
  const ci = process.env.GITHUB_ACTIONS === "true";
  if (resolved.error) {
    const remedy =
      !ci && resolved.error === "`origin/HEAD` is not present in this checkout"
        ? "`origin/HEAD` is not set in this clone — run `git remote set-head origin -a` " +
          "(CI: keep `fetch-depth: 0` on the checkout step)."
        : "Restore `fetch-depth: 0` on the checkout step in .github/workflows/pr-conventions.yml.";
    const message =
      `the plan-footer check cannot measure this checkout: ${resolved.error}. Any PR carrying ` +
      `a \`Plan:\` footer would be judged against a vacuous comparison. ${remedy}`;
    console.log(ci ? `::error::${message}` : `error: ${message}`);
    return false;
  }
  const base = resolved.mergeBase.slice(0, 8);
  console.log(`merge base resolves to ${base} — plan progress is measurable.`);
  return true;
}

function main() {
  if (process.argv.includes("--self-test")) {
    process.exit(selfTest() ? 0 : 1);
  }
  if (process.argv.includes("--assert-base-measurable")) {
    process.exit(assertBaseMeasurable() ? 0 : 1);
  }
  const bodyFile = readArg("--body-file");
  const body = bodyFile
    ? readFileSync(bodyFile, "utf8")
    : (process.env.PR_BODY ?? "");
  const title = readArg("--title") ?? process.env.PR_TITLE ?? "";
  const { failures, warnings } = checkBody(body, title);
  const requiredCount = deriveRequiredSections(
    readTemplateHeadings(REPO_ROOT),
  ).length;
  const ci = process.env.GITHUB_ACTIONS === "true";

  for (const w of warnings)
    console.log(ci ? `::warning::${w}` : `warning: ${w}`);
  for (const f of failures) console.log(ci ? `::error::${f}` : `error: ${f}`);

  if (failures.length > 0) {
    console.log(
      "\nPR body does not follow .github/pull_request_template.md." +
        "\nNote: `gh pr create --body` bypasses the template. Generate one: npm run pr:body -- --out /tmp/pr-body.md",
    );
    process.exit(1);
  }
  console.log(
    `PR body: ${requiredCount} required sections present, ` +
      `${warnings.length === 0 ? "no warnings" : `${warnings.length} warning(s)`}.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  main();
}

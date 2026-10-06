#!/usr/bin/env node
/**
 * Architecture Decision Record tool: numbers, indexes, supersedes, and checks the ADR set.
 *
 * Run from a consumer repository root: `node scripts/adr.mjs <command> [--dir docs/adr]`.
 * Zero dependencies — node built-ins only — so a consumer can vendor this single file.
 *
 * THE NUMBER IS THE IDENTITY. Files are `NNNN-kebab-title.md`, numbered monotonically and never
 * reused or renumbered: other documents cite `ADR-0007`, and a renumber silently re-points every
 * citation. A deleted ADR keeps its number as a `| NNNN | (deleted) |` row in the index, which is
 * also what lets `check` tell a deliberate hole from a lost file.
 *
 * THREE FILE STYLES ARE READ, ONE IS WRITTEN. `new` writes YAML front matter (style A). Older
 * repositories carry `# 4. Title` + `Date:` + `## Status` (style B) or `# ADR 0001: Title` + a
 * `- Status:` list (style C). All three are indexed and checked in place; none is migrated. The
 * one legacy edit this tool ever makes is `supersede`, which rewrites exactly the old ADR's
 * status line — a superseded decision must say so where a reader lands on it.
 *
 * `check` never writes. It fails on: an unknown status, a one-sided supersession link, a
 * `superseded` ADR with no successor, a link to a number that does not exist, a `proposed` ADR
 * replacing an `accepted` one (an accepted decision is only replaced by an accepted one), a
 * numbering gap with no `(deleted)` row, and an index that `index` would rewrite.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const KNOWN_STATUSES = new Set([
  "accepted",
  "proposed",
  "superseded",
  "deprecated",
  "rejected",
]);
const ADR_FILE = /^(\d{4})-.+\.md$/;
const TEMPLATE_FILE = "0000-template.md";
const INDEX_FILE = "README.md";
const START_MARKER = "<!-- adr-index:start -->";
const END_MARKER = "<!-- adr-index:end -->";
const HEADER = [
  "#",
  "Title",
  "Status",
  "Date",
  "Supersedes",
  "Superseded by",
  "Initiative",
];
const DEFAULT_BODY = "## Context\n\n## Decision\n\n## Consequences\n";

// ---------------------------------------------------------------- parsing (pure)

const pad = (n) => String(Number(n)).padStart(4, "0");

function numbersIn(value) {
  return [...String(value ?? "").matchAll(/\d{1,4}/g)].map((m) => pad(m[0]));
}

function splitFrontMatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = unquote(kv[2].trim());
  }
  return { fields, body: text.slice(match[0].length) };
}

function unquote(value) {
  const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(value) ?? /^'(.*)'$/.exec(value);
  return quoted ? quoted[1].replace(/\\(["\\])/g, "$1") : value;
}

function firstH1(text) {
  const match = /^#[ \t]+(.+?)[ \t]*$/m.exec(text);
  if (!match) return "";
  return match[1]
    .replace(/^ADR[- ]?\d+\s*[:.\-–—]\s*/i, "")
    .replace(/^\d+\.\s*/, "")
    .trim();
}

/** Lines of the `## <name>` section, up to the next H1/H2. */
function sectionLines(text, name) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) =>
    new RegExp(`^##[ \\t]+${name}[ \\t]*$`, "i").test(l),
  );
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,2}[ \t]/.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

function dateOf(value) {
  const match = /\d{4}-\d{2}-\d{2}/.exec(value ?? "");
  return match ? match[0] : "";
}

function statusWord(value) {
  const match = /^[A-Za-z]+/.exec((value ?? "").trim());
  return match ? match[0].toLowerCase() : "";
}

function linksIn(text) {
  const grab = (re) => [...text.matchAll(re)].map((m) => pad(m[1]));
  return {
    supersededBy: grab(/superseded\s+by\s+ADR[- ]?(\d{1,4})/gi),
    supersedes: grab(/supersedes\s+ADR[- ]?(\d{1,4})/gi),
  };
}

const unique = (list) => [...new Set(list)].sort();

function parseFrontMatterAdr(fm, text) {
  return {
    style: "A",
    title: fm.fields.title || firstH1(fm.body),
    date: dateOf(fm.fields.date),
    rawStatus: fm.fields.status ?? "",
    supersedes: unique(numbersIn(fm.fields.supersedes)),
    supersededBy: unique(numbersIn(fm.fields.superseded_by)),
    initiative: fm.fields.initiative ?? "",
    text,
  };
}

function parseLegacyAdr(text) {
  const listStatus = /^-[ \t]*Status:[ \t]*(.*)$/im.exec(text);
  const statusSection = sectionLines(text, "Status");
  const style = listStatus ? "C" : "B";
  const rawStatus = listStatus
    ? listStatus[1]
    : (statusSection?.find((l) => l.trim() !== "") ?? "").trim();
  const dateLine = listStatus
    ? /^-[ \t]*Date:[ \t]*(.*)$/im.exec(text)
    : /^Date:[ \t]*(.*)$/m.exec(text);
  const linkText = [
    rawStatus,
    ...(statusSection ?? []),
    ...(sectionLines(text, "References") ?? []),
  ].join("\n");
  const links = linksIn(linkText);
  return {
    style,
    title: firstH1(text),
    date: dateOf(dateLine?.[1]),
    rawStatus,
    supersedes: unique(links.supersedes),
    supersededBy: unique(links.supersededBy),
    initiative: "",
    text,
  };
}

export function parseAdr(file, text) {
  const fm = splitFrontMatter(text);
  const parsed = fm ? parseFrontMatterAdr(fm, text) : parseLegacyAdr(text);
  const word = statusWord(parsed.rawStatus);
  return {
    ...parsed,
    file,
    number: ADR_FILE.exec(file)[1],
    status: KNOWN_STATUSES.has(word) ? word : "unknown",
  };
}

export function deletedNumbers(readme) {
  const re = /^\|\s*(\d{1,4})\s*\|\s*\(deleted\)\s*\|/gm;
  return unique([...(readme ?? "").matchAll(re)].map((m) => pad(m[1])));
}

// ---------------------------------------------------------------- index (pure)

const cell = (value) => String(value ?? "").replace(/\|/g, "\\|");
const width = (value) => [...value].length;

/** Table aligned the way prettier aligns markdown tables, so a formatter pass is a no-op. */
function alignedTable(rows) {
  const widths = HEADER.map((_, i) =>
    Math.max(3, ...[HEADER, ...rows].map((r) => width(r[i]))),
  );
  const line = (r) =>
    `| ${r.map((c, i) => c + " ".repeat(widths[i] - width(c))).join(" | ")} |`;
  const rule = `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`;
  return [line(HEADER), rule, ...rows.map(line)].join("\n");
}

export function renderIndex(adrs, deleted) {
  const rows = [
    ...adrs.map((a) => [
      a.number,
      `[${cell(a.title)}](${a.file})`,
      a.status,
      a.date,
      a.supersedes.join(", "),
      a.supersededBy.join(", "),
      cell(a.initiative),
    ]),
    ...deleted
      .filter((n) => !adrs.some((a) => a.number === n))
      .map((n) => [n, "(deleted)", "", "", "", "", ""]),
  ].sort((x, y) => x[0].localeCompare(y[0]));
  return `${START_MARKER}\n\n${alignedTable(rows)}\n\n${END_MARKER}`;
}

export function renderReadme(current, block) {
  if (current !== null) {
    const start = current.indexOf(START_MARKER);
    const end = current.indexOf(END_MARKER);
    if (start !== -1 && end > start) {
      return (
        current.slice(0, start) + block + current.slice(end + END_MARKER.length)
      );
    }
  }
  return (
    "# Architecture Decision Records\n\n" +
    "This index is generated by `node scripts/adr.mjs index`; edit the ADR files, not the table.\n\n" +
    `${block}\n`
  );
}

// ---------------------------------------------------------------- check (pure)

function supersessionFindings(adr, byNumber) {
  const findings = [];
  for (const next of adr.supersededBy) {
    const successor = byNumber.get(next);
    if (!successor)
      findings.push(
        `${adr.number}: superseded_by ${next}, which does not exist`,
      );
    else if (!successor.supersedes.includes(adr.number))
      findings.push(
        `${adr.number}: asymmetric supersession — says superseded_by ${next}, but ${next} does not say supersedes ${adr.number}`,
      );
  }
  for (const prev of adr.supersedes) {
    const predecessor = byNumber.get(prev);
    if (!predecessor) {
      findings.push(`${adr.number}: supersedes ${prev}, which does not exist`);
      continue;
    }
    if (!predecessor.supersededBy.includes(adr.number))
      findings.push(
        `${adr.number}: asymmetric supersession — says supersedes ${prev}, but ${prev} does not say superseded_by ${adr.number}`,
      );
    const replacesAccepted =
      predecessor.status === "accepted" ||
      (predecessor.status === "superseded" &&
        predecessor.supersededBy.includes(adr.number));
    if (adr.status === "proposed" && replacesAccepted)
      findings.push(
        `${adr.number}: proposed ADR supersedes ${prev}, an accepted decision — only an accepted ADR may replace it`,
      );
  }
  return findings;
}

function adrFindings(adr, byNumber) {
  const findings = [];
  if (adr.status === "unknown")
    findings.push(
      `${adr.number}: unknown status "${adr.rawStatus}" (${adr.file})`,
    );
  if (adr.status === "superseded" && adr.supersededBy.length === 0)
    findings.push(`${adr.number}: status superseded but no superseded_by`);
  return [...findings, ...supersessionFindings(adr, byNumber)];
}

function numberingFindings(adrs, deleted) {
  const findings = [];
  const seen = new Map();
  for (const adr of adrs) {
    if (seen.has(adr.number))
      findings.push(
        `${adr.number}: number used twice (${seen.get(adr.number)}, ${adr.file})`,
      );
    seen.set(adr.number, adr.file);
  }
  if (adrs.length === 0) return findings;
  const numbers = adrs.map((a) => Number(a.number));
  for (let n = Math.min(...numbers); n <= Math.max(...numbers); n += 1) {
    if (!seen.has(pad(n)) && !deleted.includes(pad(n)))
      findings.push(
        `${pad(n)}: numbering gap — no file and no "| ${pad(n)} | (deleted) |" row in ${INDEX_FILE}`,
      );
  }
  return findings;
}

export function checkSet(adrs, readme) {
  const byNumber = new Map(adrs.map((a) => [a.number, a]));
  const deleted = deletedNumbers(readme);
  const findings = [
    ...adrs.flatMap((a) => adrFindings(a, byNumber)),
    ...numberingFindings(adrs, deleted),
  ];
  const expected = renderReadme(readme, renderIndex(adrs, deleted));
  if (readme === null)
    findings.push(`${INDEX_FILE}: missing — run \`adr.mjs index\``);
  else if (expected !== readme)
    findings.push(`${INDEX_FILE}: index is stale — run \`adr.mjs index\``);
  return findings;
}

// ---------------------------------------------------------------- writing (pure)

export function slugify(title) {
  const full = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (full.length <= 60) return full;
  const cut = full.slice(0, 60);
  const lastDash = cut.lastIndexOf("-");
  const wholeWord = lastDash > 0 ? cut.slice(0, lastDash) : cut;
  return wholeWord.replace(/-+$/g, "");
}

function templateBody(template) {
  if (template === null) return DEFAULT_BODY;
  const fm = splitFrontMatter(template);
  const lines = (fm ? fm.body : template).split(/\r?\n/);
  const h1 = lines.findIndex((l) => /^#[ \t]/.test(l));
  if (h1 !== -1) lines.splice(h1, 1);
  // The front matter now owns status and date; a template's own status/date lines would contradict it.
  const body = lines
    .filter((l) => !/^(-[ \t]*)?(Status|Date):/i.test(l))
    .join("\n")
    .replace(/^\s+/, "");
  return body.endsWith("\n") ? body : `${body}\n`;
}

const yamlString = (value) =>
  `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export function renderNewAdr({
  number,
  title,
  status,
  date,
  initiative,
  supersedes,
  template,
}) {
  return [
    "---",
    `number: ${number}`,
    `title: ${yamlString(title)}`,
    `status: ${status}`,
    `date: ${date}`,
    `initiative: ${initiative ?? ""}`.trimEnd(),
    `supersedes: ${supersedes ?? ""}`.trimEnd(),
    "superseded_by:",
    "---",
    "",
    `# ADR ${number}: ${title}`,
    "",
    templateBody(template),
  ].join("\n");
}

/** Rewrites only the old ADR's status line (plus `superseded_by:` for front matter). */
export function markSuperseded(adr, successor) {
  const eol = adr.text.includes("\r\n") ? "\r\n" : "\n";
  const lines = adr.text.split(/\r?\n/);
  if (adr.style === "A") return markFrontMatter(lines, successor).join(eol);
  const index =
    adr.style === "C"
      ? lines.findIndex((l) => /^-[ \t]*Status:/i.test(l))
      : firstStatusLine(lines);
  if (index === -1)
    throw new Error(`${adr.file}: no status line to mark superseded`);
  lines[index] =
    adr.style === "C"
      ? lines[index].replace(
          /^(-[ \t]*Status:[ \t]*).*$/i,
          `$1superseded by ADR-${successor}`,
        )
      : `Superseded by ADR-${successor}`;
  return lines.join(eol);
}

function firstStatusLine(lines) {
  const heading = lines.findIndex((l) => /^##[ \t]+Status[ \t]*$/i.test(l));
  if (heading === -1) return -1;
  const offset = lines.slice(heading + 1).findIndex((l) => l.trim() !== "");
  return offset === -1 ? -1 : heading + 1 + offset;
}

function markFrontMatter(lines, successor) {
  const close = lines.indexOf("---", 1);
  const set = (key, value) => {
    const at = lines.findIndex(
      (l, i) => i > 0 && i < close && new RegExp(`^${key}\\s*:`).test(l),
    );
    if (at !== -1) lines[at] = `${key}: ${value}`;
    else lines.splice(lines.indexOf("---", 1), 0, `${key}: ${value}`);
  };
  set("status", "superseded");
  set("superseded_by", successor);
  return lines;
}

// ---------------------------------------------------------------- I/O shell

class AdrDirectory {
  constructor(dir) {
    this.dir = dir;
  }

  readOptional(name) {
    const file = path.join(this.dir, name);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  }

  load() {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((f) => ADR_FILE.test(f) && f !== TEMPLATE_FILE)
      .filter((f) => !f.startsWith("0000-"))
      .sort()
      .map((f) => parseAdr(f, fs.readFileSync(path.join(this.dir, f), "utf8")));
  }

  index() {
    const readme = this.readOptional(INDEX_FILE);
    const block = renderIndex(this.load(), deletedNumbers(readme));
    const next = renderReadme(readme, block);
    if (next !== readme)
      fs.writeFileSync(path.join(this.dir, INDEX_FILE), next);
    return next;
  }

  check() {
    return checkSet(this.load(), this.readOptional(INDEX_FILE));
  }

  create(title, options) {
    const taken = [
      ...this.load().map((a) => Number(a.number)),
      ...deletedNumbers(this.readOptional(INDEX_FILE)).map(Number),
    ];
    const number = pad(Math.max(0, ...taken) + 1);
    const file = `${number}-${slugify(title) || "untitled"}.md`;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(
      path.join(this.dir, file),
      renderNewAdr({
        number,
        title,
        status: options.status ?? "proposed",
        date: options.date ?? new Date().toISOString().slice(0, 10),
        initiative: options.initiative,
        supersedes: options.supersedes ? pad(options.supersedes) : "",
        template: this.readOptional(TEMPLATE_FILE),
      }),
    );
    return { number, file: path.join(this.dir, file) };
  }

  supersede(oldNumber, title, options) {
    const old = this.load().find((a) => a.number === pad(oldNumber));
    if (!old) throw new Error(`no ADR ${pad(oldNumber)} in ${this.dir}`);
    const created = this.create(title, {
      ...options,
      status: options.status ?? "accepted",
      supersedes: old.number,
    });
    fs.writeFileSync(
      path.join(this.dir, old.file),
      markSuperseded(old, created.number),
    );
    return created;
  }
}

// ---------------------------------------------------------------- CLI

const HELP = `Usage: node scripts/adr.mjs <command> [options]

Commands:
  new "<title>" [--initiative x] [--status proposed] [--supersedes NNNN]
                             write the next-numbered ADR (YAML front matter), re-index, print its path
  supersede NNNN "<title>"   write an accepted ADR superseding NNNN, mark NNNN superseded, re-index
  index                      regenerate the table between the adr-index markers in README.md
  check                      exit 1 listing inconsistencies; never writes
  --self-test                run the built-in fixture suite
  --help                     show this help

Options:
  --dir PATH                 ADR directory (default docs/adr)`;

function parseArgs(argv) {
  const options = { positional: [] };
  const valued = new Set([
    "--dir",
    "--initiative",
    "--status",
    "--supersedes",
    "--date",
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (valued.has(arg)) {
      if (argv[i + 1] === undefined) throw new Error(`${arg} needs a value`);
      options[arg.slice(2)] = argv[(i += 1)];
    } else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--self-test") options.selfTest = true;
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else options.positional.push(arg);
  }
  return options;
}

function validateStatus(status) {
  if (status !== undefined && !KNOWN_STATUSES.has(status))
    throw new Error(
      `--status must be one of ${[...KNOWN_STATUSES].join(", ")}`,
    );
}

function runCommand(options) {
  const [command, ...rest] = options.positional;
  const adrs = new AdrDirectory(path.resolve(options.dir ?? "docs/adr"));
  validateStatus(options.status);
  if (command === "index") {
    adrs.index();
    console.log(`indexed ${adrs.load().length} ADRs`);
    return 0;
  }
  if (command === "check") {
    const findings = adrs.check();
    for (const finding of findings) console.log(finding);
    if (findings.length === 0) console.log(`ok ${adrs.load().length} ADRs`);
    return findings.length === 0 ? 0 : 1;
  }
  if (command === "new" && rest.length === 1) {
    const created = adrs.create(rest[0], options);
    adrs.index();
    console.log(path.relative(process.cwd(), created.file));
    return 0;
  }
  if (
    command === "supersede" &&
    rest.length === 2 &&
    /^\d{1,4}$/.test(rest[0])
  ) {
    const created = adrs.supersede(rest[0], rest[1], options);
    adrs.index();
    console.log(path.relative(process.cwd(), created.file));
    return 0;
  }
  console.error(HELP);
  return 2;
}

// ---------------------------------------------------------------- self-test

const SELF_TEST_FILES = {
  "0001-front-matter-decision.md":
    '---\nnumber: 0001\ntitle: "Front matter decision"\nstatus: accepted\ndate: 2026-09-01\ninitiative: delivery-contract\nsupersedes:\nsuperseded_by:\n---\n\n# ADR 0001: Front matter decision\n\n## Context\n\nStyle A.\n',
  "0002-numbered-heading-decision.md":
    "# 2. Numbered Heading Decision\n\nDate: 2026-07-11\n\n## Status\n\nAccepted\n\n## Context\n\nStyle B.\n\n## Decision\n\nKeep it.\n",
  "0003-list-metadata-decision.md":
    "# ADR 0003: List Metadata Decision\n\n- Status: accepted (amended 2026-08-02 — see § Amendment)\n- Date: 2026-07-29\n- Owners: @minipuft\n\n## Context\n\nStyle C.\n",
};

function changedLines(before, after) {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length !== b.length) return -1;
  return a.filter((line, i) => line !== b[i]).length;
}

function selfTest() {
  const self = fileURLToPath(import.meta.url);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr-self-test-"));
  const dir = path.join(root, "adr");
  fs.mkdirSync(dir);
  for (const [name, text] of Object.entries(SELF_TEST_FILES))
    fs.writeFileSync(path.join(dir, name), text);
  const run = (target, ...args) =>
    spawnSync(process.execPath, [self, ...args, "--dir", target], {
      encoding: "utf8",
    }).status;
  const read = (name) => fs.readFileSync(path.join(dir, name), "utf8");
  const legacyIntact = () =>
    read("0001-front-matter-decision.md") ===
      SELF_TEST_FILES["0001-front-matter-decision.md"] &&
    read("0003-list-metadata-decision.md") ===
      SELF_TEST_FILES["0003-list-metadata-decision.md"];
  const cases = [];
  const expect = (name, ok) => {
    cases.push(ok);
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  };
  try {
    expect(
      "index lists one row per style",
      run(dir, "index") === 0 &&
        (read(INDEX_FILE).match(/^\| 000\d /gm) ?? []).length === 3,
    );
    expect("check passes on a consistent set", run(dir, "check") === 0);
    const before = read("0002-numbered-heading-decision.md");
    expect(
      "supersede exits 0",
      run(dir, "supersede", "0002", "Replacement decision") === 0,
    );
    expect(
      "supersede changes exactly one line of the style-B file",
      changedLines(before, read("0002-numbered-heading-decision.md")) === 1,
    );
    expect("check passes after supersede", run(dir, "check") === 0);
    const forged = path.join(root, "forged");
    fs.cpSync(dir, forged, { recursive: true });
    const successor = path.join(forged, "0004-replacement-decision.md");
    fs.writeFileSync(
      successor,
      fs
        .readFileSync(successor, "utf8")
        .replace(/^supersedes: .*$/m, "supersedes:"),
    );
    expect(
      "check fails on a forged asymmetric link",
      run(forged, "check") === 1,
    );
    expect("style-A and style-C files byte-identical", legacyIntact());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  return cases.every(Boolean) ? 0 : 1;
}

function main(argv) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      console.log(HELP);
      return 0;
    }
    if (options.selfTest) return selfTest();
    return runCommand(options);
  } catch (error) {
    console.error(`adr: ${error.message}`);
    return 2;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = main(process.argv.slice(2));

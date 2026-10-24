#!/usr/bin/env node
/**
 * Plan rows must be checkable in every state they can be in.
 *
 * A status glyph is a claim, and a claim nobody can re-check is indistinguishable from one nobody
 * made. `☐` is the unmarked default — "still open" and "never re-checked" look identical — so an
 * open row must name its own falsifier. `⊘` asserts settlement with no artifact to check, so its
 * stamp is the only evidence a reader gets. `⚠` and `✗` assert too, and carry the same kind of
 * stamp. This checks NOTATION, not world state: a stamp is nearly free to write and expensive to
 * reconstruct a week later. The grammar is `conventions/plan-rows.md` upstream; the parser and
 * vocabulary are `plan-rows.mjs` beside this file.
 *
 * Rules (each reads only the plan files):
 *   open-stamp         ☐ row in an active plan lacks `(as of <date> · flips when …)`
 *   closed-stamp       ⊘ row in an active plan lacks `(verified <date> · <reason>)`
 *   warning-stamp      ⚠ row in an active plan lacks `(as of <date> · flips when …)`     [strict]
 *   killed-stamp       ✗ row in an active plan lacks `KILLED (<date> · <reason> · revives if …)`
 *                                                                                        [strict]
 *   unknown-glyph      an active plan's status cell opens with a glyph outside the vocabulary
 *   table-contiguity   a block of table lines does not open with a header + separator (any status)
 *   status-vocabulary  frontmatter `status:` is outside active / backlog / done / reference
 *
 * The two [strict] rules run only under `--strict-stamps`: the stamps they read were a convention
 * before they were a rule, and rows written before it exist (5 in claude-prompts-mcp's active
 * plans when this landed). A consumer turns them on once its plans carry the stamps.
 *
 * `*-implementation-notes.md` files are exempt from every row rule whatever their `status:`.
 * Whether a ✓ row's artifact is committed is a repository question (it reads the git index) and
 * stays with the consumer's own gate.
 *
 * Usage:
 *   node scripts/validate-plan-rows.mjs [--root <dir>] [--json] [--strict-stamps] [paths...]
 *   node scripts/validate-plan-rows.mjs --self-test
 *
 * With no paths, every `*.md` under the plans directory (`plansDirectory` in
 * `plan-retirement.config.json`, else `plans/`) is read, skipping `archive/` and `future/`
 * subtrees and `*.validation-log.md` sidecars; a missing plans directory has nothing to check.
 * Exit 0 clean, 1 findings, 2 usage or I/O error.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  NOTES_SUFFIX,
  STAMP_GRAMMAR,
  STATUSES,
  glyphInfo,
  hasStamp,
  orphanTableBlocks,
  parsePlanTables,
  readFrontmatter,
} from "./plan-rows.mjs";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const CONFIG_FILENAME = "plan-retirement.config.json";
const SKIPPED_DIRS = new Set(["archive", "future", "node_modules", ".git"]);
const LOG_SUFFIX = ".validation-log.md";

/** Rule id → the one-line reason a reader gets beside its findings. */
export const RULES = Object.freeze({
  "table-contiguity":
    "A table line that does not follow its table's header + separator is invisible to every row reader, so the row drops out of tracking without anything failing.",
  "open-stamp":
    "A ☐ asserts nothing, so nothing can re-check it; the stamp names what would close it and how old that belief is.",
  "warning-stamp":
    "A ⚠ row is still open with a falsified premise; without a date and a falsifier it reads the same as an abandoned one.",
  "closed-stamp":
    "A ⊘ asserts settlement with no artifact to check, so the stamp is the only evidence — without it, closed and forgotten look the same.",
  "killed-stamp":
    "A ✗ ends work; the date, the reason and what would revive it are what keep a killed row from reading as a lost one.",
  "unknown-glyph":
    "A status glyph outside ☐ ⚠ ✓ ⊘ ✗ is a vocabulary no row reader recognises, so the row's state is silently unknown.",
  "status-vocabulary":
    "A plan status outside active / backlog / done / reference is graded by nothing: no rule, retirement step or footer check knows what it means.",
});

/** Stamp kinds whose rule runs only under `--strict-stamps`. */
const STRICT_STAMPS = new Set(["warning", "killed"]);

const STAMP_RULE = {
  open: "open-stamp",
  warning: "warning-stamp",
  closed: "closed-stamp",
  killed: "killed-stamp",
};

function isLetterOrDigit(character) {
  return /[\p{L}\p{N}]/u.test(character);
}

/**
 * Every finding for one plan's text. Pure — the self-test and the tests feed it fabricated plans.
 *
 * @param {string} file  The path reported in findings.
 * @param {string} content
 * @param {{ strictStamps?: boolean }} [options]
 * @returns {{ rule: string, file: string, line: number, rowId?: string, message: string }[]}
 */
export function auditPlan(file, content, { strictStamps = false } = {}) {
  const findings = [];
  const frontmatter = readFrontmatter(content);
  const status = frontmatter?.status;

  if (status !== undefined && status !== "" && !STATUSES.includes(status)) {
    const line = content.split("\n").findIndex((l) => /^status:/.test(l)) + 1;
    findings.push({
      rule: "status-vocabulary",
      file,
      line,
      message: `status \`${status}\` is not one of ${STATUSES.join(", ")}`,
    });
  }

  if (path.basename(file).endsWith(NOTES_SUFFIX)) return findings;

  for (const orphan of orphanTableBlocks(content)) {
    findings.push({
      rule: "table-contiguity",
      file,
      line: orphan.line,
      rowId: orphan.rowId,
      message:
        "a table-row-shaped line starts a block that does not open with its own header + " +
        `separator, so row ${orphan.rowId} and everything after it in the block drop out of ` +
        "row tracking. Remove what separates it from the table above (blank line, prose, a " +
        "heading, a fence), or give the block its own header and `| --- |` separator.",
    });
  }

  if (status !== "active") return findings;

  for (const row of parsePlanTables(content)) {
    const info = glyphInfo(row.status);
    if (!info) {
      if (row.statusFromHeader && row.status && !isLetterOrDigit(row.status)) {
        findings.push({
          rule: "unknown-glyph",
          file,
          line: row.line,
          rowId: row.rowId,
          message: `status cell opens with \`${row.status}\`, which is not one of ☐ ⚠ ✓ ⊘ ✗`,
        });
      }
      continue;
    }
    if (!info.stamp || hasStamp(row.status, row.text)) continue;
    if (STRICT_STAMPS.has(info.stamp)) {
      // ⚠ and ✗ stamps are read from a declared status column only: a status-less table (a
      // comparison matrix) uses ✗ to mean "not supported", not "killed".
      if (!strictStamps || !row.statusFromHeader) continue;
    }
    findings.push({
      rule: STAMP_RULE[info.stamp],
      file,
      line: row.line,
      rowId: row.rowId,
      message: `a row marked ${row.status} carries no stamp — add \`${STAMP_GRAMMAR[info.stamp]}\``,
    });
  }

  return findings;
}

function plansDirectoryOf(root) {
  const configPath = path.join(root, CONFIG_FILENAME);
  if (!existsSync(configPath)) return path.join(root, "plans");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  return path.resolve(root, config.plansDirectory ?? "plans");
}

function walkPlans(directory, out = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) walkPlans(full, out);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".md") &&
      !entry.name.endsWith(LOG_SUFFIX)
    ) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Findings for a repository (every plan under its plans directory) or for explicit paths.
 *
 * @param {{ root?: string, paths?: string[], strictStamps?: boolean }} options
 */
export function validatePlans({
  root = ROOT_DIR,
  paths = [],
  strictStamps = false,
} = {}) {
  let files;
  if (paths.length > 0) {
    files = paths.map((p) => path.resolve(p));
  } else {
    const directory = plansDirectoryOf(root);
    files =
      existsSync(directory) && statSync(directory).isDirectory()
        ? walkPlans(directory).sort()
        : [];
  }

  const findings = [];
  const stats = { plans: 0, active: 0, rows: 0, stamped: 0 };
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const reported = path.relative(root, file) || file;
    stats.plans += 1;
    if (readFrontmatter(content)?.status === "active") {
      stats.active += 1;
      if (!path.basename(file).endsWith(NOTES_SUFFIX)) {
        for (const row of parsePlanTables(content)) {
          const info = glyphInfo(row.status);
          if (!info) continue;
          stats.rows += 1;
          if (info.stamp && hasStamp(row.status, row.text)) stats.stamped += 1;
        }
      }
    }
    findings.push(...auditPlan(reported, content, { strictStamps }));
  }
  return { findings, stats };
}

function report(result) {
  const byRule = new Map();
  for (const finding of result.findings) {
    if (!byRule.has(finding.rule)) byRule.set(finding.rule, []);
    byRule.get(finding.rule).push(finding);
  }
  for (const [rule, findings] of byRule) {
    console.error(`✖ ${rule} (${findings.length}): ${RULES[rule]}`);
    for (const f of findings) {
      const id = f.rowId ? ` [${f.rowId}]` : "";
      console.error(`  - ${f.file}:${f.line}${id}: ${f.message}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Self-test: a planted defect per rule must fail, and a clean corpus must pass. Hermetic — every
// file lives in a fresh temporary directory, and nothing is written inside the repository.
// ---------------------------------------------------------------------------------------------

const ACTIVE =
  "---\ntitle: t\ndate: 2026-10-20\nstatus: active\ntags: []\n---\n\n";
const HEADER = "| # | St | Change |\n| --- | --- | --- |\n";

/** One plan per rule, each carrying exactly the defect its rule must catch. */
export const PLANTED = Object.freeze({
  "open-stamp": `${ACTIVE}${HEADER}| 1.1 | ☐ | pending work |\n`,
  "warning-stamp": `${ACTIVE}${HEADER}| 1.1 | ⚠ | premise failed |\n`,
  "closed-stamp": `${ACTIVE}${HEADER}| 1.1 | ⊘ | nothing to change |\n`,
  "killed-stamp": `${ACTIVE}${HEADER}| 1.1 | ✗ KILLED | not worth it |\n`,
  "unknown-glyph": `${ACTIVE}${HEADER}| 1.1 | ✅ | done, wrong glyph |\n`,
  "table-contiguity": `${ACTIVE}${HEADER}| 1.1 | ✓ | x |\n\n| 1.2 | ✓ | y |\n`,
  "status-vocabulary":
    "---\ntitle: t\ndate: 2026-10-20\nstatus: wip\ntags: []\n---\n",
});

/** A corpus every rule must accept. */
export const CLEAN = Object.freeze({
  "clean.md":
    `${ACTIVE}${HEADER}` +
    "| 1.1 | ☐ (as of 2026-10-20 · flips when the file exists) | x |\n" +
    "| 1.2 | ⚠ (as of 2026-10-20 · flips when the premise is re-measured) | x |\n" +
    "| 1.3 | ✓ 2026-10-20 · quotes ⊘ and ☐ in its own text | x |\n" +
    "| 1.4 | ⊘ (verified 2026-10-20 · grep found nothing to change) | x |\n" +
    "| 1.5 | ✗ KILLED (2026-10-20 · superseded · revives if the need returns) | x |\n",
  "clean-implementation-notes.md": `${ACTIVE}| orphan | ☐ |\n`,
});

function writeCorpus(dir, files) {
  mkdirSync(path.join(dir, "plans"), { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, "plans", name), text);
  }
}

function runSelfTest() {
  const dir = mkdtempSync(path.join(tmpdir(), "plan-rows-selftest-"));
  let failures = 0;
  try {
    for (const [rule, text] of Object.entries(PLANTED)) {
      const caseDir = path.join(dir, rule);
      writeCorpus(caseDir, { "planted.md": text });
      const rules = validatePlans({
        root: caseDir,
        strictStamps: true,
      }).findings.map((f) => f.rule);
      if (rules.includes(rule)) {
        console.log(`✔ self-test: planted ${rule} defect is caught`);
      } else {
        console.error(
          `✖ self-test: planted ${rule} defect produced no finding`,
        );
        failures += 1;
      }
    }
    for (const rule of ["warning-stamp", "killed-stamp"]) {
      const rules = validatePlans({ root: path.join(dir, rule) }).findings.map(
        (f) => f.rule,
      );
      if (rules.includes(rule)) {
        console.error(`✖ self-test: ${rule} fired without --strict-stamps`);
        failures += 1;
      } else {
        console.log(`✔ self-test: ${rule} stays off without --strict-stamps`);
      }
    }
    const cleanDir = path.join(dir, "clean");
    writeCorpus(cleanDir, CLEAN);
    const { findings } = validatePlans({ root: cleanDir, strictStamps: true });
    if (findings.length === 0) {
      console.log("✔ self-test: the clean corpus passes every rule");
    } else {
      console.error(
        `✖ self-test: the clean corpus produced ${findings[0].rule}`,
      );
      failures += 1;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (failures > 0) return 1;
  console.log("PASSED: plan-row validator self-test");
  return 0;
}

function parseArguments(args) {
  const options = {
    root: ROOT_DIR,
    json: false,
    selfTest: false,
    strictStamps: false,
    paths: [],
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") {
      const value = args[index + 1];
      if (!value) throw new Error("--root requires a directory");
      options.root = path.resolve(value);
      index += 1;
    } else if (arg === "--json") options.json = true;
    else if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--strict-stamps") options.strictStamps = true;
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else options.paths.push(arg);
  }
  return options;
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    console.error(
      "usage: validate-plan-rows.mjs [--root <dir>] [--json] [--strict-stamps] [--self-test] [paths...]",
    );
    return 2;
  }
  if (options.selfTest) return runSelfTest();

  let result;
  try {
    result = validatePlans(options);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    return 2;
  }

  if (options.json) {
    console.log(JSON.stringify({ findings: result.findings }, null, 2));
    return result.findings.length > 0 ? 1 : 0;
  }
  if (result.findings.length > 0) {
    report(result);
    return 1;
  }
  const { plans, active, rows, stamped } = result.stats;
  console.log(
    `PASSED: ${plans} plan(s) read; ${rows} status row(s) across ${active} active plan(s), ` +
      `${stamped} carrying the stamp their glyph requires`,
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  process.exitCode = main();
}

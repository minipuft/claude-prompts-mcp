#!/usr/bin/env node

/**
 * Guards the branch-protection required-status-check contexts against workflow drift.
 *
 * WHY THIS EXISTS
 * GitHub matches a required context against the check-run **name** — a job's `name:` field —
 * not the job id. A protection rule that lists job ids, or a job name that was later renamed,
 * requires a context nothing will ever report: every pull request then sits at
 * `mergeStateStatus=BLOCKED` with all of its checks green. Nothing in the repository can notice
 * on its own: the workflow is valid, the jobs pass, and the mismatch lives in an API setting no
 * file tracks.
 *
 * `.github/required-contexts.json` is that file, and this is the check that keeps it true. A
 * member that renames a job's `name:` without updating the list fails CI, instead of silently
 * breaking merges for every later pull request.
 *
 * WHY IT ALSO REJECTS INTERPOLATED NAMES
 * `Test (Node ${{ matrix.node }})` is a check-run name derived from a matrix value, so it
 * changes whenever the matrix changes. Requiring one re-creates the same failure the moment a
 * matrix entry is added or dropped. Require a literal-named aggregator job instead.
 *
 * HOW IT READS THE WORKFLOWS
 * Line by line, with no YAML dependency. Inside the top-level `jobs:` block a job is a key at
 * the block's first child indentation, and its check-run name is the `name:` at that job's own
 * child indentation, else the job id. Step-level `- name:` lines, nested keys such as
 * `environment: { name: ... }` written in block form, and the workflow's own top-level `name:`
 * are not job names. Any shape this reader cannot read with certainty — a flow-style `jobs:` or
 * job, a multi-line or block-scalar `name:`, a merge key — fails loudly with the file and line,
 * because a guessed name is the defect this check exists to catch.
 *
 * WHAT IT DOES NOT DO
 * It does not read GitHub's live protection settings; that needs a token and would make a local
 * validation run depend on the network. It proves the list is *satisfiable* by the workflows in
 * the tree. Applying the list to the branch is a separate, deliberate `gh api` call.
 *
 * OPT-IN
 * A repository without `.github/required-contexts.json` has declared no list, and the check exits
 * 0 saying so. Creating the file with `branch` and `contexts` opts in.
 *
 * `--self-test` proves each rule can still fail. A rule that cannot reject a wrong-but-
 * well-formed input is decoration, which is the same defect this guard exists to catch.
 *
 * Usage: node scripts/validate-required-contexts.mjs [--root <dir>] [--self-test]
 *
 * RETIREMENT CONDITION: delete when branch protection is declared as code (a ruleset file
 * applied by a workflow), at which point the workflow that applies it is the guard.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const SKIPPABLE = /^\s*(#.*)?$/;
const JOB_KEY = /^([A-Za-z_][A-Za-z0-9_-]*|"[^"\\]+"|'[^']+')\s*:(.*)$/;
const CHILD_KEY = /^("[^"\\]*"|'[^']*'|[A-Za-z0-9_<-]+)\s*:(?:\s(.*))?$/;
const UNSUPPORTED_VALUE_START = /^[|>*&!{[@`%]/;

function indentOf(line) {
  return line.length - line.trimStart().length;
}

/** The text of a value with a trailing ` # comment` removed (plain scalars only). */
function stripComment(raw) {
  const hash = raw.search(/(^|\s)#/);
  return (hash === -1 ? raw : raw.slice(0, hash)).trim();
}

/** Reads a quoted scalar from the start of `raw`; returns the value and whatever follows it. */
function readQuoted(raw) {
  const quote = raw[0];
  let index = 1;
  while (index < raw.length) {
    if (quote === '"' && raw[index] === "\\") {
      index += 2;
      continue;
    }
    if (raw[index] === quote) {
      if (quote === "'" && raw[index + 1] === "'") {
        index += 2;
        continue;
      }
      break;
    }
    index += 1;
  }
  if (index >= raw.length) return null;

  const body = raw.slice(1, index);
  const rest = raw.slice(index + 1);
  if (quote === "'") return { value: body.replaceAll("''", "'"), rest };
  try {
    return { value: JSON.parse(`"${body}"`), rest };
  } catch {
    return null;
  }
}

/**
 * The value of a one-line `name:` scalar, or a reason it cannot be read with certainty.
 * Pure — returns `{ value }` or `{ refusal }`.
 */
function readNameValue(raw) {
  const text = raw.trim();
  if (text === "" || text.startsWith("#")) {
    return { refusal: "has an empty `name:`" };
  }
  if (UNSUPPORTED_VALUE_START.test(text)) {
    return {
      refusal: `has a \`name:\` written as \`${text}\`, which this reader does not resolve; write the name as a one-line scalar`,
    };
  }
  if (text[0] === '"' || text[0] === "'") {
    const quoted = readQuoted(text);
    if (!quoted || !SKIPPABLE.test(quoted.rest)) {
      return { refusal: `has an unreadable quoted \`name:\` (${text})` };
    }
    return { value: quoted.value };
  }
  return { value: stripComment(text) };
}

function unquoteKey(key) {
  return key[0] === '"' || key[0] === "'" ? key.slice(1, -1) : key;
}

/** Line numbers and indents of the top-level `jobs:` block, or null when there is none. */
function locateJobsBlock(lines, file) {
  const starts = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^jobs\s*:/.test(line));
  if (starts.length === 0) return null;
  if (starts.length > 1) {
    throw new Error(`${file}: declares \`jobs:\` more than once`);
  }

  const { line, index: start } = starts[0];
  const inline = stripComment(line.replace(/^jobs\s*:/, ""));
  if (inline !== "") {
    throw new Error(
      `${file}:${start + 1}: \`jobs: ${inline}\` is written in flow style; write it as a block ` +
        "mapping (one job key per line) so its check-run names can be read",
    );
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (!SKIPPABLE.test(lines[index]) && indentOf(lines[index]) === 0) {
      end = index;
      break;
    }
  }
  return { start, end };
}

/**
 * Every job in one workflow's text, as `{ jobId, name, line }`, where `name` is the check-run
 * name GitHub reports: the job's `name:` value, else its id. Pure, and throws naming the file
 * and line for any shape it cannot read with certainty.
 */
export function extractJobNames(text, file = "<workflow>") {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const block = locateJobsBlock(lines, file);
  if (!block) return [];

  const jobs = [];
  let jobIndent = null;
  let current = null;
  let nameLine = null;
  const fail = (index, message) => {
    throw new Error(`${file}:${index + 1}: ${message}`);
  };

  for (let index = block.start + 1; index < block.end; index += 1) {
    const line = lines[index];
    if (SKIPPABLE.test(line)) continue;
    const indent = indentOf(line);
    const content = line.trim();
    jobIndent ??= indent;

    if (indent < jobIndent) {
      fail(index, "is indented less than the jobs above it");
    }

    if (indent === jobIndent) {
      const match = JOB_KEY.exec(content);
      if (!match) fail(index, `\`${content}\` is not a job key`);
      const inline = stripComment(match[2]);
      if (inline !== "") {
        fail(
          index,
          `job \`${unquoteKey(match[1])}\` is written in flow style; write it as a block mapping`,
        );
      }
      current = {
        jobId: unquoteKey(match[1]),
        name: null,
        line: index + 1,
        childIndent: null,
      };
      jobs.push(current);
      nameLine = null;
      continue;
    }

    current.childIndent ??= indent;
    if (indent < current.childIndent) {
      fail(index, `is indented less than the keys of job \`${current.jobId}\``);
    }
    if (indent > current.childIndent) {
      if (nameLine !== null) {
        fail(
          nameLine,
          `the \`name:\` of job \`${current.jobId}\` continues onto the next line; write it on one line`,
        );
      }
      continue;
    }

    nameLine = null;
    const key = CHILD_KEY.exec(content);
    const keyName = key ? unquoteKey(key[1]) : null;
    if (keyName === "<<") {
      fail(
        index,
        `job \`${current.jobId}\` uses a merge key, which can hide its \`name:\`; write the keys out`,
      );
    }
    if (keyName !== "name") continue;

    if (current.name !== null) {
      fail(index, `job \`${current.jobId}\` declares \`name:\` twice`);
    }
    const read = readNameValue(key[2] ?? "");
    if (read.refusal) fail(index, `job \`${current.jobId}\` ${read.refusal}`);
    current.name = read.value;
    nameLine = index;
  }

  if (jobs.length === 0) {
    throw new Error(
      `${file}:${block.start + 1}: \`jobs:\` has no job under it`,
    );
  }

  return jobs.map(({ jobId, name, line }) => ({
    jobId,
    name: name ?? jobId,
    line,
  }));
}

/** Every check-run name the workflows in `dir` can produce, mapped to its source file. */
export function declaredJobNames(dir) {
  if (!existsSync(dir)) {
    throw new Error(
      `${dir} does not exist, so no job can satisfy a required context`,
    );
  }

  const names = new Map();
  for (const entry of readdirSync(dir).sort()) {
    if (!/\.ya?ml$/.test(entry)) continue;
    const text = readFileSync(path.join(dir, entry), "utf8");
    for (const { name } of extractJobNames(text, entry)) {
      names.set(name, entry);
    }
  }
  return names;
}

/**
 * Returns the violations for one required-context list against one set of job names.
 * Pure — the self-test drives it with fabricated inputs.
 */
export function findViolations(contexts, jobNames) {
  const violations = [];

  for (const context of contexts) {
    if (!jobNames.has(context)) {
      violations.push(
        `required context ${JSON.stringify(context)} matches no job \`name:\` in .github/workflows/ — ` +
          `a PR can never satisfy it. Known names: ${[...jobNames.keys()].map((n) => JSON.stringify(n)).join(", ")}`,
      );
      continue;
    }

    if (context.includes("${{")) {
      violations.push(
        `required context ${JSON.stringify(context)} is interpolated, so its name changes with the ` +
          `matrix. Require a literal-named aggregator job instead.`,
      );
    }
  }

  return violations;
}

function namesOf(text) {
  return new Map(
    extractJobNames(text, "self-test.yml").map(({ name }) => [
      name,
      "self-test.yml",
    ]),
  );
}

const SELF_TEST_WORKFLOW = [
  "name: CI",
  "jobs:",
  "  build:",
  "    name: Build",
  "    environment:",
  "      name: npm",
  "    steps:",
  "      - name: Checkout",
  "  lint:",
  "    steps:",
  "    - name: Lint",
].join("\n");

/** Each case must produce at least one violation, or the rule it exercises is inert. */
const SELF_TEST_CASES = [
  {
    rule: "missing context is rejected",
    contexts: ["No Such Job"],
    jobNames: () => new Map([["Build", "ci.yml"]]),
  },
  {
    rule: "job id is rejected when the job declares a name",
    contexts: ["lint"],
    jobNames: () => new Map([["Lint & Validate", "ci.yml"]]),
  },
  {
    rule: "matrix-interpolated context is rejected",
    contexts: ["Test (Node ${{ matrix.node }})"],
    jobNames: () => new Map([["Test (Node ${{ matrix.node }})", "ci.yml"]]),
  },
  {
    rule: "a step-level `- name:` is not a job name",
    contexts: ["Checkout"],
    jobNames: () => namesOf(SELF_TEST_WORKFLOW),
  },
  {
    rule: "a nested `environment: name:` is not a job name",
    contexts: ["npm"],
    jobNames: () => namesOf(SELF_TEST_WORKFLOW),
  },
  {
    rule: "the workflow's top-level `name:` is not a job name",
    contexts: ["CI"],
    jobNames: () => namesOf(SELF_TEST_WORKFLOW),
  },
];

function runSelfTest() {
  console.log(
    "\nvalidate-required-contexts self-test — every rule must reject a wrong input\n",
  );

  let failures = 0;
  const report = (ok, rule) => {
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${rule}`);
    if (!ok) failures += 1;
  };

  for (const { rule, contexts, jobNames } of SELF_TEST_CASES) {
    report(findViolations(contexts, jobNames()).length > 0, rule);
  }

  let flowRefused = false;
  try {
    extractJobNames("jobs: {}\n", "self-test.yml");
  } catch {
    flowRefused = true;
  }
  report(flowRefused, "a flow-style `jobs:` is refused");

  // A passing list must stay passing, or the guard is just always-red.
  report(
    findViolations(["Build", "lint"], namesOf(SELF_TEST_WORKFLOW)).length === 0,
    "a satisfiable list (a named job and an id-only job) is accepted",
  );

  const total = SELF_TEST_CASES.length + 2;
  console.log(
    failures === 0
      ? `\nOK: all ${total} rules are falsifiable\n`
      : `\nFAILED: ${failures} rule(s) cannot detect a wrong input\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

function readArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
}

function failWith(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

/** The declared context list, or null when the repository has not opted in. */
function readContexts(contextsFile) {
  if (!existsSync(contextsFile)) return null;

  let declared;
  try {
    declared = JSON.parse(readFileSync(contextsFile, "utf8"));
  } catch (error) {
    failWith([`${contextsFile} is not valid JSON — ${error.message}`]);
  }

  const contexts = declared?.contexts ?? [];
  if (
    !Array.isArray(contexts) ||
    contexts.some((context) => typeof context !== "string")
  ) {
    failWith([
      `${contextsFile}: \`contexts\` must be an array of check-run names (strings).`,
    ]);
  }
  if (contexts.length === 0) {
    failWith([
      `${contextsFile} declares no contexts — an empty required set protects nothing.`,
    ]);
  }
  return contexts;
}

function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }

  const root = path.resolve(readArg("--root", DEFAULT_ROOT));
  const contextsFile = path.join(root, ".github", "required-contexts.json");
  const contexts = readContexts(contextsFile);

  if (contexts === null) {
    console.log(
      `${contextsFile} is absent, so this repository declares no required status checks to ` +
        'verify. Creating it with "branch" and "contexts" opts in.',
    );
    return;
  }

  let jobNames;
  try {
    jobNames = declaredJobNames(path.join(root, ".github", "workflows"));
  } catch (error) {
    failWith([`Cannot read the workflows' job names: ${error.message}`]);
  }

  const violations = findViolations(contexts, jobNames);
  if (violations.length > 0) {
    failWith([
      "Required status check contexts do not match the workflows:\n",
      ...violations.map((violation) => `  - ${violation}`),
      "\nUpdate .github/required-contexts.json and re-apply it to branch protection, " +
        "or restore the job name.",
    ]);
  }

  console.log(
    `Required status check contexts all resolve to a job name (${contexts.length} checked).`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  main();
}

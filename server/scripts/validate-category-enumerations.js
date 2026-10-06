#!/usr/bin/env node
// @lifecycle canonical - Fails when a hardcoded prompt-category list reappears under src/.
/**
 * Guards the invariant that a prompt category has ONE derivation.
 *
 * WHY THIS EXISTS
 * A category is a directory under the prompts root. `PromptLoader.loadFromDirectories` discovers
 * it, stamps `prompt.category = categoryId` on every prompt it loads, and hands the same set to
 * `CategoryManager.loadCategories`. That is the derivation. Until B.91 (2026-09-20) a second one
 * lived in `CategoryExtractor.isValidCategory` — eight names typed into the source — and the two
 * disagreed: the list shared three names with the nine shipped directories, so six real
 * categories (`workflow`, `examples`, `planning`, `guidance`, `knowledge-capture`,
 * `codebase-setup`) were rewritten to `general` before gate guidance was rendered.
 *
 * The damage was not that the name was wrong; it was that the two derivations were read at
 * DIFFERENT points of one request. Gate selection read the prompt's own category, so a gate
 * scoped via `activation.prompt_categories` was chosen and named in the `**Gates**:` attestation
 * footer; gate render read the rewritten value, so `isGateActive` dropped the gate's text. The
 * model was asked to attest guidance it had never been shown, and every gate and every test was
 * green while it happened — the failure has no error, no exception and no missing output that
 * anything downstream inspects.
 *
 * So this is not a style rule about magic strings. A hardcoded category list IS the defect's
 * shape, and B.91 found four of them, not one.
 *
 * WHAT IT CHECKS
 * No file under `src/` names three or more DISTINCT categories from the live vocabulary within
 * twelve lines of each other. Three is the threshold because a list is what does the damage: one
 * category name is a reference, two are a pair, three within a dozen lines is an enumeration
 * somebody will have to keep in step with the directories by hand. The vocabulary is derived from
 * disk on every run — each directory under `resources/prompts/`, plus every
 * `activation.prompt_categories` value in each `resources/gates/<id>/gate.yaml` — and never typed
 * here, because a gate holding its own copy of the thing it guards is the defect wearing a
 * validator's name.
 *
 * WHAT COUNTS AS NAMING A CATEGORY
 *   - a whole quoted string literal equal to a category name: `'analysis'`, `"workflow"`
 *   - an object key at the start of a line: `content_processing: ['content-structure'],`
 * Both shapes were live in the tree: the allow-list used the first, the category->gate mapping in
 * `gate-analyzer.ts` and a category->intent mapping in `filter-parser.ts` the second.
 *
 * WHAT IT DOES NOT CLAIM
 *   - Comment lines are skipped, so a list written in prose is not seen. Prose cannot be read by
 *     a code path, which is the property this gate is about.
 *   - A literal NESTED inside another string literal is skipped — `"research"` inside a
 *     single-quoted JSON example is documentation, not a list. Detected by counting the other
 *     delimiter before the match on its line, so an apostrophe inside a double-quoted string can
 *     cost a match. That direction loses sensitivity, never silence about a real list.
 *   - A list of names that are NOT categories anywhere on disk is invisible, by construction: the
 *     vocabulary comes from disk. A list of invented categories is a different defect (it selects
 *     gates for categories that cannot exist) and wants its own check.
 *   - The scan reads git-tracked `src/**` only. `scripts/`, `tests/` and the Python hooks are
 *     outside it.
 *
 * `--self-test` proves each rule can still fail, and that the correct shapes still pass.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import * as yaml from 'js-yaml';

import { VERDICT, auditExceptions, reportExceptionAudit } from './lib/exception-hygiene.js';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROMPTS_ROOT = path.join(SERVER, 'resources', 'prompts');
const GATES_ROOT = path.join(SERVER, 'resources', 'gates');

/** Distinct category names within this many lines of each other count as one enumeration. */
const WINDOW_LINES = 12;
/** How many distinct names make a run of references a list. */
const ENUMERATION_SIZE = 3;

/**
 * Files that hold a hardcoded category enumeration this gate has not yet closed.
 *
 * Each names what it maps categories TO, which is why it is a separate fix rather than a rename:
 * the replacement has to come from somewhere, and for both of these the source is a registry read
 * that does not exist yet. `closedBy` names the observation that retires the entry — an entry
 * whose file stops holding an enumeration is `satisfied` and fails this gate rather than sitting
 * here forever.
 */
const ACCEPTED_ENUMERATIONS = [
  {
    file: 'src/mcp/tools/resource-manager/prompt/analysis/gate-analyzer.ts',
    reason:
      "getCategoryGateMapping() suggests gate ids per category for `resource_manager prompt analyze`. It is a suggestion surface, not the execution path — nothing it returns decides which gates a run attaches — so it cannot reproduce B.91's silent drop. Its eight keys are the pre-B.91 allow-list verbatim, including four names (education, research, debugging, content_processing) that name no category directory, so the suggestions for six of the nine real categories are empty.",
    closedBy:
      "the mapping is derived from the gate registry's own `activation.prompt_categories` instead of a literal, at which point no three category names remain within twelve lines of each other in this file",
  },
];

// ---------------------------------------------------------------------------------------------
// Vocabulary — derived from disk, never typed here
// ---------------------------------------------------------------------------------------------

/** Category directories under the bundled prompts root. */
export function categoryDirectories(promptsRoot) {
  return readdirSync(promptsRoot, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_')
    )
    .map((entry) => entry.name);
}

/** Every category any bundled gate scopes itself to. */
export function gateScopedCategories(gatesRoot) {
  const names = new Set();
  for (const entry of readdirSync(gatesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(gatesRoot, entry.name, 'gate.yaml');
    if (!existsSync(file)) continue;
    const parsed = yaml.load(readFileSync(file, 'utf8'));
    const scoped = parsed?.activation?.prompt_categories;
    if (!Array.isArray(scoped)) continue;
    for (const name of scoped) if (typeof name === 'string' && name.trim()) names.add(name.trim());
  }
  return [...names];
}

/**
 * The live vocabulary. A run that finds no categories exits rather than reporting cleanliness —
 * an empty vocabulary matches nothing, which is a probe that observed nothing, not a pass.
 */
function liveVocabulary() {
  const vocabulary = new Set([
    ...categoryDirectories(PROMPTS_ROOT),
    ...gateScopedCategories(GATES_ROOT),
  ]);
  if (vocabulary.size === 0) {
    throw new Error(
      `no categories found under ${PROMPTS_ROOT} or ${GATES_ROOT} — the scan would match nothing`
    );
  }
  return [...vocabulary];
}

// ---------------------------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------------------------

/** Whether the text before `at` on its line makes the occurrence a comment. */
function onCommentLine(source, at) {
  const lineStart = source.lastIndexOf('\n', at) + 1;
  return /^\s*(\*|\/\/|\/\*)/.test(source.slice(lineStart, at));
}

const lineOf = (source, at) => source.slice(0, at).split('\n').length;

/**
 * Every place `source` names one of `vocabulary`, as `{ line, name }` in source order.
 *
 * Exported so the self-test can drive the predicate itself rather than a file on disk.
 */
export function categoryMentions(source, vocabulary) {
  const alternatives = vocabulary
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const pattern = new RegExp(
    `(?:(['"\`])(${alternatives})\\1|^[ \\t]*(${alternatives})(?=\\s*:))`,
    'gm'
  );

  const mentions = [];
  for (const match of source.matchAll(pattern)) {
    if (onCommentLine(source, match.index)) continue;

    const delimiter = match[1];
    if (delimiter) {
      // A literal nested inside a literal of the OTHER delimiter is example text, not a list.
      const lineStart = source.lastIndexOf('\n', match.index) + 1;
      const other = delimiter === '"' ? "'" : '"';
      const opened = source.slice(lineStart, match.index).split(other).length - 1;
      if (opened % 2 === 1) continue;
    }

    mentions.push({ line: lineOf(source, match.index), name: match[2] ?? match[3] });
  }
  return mentions;
}

/**
 * Runs of mentions no more than `WINDOW_LINES` apart holding `ENUMERATION_SIZE`+ distinct names.
 *
 * Exported for the self-test.
 */
export function enumerations(source, vocabulary) {
  const mentions = categoryMentions(source, vocabulary);
  const groups = [];
  let current = [];

  for (const mention of mentions) {
    const previous = current[current.length - 1];
    if (previous && mention.line - previous.line > WINDOW_LINES) {
      groups.push(current);
      current = [];
    }
    current.push(mention);
  }
  if (current.length > 0) groups.push(current);

  return groups
    .map((group) => ({
      from: group[0].line,
      to: group[group.length - 1].line,
      names: [...new Set(group.map((mention) => mention.name))],
    }))
    .filter((group) => group.names.length >= ENUMERATION_SIZE);
}

/** Git-tracked `.ts` files under `src/`. Exactly the reach this gate claims. */
function trackedSourceFiles() {
  const out = execFileSync('git', ['ls-files', '--', 'src'], { cwd: SERVER, encoding: 'utf8' });
  return out.split('\n').filter((file) => file.endsWith('.ts'));
}

/**
 * Classifies one accepted entry against the question this gate asks: does the file it names STILL
 * hold an enumeration?
 *
 * `unreachable` stays distinct from `satisfied`. An entry naming a file outside the git-tracked
 * `src/` scan is inert because nothing looked at it; deleting it would re-arm the site it declares
 * the moment the scan widens (`lib/exception-hygiene.js` § UNREACHABLE).
 *
 * @param {{ exists: boolean, reachable: boolean, holdsEnumeration: boolean }} facts
 */
export function classifyEntry(facts) {
  if (!facts.exists)
    return { verdict: VERDICT.SUBJECT_MISSING, detail: 'no such file under server/' };
  if (!facts.reachable) {
    return { verdict: VERDICT.UNREACHABLE, detail: 'outside the git-tracked src/ scan' };
  }
  if (!facts.holdsEnumeration) {
    return {
      verdict: VERDICT.SATISFIED,
      detail: 'no run of 3+ distinct category names remains in it',
    };
  }
  return { verdict: VERDICT.LOAD_BEARING };
}

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------

function run() {
  const vocabulary = liveVocabulary();
  const accepted = new Set(ACCEPTED_ENUMERATIONS.map((entry) => entry.file));
  const tracked = trackedSourceFiles();
  const holding = new Set();
  const violations = [];

  for (const rel of tracked) {
    const found = enumerations(readFileSync(path.join(SERVER, rel), 'utf8'), vocabulary);
    if (found.length === 0) continue;
    holding.add(rel);
    if (accepted.has(rel)) continue;
    for (const group of found) {
      violations.push(
        `${rel}:${group.from}-${group.to}: names ${group.names.length} prompt categories ` +
          `(${group.names.join(', ')}) in one list. A category is a directory under the prompts ` +
          'root; PromptLoader discovers it and stamps it on every prompt it loads, so a list ' +
          'typed here is a second derivation that drifts — and when the two are read at ' +
          'different points of one request, a gate is selected by one and dropped by the other ' +
          'with nothing failing. Read the category off the prompt, or the registry the loader ' +
          'feeds (CategoryManager).'
      );
    }
  }

  const audit = auditExceptions({
    gate: 'category-enumerations',
    entries: ACCEPTED_ENUMERATIONS,
    describe: (entry) => entry.file,
    closedBy: (entry) => entry.closedBy,
    classify: (entry) =>
      classifyEntry({
        exists: existsSync(path.join(SERVER, entry.file)),
        reachable: tracked.includes(entry.file),
        holdsEnumeration: holding.has(entry.file),
      }),
  });

  if (violations.length > 0) {
    console.error(`✖ hardcoded prompt-category enumerations (${violations.length}):`);
    for (const violation of violations) console.error(`  - ${violation}`);
  }

  // Report both sections before deciding — a run that aborts at the first failure hides the rest.
  const exceptionProblems = reportExceptionAudit('category-enumerations', audit);
  if (violations.length > 0 || exceptionProblems > 0) return 1;

  console.log(
    `✔ prompt categories have one derivation: ${vocabulary.length} live category name(s), no ` +
      `hardcoded list under src/ beyond ${ACCEPTED_ENUMERATIONS.length} declared exception(s).`
  );
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------------------------

/** The vocabulary the fabricated cases are written against. Not the live one — fixtures are fixed. */
const FIXTURE_VOCAB = [
  'analysis',
  'education',
  'development',
  'research',
  'debugging',
  'documentation',
  'content_processing',
  'general',
  'workflow',
  'examples',
];

function selfTest() {
  let failures = 0;

  /** Each case must be REPORTED; a rule that cannot fail is not enforcing anything. */
  const rejected = [
    {
      name: "the motivating instance — CategoryExtractor's deleted allow-list — is rejected",
      source:
        "    const validCategories = [\n      'analysis',\n      'education',\n      'development',\n" +
        "      'research',\n      'debugging',\n      'documentation',\n      'content_processing',\n" +
        "      'general',\n    ];\n",
    },
    {
      name: 'the second shape in the same file — a prompt-id pattern map — is rejected',
      source:
        "    const patterns = [\n      { pattern: /^analysis_/i, category: 'analysis' },\n" +
        "      { pattern: /^education_/i, category: 'education' },\n" +
        "      { pattern: /^debug_/i, category: 'debugging' },\n    ];\n",
    },
    {
      name: 'unquoted object KEYS are rejected, not only quoted values',
      source: '  return {\n    analysis: [1],\n    education: [2],\n    development: [3],\n  };\n',
    },
    {
      name: 'a list spread across the window is still one enumeration',
      source:
        "const a = 'analysis';\n\n\n\nconst b = 'education';\n\n\n\nconst c = 'development';\n",
    },
  ];
  for (const testCase of rejected) {
    if (enumerations(testCase.source, FIXTURE_VOCAB).length === 0) {
      console.error(`✖ self-test: "${testCase.name}" produced no finding — the rule is inert.`);
      failures += 1;
    } else {
      console.log(`✔ self-test: ${testCase.name}`);
    }
  }

  /**
   * The correct shapes must PASS, or the cases above only prove the rule reports everything.
   * Each differs from a reported case in ONE property, so a pass here is about that property.
   */
  const accepted = [
    {
      name: 'two distinct names are a pair, not a list',
      source: 'const map = {\n  analysis: [1],\n  education: [2],\n};\n',
    },
    {
      name: 'one name used three times is one reference, not a list',
      source: "if (p.category === 'analysis') return 'analysis';\nconst d = 'analysis';\n",
    },
    {
      name: 'a list written in a comment is prose, not code',
      source:
        " * an eight-name allow-list ('analysis', 'education', 'development', 'research')\n" +
        ' // analysis / education / development were the three it shared\n',
    },
    {
      name: 'names nested inside another string literal are example text',
      source:
        '  examples: [\n' +
        '    \'{"nodes": [{"id": "research"}, {"id": "analysis"}, {"id": "development"}]}\',\n' +
        '  ],\n',
    },
    {
      name: 'three names further apart than the window are separate references',
      source:
        "const a = 'analysis';\n" +
        '\n'.repeat(20) +
        "const b = 'education';\n" +
        '\n'.repeat(20) +
        "const c = 'development';\n",
    },
    {
      name: 'a substring of a category name is not a category',
      source:
        "const a = 'analysis_helper';\nconst b = 'preeducation';\nconst c = 'development2';\n",
    },
  ];
  for (const testCase of accepted) {
    const found = enumerations(testCase.source, FIXTURE_VOCAB);
    if (found.length > 0) {
      console.error(
        `✖ self-test: "${testCase.name}" was rejected (${found[0].names.join(', ')}) — false alarm.`
      );
      failures += 1;
    } else {
      console.log(`✔ self-test: ${testCase.name} is accepted`);
    }
  }

  // The vocabulary must come from disk and must be non-empty, or the scan matches nothing and
  // every file passes. This is the positive control for the whole gate.
  try {
    const vocabulary = liveVocabulary();
    const missing = ['analysis', 'workflow', 'examples'].filter(
      (name) => !vocabulary.includes(name)
    );
    if (missing.length > 0) {
      console.error(`✖ self-test: live vocabulary is missing shipped categories: ${missing}`);
      failures += 1;
    } else {
      console.log(
        `✔ self-test: the live vocabulary is derived from disk (${vocabulary.length} names)`
      );
    }
    // The B.91 defect in one sentence: `workflow` is a real directory the deleted allow-list did
    // not contain. If that stops being true the gate's motivating instance has changed.
    if (!categoryDirectories(PROMPTS_ROOT).includes('workflow')) {
      console.error('✖ self-test: the `workflow` category directory is gone — re-read the header');
      failures += 1;
    } else {
      console.log('✔ self-test: `workflow` is a real category directory');
    }
  } catch (error) {
    console.error(`✖ self-test: the live vocabulary could not be derived — ${error.message}`);
    failures += 1;
  }

  // Exception hygiene must separate the four verdicts, or the audit is one bit.
  const verdicts = [
    [
      'a file still holding a list is load-bearing',
      { exists: true, reachable: true, holdsEnumeration: true },
      VERDICT.LOAD_BEARING,
    ],
    [
      'a file that stopped holding one is satisfied',
      { exists: true, reachable: true, holdsEnumeration: false },
      VERDICT.SATISFIED,
    ],
    [
      'an entry naming a missing file is subject-missing',
      { exists: false, reachable: false, holdsEnumeration: false },
      VERDICT.SUBJECT_MISSING,
    ],
    [
      'an entry outside the scan is unreachable, NOT satisfied',
      { exists: true, reachable: false, holdsEnumeration: false },
      VERDICT.UNREACHABLE,
    ],
  ];
  for (const [name, facts, expected] of verdicts) {
    const actual = classifyEntry(facts).verdict;
    if (actual !== expected) {
      console.error(`✖ self-test: "${name}" — expected ${expected}, got ${actual}`);
      failures += 1;
    } else {
      console.log(`✔ self-test: ${name}`);
    }
  }

  return failures === 0 ? 0 : 1;
}

process.exit(process.argv.includes('--self-test') ? selfTest() : run());

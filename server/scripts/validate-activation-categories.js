#!/usr/bin/env node
// @lifecycle canonical - Fails when a bundled gate or style names a category nothing declares.
/**
 * Fails when a bundled gate or style lists, in `activation.prompt_categories`, a name that is
 * neither a directory under `resources/prompts/` nor an entry of the declared vocabulary below.
 *
 * WHY THIS EXISTS. A gate scoped by `activation.prompt_categories` attaches to a prompt only when
 * the prompt's category (the name of the directory it was loaded from) is in the list. Measured
 * 2026-10-06: ten bundled gates named nine categories (`architecture`, `code`, `content_processing`,
 * `debugging`, `education`, `general`, `implementation`, `refactoring`, `research`) that are not
 * directories under the bundled prompts root. Such a gate reaches a bundled prompt only through a
 * workspace directory of the same name (a personal library may have one) or, for `general`, the
 * plan-category fallback. Nothing compared the two vocabularies, so the next misspelled or invented
 * name would have shipped silently and the gate would simply never fire.
 *
 * The owner chose a check over renaming the gates: the names stay, each declared once below with
 * the reason it is allowed and the condition that retires it, and a NEW unknown name fails.
 *
 * GROUND TRUTH is read from disk on every run, never typed here: the directory names under
 * `server/resources/prompts/` (a directory whose name starts with `.` or `_` is not a category,
 * the same filter `validate-category-enumerations.js` and the loader apply), and every
 * `activation.prompt_categories` value in `resources/gates/<id>/gate.yaml` and
 * `resources/styles/<id>/style.yaml`.
 *
 * THE DECLARED VOCABULARY lives in `DECLARED_VOCABULARY` in this file. Each entry names a `reason`
 * and a `flips_when`; an entry whose name has become a real directory is reported as satisfied and
 * fails, and so is one no bundled gate or style names any longer, via `lib/exception-hygiene.js`.
 *
 * WHAT IT DOES NOT CLAIM. It reads the bundle only: a workspace library's gates and prompts are
 * outside it. It checks that a name is DECLARED, not that a workspace provides the directory, so a
 * declared name still fires nothing until one does. It does not read `prompt_categories` from
 * anywhere but `activation`.
 *
 * `--self-test` proves each rule can still fail (an undeclared gate name, a declared name that has
 * become a directory) and that the correct shapes still pass.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as yaml from 'js-yaml';

import { VERDICT, auditExceptions, reportExceptionAudit } from './lib/exception-hygiene.js';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROMPTS_ROOT = path.join(SERVER, 'resources', 'prompts');
const SOURCES = [
  { kind: 'gate', root: path.join(SERVER, 'resources', 'gates'), file: 'gate.yaml' },
  { kind: 'style', root: path.join(SERVER, 'resources', 'styles'), file: 'style.yaml' },
];

const NO_GATE_CATEGORY_READER_NOTE =
  'a workspace category directory of this name; the bundle has none';

/** A style's `activation.prompt_categories` has no reader under `src/` (measured 2026-10-06). */
const STYLE_TAG_REASON =
  "a topical tag on a bundled style; nothing under src/ reads a style's activation.prompt_categories, " +
  'so it matches no directory and selects nothing';
const STYLE_TAG_FLIPS =
  'a reader of style activation lands and a bundled directory or a re-aim covers the name, or the ' +
  'style stops listing it';

/**
 * Names a bundled gate or style may list without a bundled prompt directory of the same name.
 * Each entry retires when its `flips_when` becomes true; the audit fails an entry whose name is
 * now a directory or is no longer listed by any bundled file.
 *
 * @type {ReadonlyArray<{ name: string, reason: string, flips_when: string }>}
 */
export const DECLARED_VOCABULARY = [
  ...[
    'architecture',
    'code',
    'content_processing',
    'debugging',
    'education',
    'general',
    'implementation',
    'refactoring',
    'research',
  ].map((name) => ({
    name,
    reason:
      `${NO_GATE_CATEGORY_READER_NOTE}; a gate naming \`${name}\` fires on bundled prompts only ` +
      `when a workspace provides a \`${name}/\` category of prompts` +
      (name === 'general' ? ' or the plan-category fallback resolves to it' : ''),
    flips_when:
      `a bundled \`${name}/\` prompt directory exists, or every gate naming \`${name}\` is ` +
      're re-aimed at a bundled category',
  })),
  ...[
    'investigation',
    'brainstorm',
    'ideation',
    'design',
    'innovation',
    'tutorial',
    'guide',
    'setup',
    'installation',
    'logic',
    'problem-solving',
    'decision',
    'evaluation',
  ].map((name) => ({ name, reason: STYLE_TAG_REASON, flips_when: STYLE_TAG_FLIPS })),
];

// ---------------------------------------------------------------------------------------------
// Ground truth — derived from disk
// ---------------------------------------------------------------------------------------------

/** Category directories under the bundled prompts root. */
export function categoryDirectories(promptsRoot) {
  return readdirSync(promptsRoot, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_')
    )
    .map((entry) => entry.name);
}

/**
 * Every activation list under one resource root, as `{ file, owner, kind, value }` with `file`
 * relative to `server/`. `value` is the raw `activation.prompt_categories`, or `undefined`.
 */
export function readActivations({ kind, root, file }) {
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const absolute = path.join(root, entry.name, file);
    if (!existsSync(absolute)) continue;
    const parsed = yaml.load(readFileSync(absolute, 'utf8'));
    found.push({
      file: path.relative(SERVER, absolute).split(path.sep).join('/'),
      kind,
      value: parsed?.activation?.prompt_categories,
    });
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------------------------

/**
 * One finding per value that is neither a directory nor declared, and one per list that is not an
 * array of strings.
 *
 * @param {Array<{ file: string, kind: string, value: unknown }>} activations
 * @param {readonly string[]} directories
 * @param {readonly string[]} declaredNames
 */
export function findUndeclaredCategories(activations, directories, declaredNames) {
  const known = new Set([...directories, ...declaredNames]);
  const findings = [];
  for (const { file, kind, value } of activations) {
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      findings.push(`${file}: activation.prompt_categories is not a list (${typeof value})`);
      continue;
    }
    for (const name of value) {
      if (typeof name !== 'string' || !known.has(name.trim())) {
        findings.push(
          `${file}: activation.prompt_categories names ${JSON.stringify(name)}, which is neither a ` +
            `directory under resources/prompts/ nor a declared vocabulary entry — a ${kind} ` +
            'scoped to it attaches to no bundled prompt. Rename it to a bundled category, or ' +
            'declare it in DECLARED_VOCABULARY with a reason and a flips_when.'
        );
      }
    }
  }
  return findings;
}

/**
 * Classifies one declared entry. Distinct verdicts keep "became a directory" apart from "nothing
 * names it any longer": both mean delete the entry, for different reasons.
 *
 * @param {{ isDirectory: boolean, namedBy: number }} facts
 */
export function classifyVocabularyEntry(facts) {
  if (facts.isDirectory) {
    return { verdict: VERDICT.SATISFIED, detail: 'a bundled prompt directory of this name exists' };
  }
  if (facts.namedBy === 0) {
    return { verdict: VERDICT.SUBJECT_MISSING, detail: 'no bundled gate or style names it' };
  }
  return { verdict: VERDICT.LOAD_BEARING };
}

function auditVocabulary(activations, directories, vocabulary = DECLARED_VOCABULARY) {
  const namedBy = new Map();
  for (const { value } of activations) {
    if (!Array.isArray(value)) continue;
    for (const name of value) namedBy.set(name, (namedBy.get(name) ?? 0) + 1);
  }
  return auditExceptions({
    gate: 'activation-categories',
    entries: vocabulary,
    describe: (entry) => entry.name,
    closedBy: (entry) => entry.flips_when,
    classify: (entry) =>
      classifyVocabularyEntry({
        isDirectory: directories.includes(entry.name),
        namedBy: namedBy.get(entry.name) ?? 0,
      }),
  });
}

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------

function run() {
  const directories = categoryDirectories(PROMPTS_ROOT);
  const activations = SOURCES.flatMap(readActivations);
  const listed = activations.filter(({ value }) => value !== undefined);
  const names = listed.reduce(
    (sum, { value }) => sum + (Array.isArray(value) ? value.length : 0),
    0
  );

  // A probe that observed nothing is not a pass.
  if (directories.length === 0 || names === 0) {
    console.error(
      `✖ activation-categories: found ${directories.length} prompt director(ies) and ${names} ` +
        'activation name(s) — the scan would match nothing.'
    );
    return 1;
  }

  const findings = findUndeclaredCategories(
    activations,
    directories,
    DECLARED_VOCABULARY.map((entry) => entry.name)
  );
  if (findings.length > 0) {
    console.error(`✖ undeclared activation categories (${findings.length}):`);
    for (const finding of findings) console.error(`  - ${finding}`);
  }

  // Report both sections before deciding — a run that aborts at the first failure hides the rest.
  const problems = reportExceptionAudit(
    'activation-categories',
    auditVocabulary(activations, directories)
  );
  if (findings.length > 0 || problems > 0) return 1;

  const count = (kind) => activations.filter((activation) => activation.kind === kind).length;
  console.log(
    `✔ every activation category is a directory or declared: ${count('gate')} gate(s), ` +
      `${count('style')} style(s), ${listed.length} activation list(s), ${names} name(s) checked ` +
      `against ${directories.length} prompt director(ies) and ` +
      `${DECLARED_VOCABULARY.length} declared vocabulary entr(ies).`
  );
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------------------------

function selfTest() {
  let failures = 0;
  const check = (name, ok, detail = '') => {
    if (ok) {
      console.log(`✔ self-test: ${name}`);
    } else {
      console.error(`✖ self-test: ${name}${detail ? ` — ${detail}` : ''}`);
      failures += 1;
    }
  };

  const directories = ['analysis', 'workflow'];
  const declared = ['research'];

  const planted = findUndeclaredCategories(
    [{ file: 'resources/gates/planted/gate.yaml', kind: 'gate', value: ['analysis', 'nonsense'] }],
    directories,
    declared
  );
  check(
    'a gate naming an undeclared category is red at its file and value',
    planted.length === 1 &&
      planted[0].startsWith('resources/gates/planted/gate.yaml:') &&
      planted[0].includes('"nonsense"'),
    JSON.stringify(planted)
  );

  const notList = findUndeclaredCategories(
    [{ file: 'resources/gates/scalar/gate.yaml', kind: 'gate', value: 'analysis' }],
    directories,
    declared
  );
  check('a list that is not an array is red', notList.length === 1, JSON.stringify(notList));

  const styleOk = findUndeclaredCategories(
    [{ file: 'resources/styles/planted/style.yaml', kind: 'style', value: ['workflow'] }],
    directories,
    declared
  );
  check('a style naming a real directory is green', styleOk.length === 0, JSON.stringify(styleOk));

  const declaredOk = findUndeclaredCategories(
    [{ file: 'resources/gates/planted/gate.yaml', kind: 'gate', value: ['research'] }],
    directories,
    declared
  );
  check(
    'a gate naming a declared vocabulary name is green',
    declaredOk.length === 0,
    JSON.stringify(declaredOk)
  );

  const absent = findUndeclaredCategories(
    [{ file: 'resources/gates/none/gate.yaml', kind: 'gate', value: undefined }],
    directories,
    declared
  );
  check('a gate with no activation list asserts nothing', absent.length === 0);

  const vocabulary = [{ name: 'workflow', reason: 'planted', flips_when: 'planted' }];
  const activations = [{ file: 'resources/gates/p/gate.yaml', kind: 'gate', value: ['workflow'] }];
  const becameDirectory = auditVocabulary(activations, directories, vocabulary);
  check(
    'a declared entry whose name is a directory is red as satisfied',
    becameDirectory.problems.length === 1 &&
      becameDirectory.problems[0].message.startsWith(VERDICT.SATISFIED),
    JSON.stringify(becameDirectory.problems)
  );

  const unnamed = auditVocabulary([], directories, [
    { name: 'ghost', reason: 'planted', flips_when: 'planted' },
  ]);
  check(
    'a declared entry no bundled file names is red as subject-missing',
    unnamed.problems.length === 1 &&
      unnamed.problems[0].message.startsWith(VERDICT.SUBJECT_MISSING),
    JSON.stringify(unnamed.problems)
  );

  const live = auditVocabulary(
    [{ file: 'resources/gates/p/gate.yaml', kind: 'gate', value: ['research'] }],
    directories,
    [{ name: 'research', reason: 'planted', flips_when: 'planted' }]
  );
  check(
    'a declared entry that is named and not a directory is load-bearing',
    live.problems.length === 0
  );

  const noFlip = auditVocabulary(
    [{ file: 'resources/gates/p/gate.yaml', kind: 'gate', value: ['research'] }],
    directories,
    [{ name: 'research', reason: 'planted', flips_when: '' }]
  );
  check('a declared entry with no flips_when is red', noFlip.problems.length === 1);

  // Positive control for the ground truth: the bundle must yield real directories and lists.
  const liveDirectories = categoryDirectories(PROMPTS_ROOT);
  check(
    'the bundled prompt directories are read from disk',
    liveDirectories.includes('workflow') && liveDirectories.length >= 5,
    liveDirectories.join(',')
  );
  const liveActivations = SOURCES.flatMap(readActivations);
  check(
    'the bundled gates and styles yield activation lists',
    liveActivations.some(({ kind, value }) => kind === 'gate' && Array.isArray(value)) &&
      liveActivations.some(({ kind, value }) => kind === 'style' && Array.isArray(value))
  );

  return failures === 0 ? 0 : 1;
}

process.exit(process.argv.includes('--self-test') ? selfTest() : run());

// @lifecycle canonical - Stops a new exported type from reusing a name another type already has (ratchet).
/**
 * Type-Name Homonym Ratchet
 *
 * Three unrelated types were all named `ExecutionContext`. A search for one type's consumers
 * (`rg ExecutionContext`) then returned the other two types' consumers as well, so a dead type
 * read as used and a live one as shared. This repo has recorded that failure for dead-code
 * checks keyed on a name (`feedback_homonym_false_consumer`): the name matches, the type does
 * not. The slice that removed `ExecutionContext` fixed one name; this ratchet stops a new
 * same-name type from appearing, without demanding the existing ones be renamed in one change.
 *
 * WHAT IT READS. Every `server/src/**\/*.ts` file, line by line, with `node:fs` only. A
 * DEFINITION is a line matching
 *
 *   ^export (declare )?(const )?(interface|type|class|enum|abstract class) <Name>\b
 *
 * A HOMONYM is a Name with two or more definitions, in different files or in the same file.
 * The committed baseline (`.type-name-homonyms-baseline.json`) is a sorted list of NAMES, not
 * a count: a count would let one homonym be fixed while another appears and still pass.
 *
 * FAILS (exit 1, every offender named with its file:line list) when
 *   (a) a homonym is not in the baseline — a new collision, rename the new type; or
 *   (b) a baseline entry is no longer a homonym — a stale ceiling, regenerate the baseline.
 * REFUSES (exit 1) when fewer than MIN_DEFINITIONS definitions are found: the walk broke, and
 * "0 homonyms" from a walk that saw nothing would read as a clean tree.
 *
 * DECLARED BLIND SPOTS (false silence, not false alarms):
 * - Re-exports and `export { X }` / `export type { X }` lists are not definitions. A name
 *   re-exported under an alias is invisible here.
 * - Non-exported types are not seen. Two file-local `interface Options` do not collide for a
 *   consumer, which is the property this measures, so that is deliberate.
 * - Definitions are found by line shape. A definition that does not start its line (after a
 *   decorator on the same line, or an indented one inside a `declare module` / namespace block)
 *   is not seen, and neither is one inside a template literal that happens to look like one.
 * - Only `server/src` is walked. `cli/`, `hooks/` and `tests/` define their own types.
 *
 * Usage:
 * - Check:                    `npm run validate:type-name-homonyms`
 * - Accept the measured set:  `node scripts/validate-type-name-homonyms.js --update-baseline`
 * - Prove the logic:          `npm run validate:type-name-homonyms:self-test`
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const TAG = '[type-name-homonyms]';
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = path.join(SERVER_ROOT, 'src');
const BASELINE_PATH = path.join(SERVER_ROOT, '.type-name-homonyms-baseline.json');

/** The tree defines ~2,000 exported types; far below this means the walk, not the code, changed. */
const MIN_DEFINITIONS = 200;

const DEFINITION =
  /^export (?:declare )?(?:const )?(?:interface|type|class|enum|abstract class) ([A-Za-z_$][\w$]*)\b/;

const BASELINE_COMMENT =
  'Exported type names defined more than once under server/src (known homonyms). Regenerate with: node scripts/validate-type-name-homonyms.js --update-baseline';

function listTypeScriptFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') pending.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        files.push(full);
      }
    }
  }
  return files.sort();
}

/** Pure: definitions found in one file's text, as `{ name, line }`. */
export function findDefinitions(text) {
  const found = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const match = DEFINITION.exec(lines[i]);
    if (match !== null) found.push({ name: match[1], line: i + 1 });
  }
  return found;
}

/** Walk `srcRoot`; returns `Map<name, string[]>` of `relative/path.ts:line` sites, plus a total. */
export function collectDefinitions(srcRoot, relativeTo) {
  const sites = new Map();
  let total = 0;
  for (const file of listTypeScriptFiles(srcRoot)) {
    const relative = path.relative(relativeTo, file).split(path.sep).join('/');
    for (const { name, line } of findDefinitions(readFileSync(file, 'utf8'))) {
      total += 1;
      const list = sites.get(name) ?? [];
      list.push(`${relative}:${line}`);
      sites.set(name, list);
    }
  }
  return { sites, total };
}

/** Pure: the names defined at two or more sites, sorted. */
export function homonymNames(sites) {
  return [...sites.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([name]) => name)
    .sort();
}

/**
 * Pure: compare the measured definitions against the baseline names.
 * `refused` is set instead of a comparison when the walk looks broken.
 */
export function evaluate({ sites, total }, baselineNames, minDefinitions = MIN_DEFINITIONS) {
  if (total < minDefinitions) {
    return { refused: true, total, minDefinitions, added: [], stale: [] };
  }
  const measured = new Set(homonymNames(sites));
  const baseline = new Set(baselineNames);
  return {
    refused: false,
    total,
    minDefinitions,
    added: [...measured].filter((name) => !baseline.has(name)).sort(),
    stale: [...baseline].filter((name) => !measured.has(name)).sort(),
  };
}

/** Pure: the failure text, or null when the result is clean. */
export function formatFailure(result, sites) {
  if (result.refused) {
    return (
      `${TAG} REFUSED: found ${result.total} type definition(s), fewer than the ${result.minDefinitions} ` +
      'a real tree holds. The walk broke (wrong root, unreadable directory, changed definition ' +
      'shape); reporting "0 homonyms" from it would read as a clean tree.'
    );
  }
  if (result.added.length === 0 && result.stale.length === 0) return null;

  const lines = [
    `${TAG} FAIL: ${result.added.length} new homonym(s), ${result.stale.length} stale baseline entr${
      result.stale.length === 1 ? 'y' : 'ies'
    }.`,
  ];
  if (result.added.length > 0) {
    lines.push(
      '',
      'Exported type names now defined more than once (rename the new type — a search for one',
      "consumer set must not return another type's):",
      ...result.added.flatMap((name) => [
        `- ${name} (${sites.get(name).length} definitions)`,
        ...sites.get(name).map((site) => `    ${site}`),
      ])
    );
  }
  if (result.stale.length > 0) {
    lines.push(
      '',
      'Baseline entries that are no longer homonyms (renamed or deleted — good). The baseline is',
      'a ceiling nobody lowered; lock it in with:',
      '  node scripts/validate-type-name-homonyms.js --update-baseline',
      ...result.stale.map((name) => `- ${name} (${sites.get(name)?.length ?? 0} definition(s) now)`)
    );
  }
  return lines.join('\n');
}

function serializeBaseline(names) {
  return `${JSON.stringify({ _comment: BASELINE_COMMENT, names }, null, 2)}\n`;
}

function loadBaselineNames() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  } catch {
    throw new Error(
      `${TAG} Missing or unreadable baseline at ${path.relative(process.cwd(), BASELINE_PATH)}. ` +
        'Run: node scripts/validate-type-name-homonyms.js --update-baseline'
    );
  }
  if (!Array.isArray(parsed.names)) {
    throw new Error(`${TAG} Baseline has no "names" array: ${BASELINE_PATH}`);
  }
  return parsed.names;
}

function handleCheck() {
  const measured = collectDefinitions(SRC_ROOT, SERVER_ROOT);
  const result = evaluate(measured, loadBaselineNames());
  const failure = formatFailure(result, measured.sites);
  if (failure !== null) {
    console.error(failure);
    process.exitCode = 1;
    return;
  }
  console.log(
    `${TAG} OK: ${homonymNames(measured.sites).length} known homonyms across ${measured.total} ` +
      'exported type definitions (no new collisions)'
  );
}

function handleUpdateBaseline() {
  const measured = collectDefinitions(SRC_ROOT, SERVER_ROOT);
  const refusal = formatFailure(evaluate(measured, []), measured.sites);
  if (measured.total < MIN_DEFINITIONS) {
    console.error(refusal);
    process.exitCode = 1;
    return;
  }
  const names = homonymNames(measured.sites);
  writeFileSync(BASELINE_PATH, serializeBaseline(names), 'utf8');
  console.log(
    `${TAG} Baseline updated: ${names.length} homonym name(s) across ${measured.total} definitions`
  );
}

function runSelfTest() {
  console.log(`\n${TAG} self-test — fabricated trees, every failure mode and the refusal\n`);
  let failures = 0;
  const check = (label, condition) => {
    console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${label}`);
    if (!condition) failures += 1;
  };

  const shape = (text) => findDefinitions(text).map((d) => d.name);
  check(
    'every definition shape is found',
    shape(
      [
        'export interface A {}',
        'export type B = string;',
        'export class C {}',
        'export enum D {}',
        'export const enum E {}',
        'export declare interface F {}',
        'export abstract class G {}',
        'export declare const enum H {}',
      ].join('\n')
    ).join() === 'A,B,C,D,E,F,G,H'
  );
  check(
    'blind spots hold: re-exports, export lists, non-exported and indented are not definitions',
    shape(
      [
        "export type { X } from './x.js';",
        "export { Y } from './y.js';",
        'export { Z };',
        'interface Local {}',
        'type Alias = string;',
        '  export interface Indented {}',
        'export default class Anon {}',
        'export const value = 1;',
        'export function fn() {}',
        'export interface Prefix2 {}',
      ].join('\n')
    ).join() === 'Prefix2'
  );
  check(
    'a name must end at a word boundary (Foo vs FooBar are two names)',
    shape('export interface Foo {}\nexport interface FooBar {}').join() === 'Foo,FooBar'
  );

  const scratch = mkdtempSync(path.join(os.tmpdir(), 'type-homonyms-'));
  try {
    const write = (relative, text) => {
      const full = path.join(scratch, 'src', relative);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, text, 'utf8');
    };
    write('a.ts', 'export interface Shared {}\nexport interface OnlyA {}\n');
    write('nested/b.ts', 'export type Shared = string;\nexport class OnlyB {}\n');
    write('nested/c.ts', 'export interface Twice {}\n\nexport type Twice = number;\n');
    write('node_modules/skip.ts', 'export interface OnlyA {}\n');
    write('notes.md', 'export interface OnlyA {}\n');

    const measured = collectDefinitions(path.join(scratch, 'src'), scratch);
    check(
      'a name defined in two files is a homonym',
      measured.sites.get('Shared')?.join() === 'src/a.ts:1,src/nested/b.ts:1'
    );
    check(
      'a name defined twice in ONE file is a homonym',
      measured.sites.get('Twice')?.join() === 'src/nested/c.ts:1,src/nested/c.ts:3'
    );
    check(
      'node_modules and non-.ts files are not walked (OnlyA stays unique)',
      measured.sites.get('OnlyA')?.length === 1
    );
    check('homonymNames is sorted', homonymNames(measured.sites).join() === 'Shared,Twice');

    const clean = evaluate(measured, ['Shared', 'Twice'], 1);
    check(
      'CLEAN: baseline equals the measured set -> no failure text',
      !clean.refused && formatFailure(clean, measured.sites) === null
    );

    const added = evaluate(measured, ['Shared'], 1);
    const addedText = formatFailure(added, measured.sites) ?? '';
    check(
      '(a) a homonym missing from the baseline fails, naming both file:line sites',
      added.added.join() === 'Twice' &&
        addedText.includes('src/nested/c.ts:1') &&
        addedText.includes('src/nested/c.ts:3')
    );

    const stale = evaluate(measured, ['Shared', 'Twice', 'GoneName'], 1);
    const staleText = formatFailure(stale, measured.sites) ?? '';
    check(
      '(b) a baseline entry that is no longer a homonym fails, naming it and the regenerate command',
      stale.stale.join() === 'GoneName' &&
        staleText.includes('GoneName') &&
        staleText.includes('--update-baseline')
    );

    const unique = evaluate(measured, ['Shared', 'Twice', 'OnlyA'], 1);
    check(
      'a baseline entry for a name with ONE definition is stale (OnlyA)',
      unique.stale.join() === 'OnlyA'
    );

    const refused = evaluate(measured, ['Shared', 'Twice'], MIN_DEFINITIONS);
    check(
      'REFUSED: too few definitions is a refusal, not "0 homonyms"',
      refused.refused && (formatFailure(refused, measured.sites) ?? '').includes('REFUSED')
    );

    let missingRootThrew = false;
    try {
      collectDefinitions(path.join(scratch, 'no-such-src'), scratch);
    } catch {
      missingRootThrew = true;
    }
    check(
      'a walk root that does not exist throws rather than reading as an empty tree',
      missingRootThrew
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\n${TAG} self-test: ${failures} case(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n${TAG} SELF-TEST OK: both failure modes, the clean case and the refusal hold\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? 'check';
  try {
    if (mode === '--self-test') {
      runSelfTest();
    } else if (mode === '--update-baseline') {
      handleUpdateBaseline();
    } else if (mode === 'check') {
      handleCheck();
    } else {
      throw new Error(
        `${TAG} Unknown mode "${mode}". Expected: "check", "--update-baseline", or "--self-test".`
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

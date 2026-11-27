// @lifecycle canonical - Joins the retirement ledger to its refusal sites, its test drivers and its dates.
/**
 * Retirement ledger gate.
 *
 * `tooling/contracts/registries/retirements.json` holds one entry per spelling the product once
 * accepted and now refuses. An entry refuses nothing by existing: a refusal site calls
 * `retirementNotice('<id>')` and composes the entry's text into its own message. This gate is
 * what joins the two, so "where is this refusal held" is answered by a command, never by a
 * hand-kept list.
 *
 * Checks, numbered as in the retirement-ledger plan:
 *   1. every entry has at least one refusal site, and every `retirementNotice` call passes a
 *      literal id naming an existing entry. Read from the TypeScript syntax tree of every `.ts`
 *      file under `server/src` and `cli/src`, so a commented-out call or an id quoted in prose is
 *      not a site.
 *   2. every entry has a driver in the one table-driven refusal test (`DRIVERS` in
 *      `tests/unit/retirements/retirement-refusals.test.ts`), which feeds the old spelling to the
 *      real boundary; a driver for an id the ledger does not hold fails too.
 *   4. expiry (`scripts/lib/retirement-expiry.js`): an entry past its `forgetAfter` warns; it
 *      fails once the package's major is greater than the major of its `refusedIn`.
 * Checks 3, 5 and 6 (doc patterns, the generated page, third-state wording) are not here.
 *
 * `--list` prints the log instead: each entry with its dates and its sites as `file:line`.
 *
 * Run: `npm run validate:retirements` · the log: `npm run retirements:list`
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { expiryOutcomes, isoToday } from './lib/retirement-expiry.js';
import { listRetirements, type RetirementEntry } from '../src/shared/utils/retirement-notice.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');
const GATE = 'validate:retirements';

/** Where refusal sites may live, relative to the repository root. */
export const SITE_ROOTS = ['server/src', 'cli/src'] as const;

/** The one table-driven refusal test, and the object literal in it that maps id to driver. */
export const DRIVER_FILE = 'server/tests/unit/retirements/retirement-refusals.test.ts';
export const DRIVER_TABLE = 'DRIVERS';

const SITE_FUNCTION = 'retirementNotice';
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist']);

/** One `retirementNotice(...)` call. `id` is null when the argument is not a string literal. */
export interface RetirementSite {
  readonly id: string | null;
  readonly file: string;
  readonly line: number;
}

/** A failed check, naming the entry (or the site) it is about. */
export interface RetirementFinding {
  readonly check: 1 | 2 | 4;
  readonly subject: string;
  readonly message: string;
}

export interface RetirementCheckInput {
  readonly entries: readonly Pick<RetirementEntry, 'id' | 'refusedIn' | 'forgetAfter'>[];
  readonly sites: readonly RetirementSite[];
  /** Ids the driver table covers, or null when the table could not be found. */
  readonly driverIds: readonly string[] | null;
  readonly today: string;
  readonly packageVersion: string;
}

export interface RetirementCheckResult {
  readonly failures: RetirementFinding[];
  readonly warnings: RetirementFinding[];
}

function isSiteCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === SITE_FUNCTION;
  return ts.isPropertyAccessExpression(callee) && callee.name.text === SITE_FUNCTION;
}

function literalText(node: ts.Expression | undefined): string | null {
  if (node === undefined) return null;
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}

/** Every `retirementNotice(...)` call in one file's syntax tree; comments and strings are not calls. */
export function findRetirementSites(file: string, text: string): RetirementSite[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const sites: RetirementSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isSiteCall(node)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      sites.push({ id: literalText(node.arguments[0]), file, line: line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  if (
    ts.isSatisfiesExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isParenthesizedExpression(node)
  ) {
    return unwrapExpression(node.expression);
  }
  return node;
}

function propertyKey(property: ts.ObjectLiteralElementLike): string | null {
  const name = property.name;
  if (name === undefined) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return null;
}

/**
 * The keys of the `DRIVERS` object literal in the driver test, or null when no such literal
 * exists: a missing table is reported, never read as "no drivers needed".
 */
export function findDriverIds(text: string, file = DRIVER_FILE): string[] | null {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let ids: string[] | null = null;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === DRIVER_TABLE &&
      node.initializer !== undefined
    ) {
      const table = unwrapExpression(node.initializer);
      if (ts.isObjectLiteralExpression(table)) {
        ids = table.properties.map(propertyKey).filter((key): key is string => key !== null);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return ids;
}

/** Check 1: every entry has a site; every site passes a literal id the ledger holds. */
export function checkSites(
  entries: RetirementCheckInput['entries'],
  sites: readonly RetirementSite[]
): RetirementFinding[] {
  const known = new Set(entries.map((entry) => entry.id));
  const sited = new Set(sites.map((site) => site.id));
  const findings: RetirementFinding[] = entries
    .filter((entry) => !sited.has(entry.id))
    .map((entry) => ({
      check: 1,
      subject: entry.id,
      message: `${entry.id}: no refusal site calls ${SITE_FUNCTION}('${entry.id}') under ${SITE_ROOTS.join(' or ')}. Refuse the spelling at its boundary through the entry, or delete the entry.`,
    }));
  for (const site of sites) {
    const at = `${site.file}:${site.line}`;
    if (site.id === null) {
      findings.push({
        check: 1,
        subject: at,
        message: `${at}: ${SITE_FUNCTION}() is called without a string-literal id, which no entry can be joined to.`,
      });
    } else if (!known.has(site.id)) {
      findings.push({
        check: 1,
        subject: site.id,
        message: `${at}: ${SITE_FUNCTION}('${site.id}') names no entry in retirements.json.`,
      });
    }
  }
  return findings;
}

/** Check 2: every entry has a driver in the table test, and the table drives only ledger ids. */
export function checkDrivers(
  entries: RetirementCheckInput['entries'],
  driverIds: readonly string[] | null
): RetirementFinding[] {
  if (driverIds === null) {
    return [
      {
        check: 2,
        subject: DRIVER_FILE,
        message: `${DRIVER_FILE}: no ${DRIVER_TABLE} object literal was found, so no entry can be shown to be driven.`,
      },
    ];
  }
  const driven = new Set(driverIds);
  const known = new Set(entries.map((entry) => entry.id));
  const undriven = entries
    .filter((entry) => !driven.has(entry.id))
    .map<RetirementFinding>((entry) => ({
      check: 2,
      subject: entry.id,
      message: `${entry.id}: no driver in ${DRIVER_FILE} (${DRIVER_TABLE}). Add one that feeds the old spelling to the real boundary and reads the refusal.`,
    }));
  const stray = driverIds
    .filter((id) => !known.has(id))
    .map<RetirementFinding>((id) => ({
      check: 2,
      subject: id,
      message: `${id}: ${DRIVER_TABLE} in ${DRIVER_FILE} drives an id retirements.json does not hold.`,
    }));
  return [...undriven, ...stray];
}

/** Checks 1, 2 and 4 over planted or scanned input; pure. */
export function runRetirementChecks(input: RetirementCheckInput): RetirementCheckResult {
  const expiry = expiryOutcomes(input.entries, {
    today: input.today,
    packageVersion: input.packageVersion,
  });
  const asFinding = (outcome: { id: string; message: string }): RetirementFinding => ({
    check: 4,
    subject: outcome.id,
    message: outcome.message,
  });
  return {
    failures: [
      ...checkSites(input.entries, input.sites),
      ...checkDrivers(input.entries, input.driverIds),
      ...expiry.failures.map(asFinding),
    ],
    warnings: expiry.warnings.map(asFinding),
  };
}

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED_DIRECTORIES.has(entry.name)) return [];
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')
      ? [full]
      : [];
  });
}

/** Every refusal site under the site roots, with repository-relative paths. */
export function scanRefusalSites(repoRoot = REPO_ROOT): RetirementSite[] {
  return SITE_ROOTS.flatMap((root) =>
    listTypeScriptFiles(path.join(repoRoot, root)).flatMap((file) =>
      findRetirementSites(path.relative(repoRoot, file), readFileSync(file, 'utf8'))
    )
  );
}

function readPackageVersion(): string {
  const manifest = JSON.parse(readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8')) as {
    version: string;
  };
  return manifest.version;
}

function printList(entries: readonly RetirementEntry[], sites: readonly RetirementSite[]): void {
  for (const entry of entries) {
    const at = sites
      .filter((site) => site.id === entry.id)
      .map((site) => `${site.file}:${site.line}`);
    console.log(`${entry.id} (${entry.kind})`);
    console.log(`  retired:     ${entry.retired}`);
    console.log(`  replacement: ${entry.replacement}`);
    console.log(`  refusedIn:   ${entry.refusedIn}`);
    console.log(`  forgetAfter: ${entry.forgetAfter}`);
    console.log(`  sites:       ${at.length > 0 ? at.join(', ') : '(none)'}`);
  }
  console.log(`\n${entries.length} retired spelling(s), ${sites.length} refusal site(s).`);
}

function main(): void {
  const entries = listRetirements();
  const sites = scanRefusalSites();
  if (process.argv.includes('--list')) {
    printList(entries, sites);
    return;
  }
  // A scan that found no call at all observed nothing; reporting it as clean would be a silence.
  if (entries.length > 0 && sites.length === 0) {
    console.error(
      `❌ ${GATE}: found no ${SITE_FUNCTION}() call under ${SITE_ROOTS.join(', ')}; the scan is broken.`
    );
    process.exitCode = 1;
    return;
  }
  const { failures, warnings } = runRetirementChecks({
    entries,
    sites,
    driverIds: findDriverIds(readFileSync(path.join(REPO_ROOT, DRIVER_FILE), 'utf8')),
    today: isoToday(),
    packageVersion: readPackageVersion(),
  });
  for (const warning of warnings) console.warn(`⚠️  [check ${warning.check}] ${warning.message}`);
  for (const failure of failures) console.error(`❌ [check ${failure.check}] ${failure.message}`);
  if (failures.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(
    `✅ ${GATE}: ${entries.length} entries, each refused at a site and driven by a test; ${sites.length} site(s), ${warnings.length} past its date`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

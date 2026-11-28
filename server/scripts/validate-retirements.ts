// @lifecycle canonical - Joins the retirement ledger to its refusal sites, its test drivers and its dates.
/**
 * Retirement ledger gate.
 *
 * `tooling/contracts/registries/retirements.json` holds one entry per spelling the product once
 * accepted and now refuses. An entry refuses nothing by existing: a refusal site imports the
 * generated projection (`src/shared/utils/_generated/retirement-notices.ts`) as a namespace,
 * reads the entry's member by name (`retirementNotices.configFileUnversioned` for
 * `config-file-unversioned`) and composes its text into its own message. This gate is what joins
 * the two, so "where is this refusal held" is answered by a command, never by a hand-kept list.
 *
 * Checks, numbered as in the retirement-ledger plan:
 *   1. every entry has at least one refusal site, and every use of the projection reads one
 *      member, by name, that names an existing entry. Read from the TypeScript syntax tree of
 *      every `.ts` file under `server/src` and `cli/src`, so a commented-out read or a name quoted
 *      in prose is not a site, and a named import, a re-export or a computed member is a finding.
 *      An entry refused outside TypeScript declares its sites instead (`refusalSites`): each is a
 *      tracked file that must hold the entry's marker, and those sites satisfy the entry.
 *   2. every entry has a driver in the one table-driven refusal test (`DRIVERS` in
 *      `tests/unit/retirements/retirement-refusals.test.ts`), which feeds the old spelling to the
 *      real boundary; a driver for an id the ledger does not hold fails too.
 *   3. no user-facing text matches an entry's `docPattern`. The text is the set defined once in
 *      `scripts/lib/user-facing-scope.ts` (guides, READMEs, shipped resources, tool-contract
 *      descriptions), read from `git ls-files`; the upgrade page and the changelog are exempt. An
 *      entry whose `docPattern` is null is skipped.
 *   4. expiry (`scripts/lib/retirement-expiry.js`): an entry past its `forgetAfter` warns; it
 *      fails once the package's major is greater than the major of its `refusedIn`.
 *   5. `docs/reference/upgrading.md` and the runtime projection on disk are exactly what
 *      `generate-retirements-doc.ts` renders from the ledger, so a hand edit, a stale file or an
 *      entry present in one and absent from the other fails naming the command to run.
 *   6. no user-facing line and no string the product shows describes a form as old but still
 *      accepted ("still works", "legacy", "deprecated"), and no user-facing or architecture doc
 *      promises a change ("in the next release", "will be removed"):
 *      `scripts/lib/third-state-wording.ts`, with its phrases and exemptions in
 *      `scripts/retirement-wording.json`.
 *
 * `--list` prints the log instead: each entry with its dates and its sites as `file:line`.
 *
 * Run: `npm run validate:retirements` · the log: `npm run retirements:list`
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import {
  GENERATE_COMMAND,
  renderUpgradingPage,
  UPGRADING_PAGE,
} from './generate-retirements-doc.js';
import { expiryOutcomes, isoToday } from './lib/retirement-expiry.js';
import { listRetirements, type RetirementEntry } from './lib/retirement-ledger.js';
import {
  isProjected,
  projectionMember,
  renderRetirementProjection,
  RETIREMENT_PROJECTION,
} from './lib/retirement-projection.js';
import {
  checkWording,
  findScopedWordingHits,
  loadWordingRules,
  scanCodeStrings,
  type WordingRules,
} from './lib/third-state-wording.js';
import { trackedFilesUnder } from './lib/tracked-scope.js';
import {
  listArchitectureFiles,
  listUserFacingFiles,
  readUserFacingLines,
  type UserFacingLine,
} from './lib/user-facing-scope.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');
const GATE = 'validate:retirements';

/** Where refusal sites may live, relative to the repository root. */
export const SITE_ROOTS = ['server/src', 'cli/src'] as const;

/** The one table-driven refusal test, and the object literal in it that maps id to driver. */
export const DRIVER_FILE = 'server/tests/unit/retirements/retirement-refusals.test.ts';
export const DRIVER_TABLE = 'DRIVERS';

/** An import specifier that names the projection, from any directory. */
const PROJECTION_SPECIFIER = /(?:^|\/)_generated\/retirement-notices\.js$/;
const PROJECTION_FILE = `server/${RETIREMENT_PROJECTION}`;
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist']);

/**
 * One read of the projection. `member` is the exported name read, or null when the use names no
 * member statically (a computed member, a named import, a re-export, the namespace passed whole).
 */
export interface RetirementSite {
  readonly member: string | null;
  readonly file: string;
  readonly line: number;
}

/** A failed check, naming the entry (or the site) it is about. */
export interface RetirementFinding {
  readonly check: 1 | 2 | 3 | 4 | 5 | 6;
  readonly subject: string;
  readonly message: string;
}

/** One user-facing file's lines, as `user-facing-scope.ts` reads them. */
export interface ScannedText {
  readonly file: string;
  readonly lines: readonly UserFacingLine[];
}

/**
 * The text of each file an entry declares as a refusal site, keyed by repository-relative path;
 * null (or no key) when the file is not tracked.
 */
export type DeclaredSiteFiles = Readonly<Record<string, string | null>>;

export interface RetirementCheckInput {
  readonly entries: readonly Pick<
    RetirementEntry,
    'id' | 'refusedIn' | 'forgetAfter' | 'docPattern' | 'refusalSites'
  >[];
  readonly sites: readonly RetirementSite[];
  /** Check 1's view of the files entries declare in `refusalSites`. */
  readonly declaredFiles: DeclaredSiteFiles;
  /** Ids the driver table covers, or null when the table could not be found. */
  readonly driverIds: readonly string[] | null;
  /** Every user-facing file, for checks 3 and 6. */
  readonly texts: readonly ScannedText[];
  /** The displayable strings of the code scope, for check 6. */
  readonly codeStrings: readonly ScannedText[];
  /** The architecture pages, read by check 6's promise phrases only; absent reads none. */
  readonly architectureTexts?: readonly ScannedText[];
  /** Check 6's phrases and exemptions. */
  readonly wording: WordingRules;
  /** What the generator renders from the ledger, and the page as it is on disk (null: absent). */
  readonly expectedPage: string;
  readonly upgradingPage: string | null;
  /** What the generator renders as the runtime projection, and the file on disk (null: absent). */
  readonly expectedProjection: string;
  readonly projection: string | null;
  readonly today: string;
  readonly packageVersion: string;
}

export interface RetirementCheckResult {
  readonly failures: RetirementFinding[];
  readonly warnings: RetirementFinding[];
}

function literalText(node: ts.Expression): string | null {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}

function namesProjection(specifier: ts.Expression | undefined): boolean {
  return (
    specifier !== undefined &&
    ts.isStringLiteral(specifier) &&
    PROJECTION_SPECIFIER.test(specifier.text)
  );
}

/**
 * The local names a file binds the projection namespace to, and every import or re-export of the
 * projection in another form: a named or default import, or a re-export, hides which entry a
 * later read takes, so each is reported as a site that names no entry.
 */
function projectionBindings(source: ts.SourceFile): {
  namespaces: Set<string>;
  others: ts.Node[];
} {
  const namespaces = new Set<string>();
  const others: ts.Node[] = [];
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && namesProjection(statement.moduleSpecifier)) {
      others.push(statement);
    }
    if (!ts.isImportDeclaration(statement) || !namesProjection(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings !== undefined && ts.isNamespaceImport(bindings) && !statement.importClause?.name) {
      namespaces.add(bindings.name.text);
    } else {
      others.push(statement);
    }
  }
  return { namespaces, others };
}

/** The member a namespace read names, or undefined when `node` is not a read of a bound name. */
function memberRead(node: ts.Node, namespaces: Set<string>): string | null | undefined {
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const target = node.expression;
    if (!ts.isIdentifier(target) || !namespaces.has(target.text)) return undefined;
    return ts.isPropertyAccessExpression(node)
      ? node.name.text
      : literalText(node.argumentExpression);
  }
  return ts.isIdentifier(node) && namespaces.has(node.text) ? null : undefined;
}

/**
 * Every read of the projection in one file's syntax tree; comments and strings are not reads. A
 * read is `<namespace>.<member>` (or `<namespace>['<member>']`) on a namespace import of the
 * projection; any other use of that namespace, and any other import form, names no entry.
 */
export function findRetirementSites(file: string, text: string): RetirementSite[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const { namespaces, others } = projectionBindings(source);
  const siteAt = (node: ts.Node, member: string | null): RetirementSite => ({
    member,
    file,
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
  });
  const sites = others.map((node) => siteAt(node, null));
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    const member = memberRead(node, namespaces);
    if (member !== undefined) {
      sites.push(siteAt(node, member));
      if (ts.isElementAccessExpression(node)) visit(node.argumentExpression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites.sort((a, b) => a.line - b.line);
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

/** Check 1 for one entry's declared sites: each file is tracked and holds its marker. */
function declaredSiteFindings(
  entry: RetirementCheckInput['entries'][number],
  declaredFiles: DeclaredSiteFiles
): RetirementFinding[] {
  return (entry.refusalSites ?? []).flatMap<RetirementFinding>(({ file, marker }) => {
    const text = declaredFiles[file] ?? null;
    if (text === null) {
      return [
        {
          check: 1,
          subject: entry.id,
          message: `${entry.id}: declares a refusal site in ${file}, which is not a tracked file. Point refusalSites at the file that refuses the spelling, or delete the entry.`,
        },
      ];
    }
    if (text.includes(marker)) return [];
    return [
      {
        check: 1,
        subject: entry.id,
        message: `${entry.id}: ${file} does not hold the marker "${marker}" its refusalSites declares. Restore the refusal, correct the marker, or delete the entry.`,
      },
    ];
  });
}

/**
 * Check 1: every entry has a site, read from the projection or declared and present; every
 * projection read names a ledger entry.
 */
export function checkSites(
  entries: RetirementCheckInput['entries'],
  sites: readonly RetirementSite[],
  declaredFiles: DeclaredSiteFiles
): RetirementFinding[] {
  const known = new Set(entries.map((entry) => projectionMember(entry.id)));
  const read = new Set(sites.map((site) => site.member));
  const findings: RetirementFinding[] = entries
    .filter((entry) => isProjected(entry) && !read.has(projectionMember(entry.id)))
    .map((entry) => ({
      check: 1,
      subject: entry.id,
      message: `${entry.id}: no refusal site reads ${projectionMember(entry.id)} from the retirement projection under ${SITE_ROOTS.join(' or ')}. Refuse the spelling at its boundary through the entry, or delete the entry.`,
    }));
  findings.push(...entries.flatMap((entry) => declaredSiteFindings(entry, declaredFiles)));
  for (const site of sites) {
    const at = `${site.file}:${site.line}`;
    if (site.member === null) {
      findings.push({
        check: 1,
        subject: at,
        message: `${at}: the retirement projection is used without naming one member, which no entry can be joined to. Import it as a namespace and read the entry by name.`,
      });
    } else if (!known.has(site.member)) {
      findings.push({
        check: 1,
        subject: site.member,
        message: `${at}: ${site.member} names no entry in retirements.json.`,
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

/** Check 3: no user-facing line matches an entry's `docPattern`; a null pattern is skipped. */
export function checkDocPatterns(
  entries: RetirementCheckInput['entries'],
  texts: readonly ScannedText[]
): RetirementFinding[] {
  const patterns = entries.flatMap((entry) =>
    entry.docPattern === null ? [] : [{ id: entry.id, pattern: new RegExp(entry.docPattern) }]
  );
  return texts.flatMap(({ file, lines }) =>
    lines.flatMap(({ line, text }) =>
      patterns
        .filter(({ pattern }) => pattern.test(text))
        .map<RetirementFinding>(({ id }) => ({
          check: 3,
          subject: id,
          message: `${file}:${line}: names the retired spelling of ${id}. Describe the current form; the old spelling lives on ${UPGRADING_PAGE}.`,
        }))
    )
  );
}

/** Check 5 for one generated file: on disk it is what the generator renders from the ledger. */
function checkGeneratedFile(
  file: string,
  expected: string,
  onDisk: string | null
): RetirementFinding[] {
  if (onDisk === expected) return [];
  const state = onDisk === null ? 'does not exist' : 'is not what the ledger renders';
  return [
    {
      check: 5,
      subject: file,
      message: `${file} ${state}. It is generated: run \`${GENERATE_COMMAND}\` and commit the result; edit retirements.json, never the generated file.`,
    },
  ];
}

/** Check 5: the upgrade page on disk is what the generator renders from the ledger. */
export function checkUpgradingPage(expected: string, onDisk: string | null): RetirementFinding[] {
  return checkGeneratedFile(UPGRADING_PAGE, expected, onDisk);
}

/**
 * Check 5: the runtime projection on disk is what the generator renders, so an entry the ledger
 * holds and the projection lacks, or the reverse, or a hand-edited text, fails.
 */
export function checkRuntimeProjection(
  expected: string,
  onDisk: string | null
): RetirementFinding[] {
  return checkGeneratedFile(PROJECTION_FILE, expected, onDisk);
}

/**
 * Check 6: third-state wording in user-facing text and in code strings, and promise wording in
 * user-facing text, code strings and the architecture pages, minus exemptions.
 */
export function checkThirdStateWording(
  texts: readonly ScannedText[],
  codeStrings: readonly ScannedText[],
  wording: WordingRules,
  architecture: readonly ScannedText[] = []
): RetirementFinding[] {
  const hits = findScopedWordingHits({ texts, codeStrings, architecture }, wording.phrases);
  return checkWording(hits, wording.exemptions).map((finding) => ({ check: 6, ...finding }));
}

/** Checks 1 to 6 over planted or scanned input; pure. */
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
      ...checkSites(input.entries, input.sites, input.declaredFiles),
      ...checkDrivers(input.entries, input.driverIds),
      ...checkDocPatterns(input.entries, input.texts),
      ...checkUpgradingPage(input.expectedPage, input.upgradingPage),
      ...checkRuntimeProjection(input.expectedProjection, input.projection),
      ...expiry.failures.map(asFinding),
      ...checkThirdStateWording(
        input.texts,
        input.codeStrings,
        input.wording,
        input.architectureTexts
      ),
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

/** The files the entries declare as refusal sites, read when tracked and null when not. */
export function readDeclaredSiteFiles(
  entries: readonly Pick<RetirementEntry, 'refusalSites'>[],
  repoRoot = REPO_ROOT
): Record<string, string | null> {
  const files = [
    ...new Set(entries.flatMap((entry) => (entry.refusalSites ?? []).map((site) => site.file))),
  ];
  if (files.length === 0) return {};
  const tracked = new Set(trackedFilesUnder(files, { cwd: repoRoot }));
  return Object.fromEntries(
    files.map((file) => [
      file,
      tracked.has(file) ? readFileSync(path.join(repoRoot, file), 'utf8') : null,
    ])
  );
}

/** Each declared site as `file:line` of its marker, or the file and why no line was found. */
function declaredSiteLabels(entry: RetirementEntry, declaredFiles: DeclaredSiteFiles): string[] {
  return (entry.refusalSites ?? []).map(({ file, marker }) => {
    const text = declaredFiles[file] ?? null;
    if (text === null) return `${file} (not tracked)`;
    const index = text.split('\n').findIndex((line) => line.includes(marker));
    return index === -1 ? `${file} (marker not found)` : `${file}:${index + 1}`;
  });
}

function readRepoFile(relative: string): string | null {
  const file = path.join(REPO_ROOT, relative);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** Every user-facing file under the shared scope, read; an empty scan is a broken scan. */
export function scanUserFacingText(repoRoot = REPO_ROOT): ScannedText[] {
  return listUserFacingFiles(repoRoot).map((entry) => ({
    file: entry.file,
    lines: readUserFacingLines(repoRoot, entry),
  }));
}

/** Every architecture page, for check 6's promise phrases. */
export function scanArchitectureText(repoRoot = REPO_ROOT): ScannedText[] {
  return listArchitectureFiles(repoRoot).map((entry) => ({
    file: entry.file,
    lines: readUserFacingLines(repoRoot, entry),
  }));
}

function readPackageVersion(): string {
  const manifest = JSON.parse(readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8')) as {
    version: string;
  };
  return manifest.version;
}

function printList(
  entries: readonly RetirementEntry[],
  sites: readonly RetirementSite[],
  declaredFiles: DeclaredSiteFiles
): void {
  let declared = 0;
  for (const entry of entries) {
    const member = projectionMember(entry.id);
    const labels = declaredSiteLabels(entry, declaredFiles);
    declared += labels.length;
    const at = [
      ...sites.filter((site) => site.member === member).map((site) => `${site.file}:${site.line}`),
      ...labels,
    ];
    console.log(`${entry.id} (${entry.kind})`);
    console.log(`  retired:     ${entry.retired}`);
    console.log(`  replacement: ${entry.replacement}`);
    console.log(`  refusedIn:   ${entry.refusedIn}`);
    console.log(`  forgetAfter: ${entry.forgetAfter}`);
    console.log(`  sites:       ${at.length > 0 ? at.join(', ') : '(none)'}`);
  }
  console.log(
    `\n${entries.length} retired spelling(s), ${sites.length} refusal site(s) reading the projection, ${declared} declared outside it.`
  );
}

function main(): void {
  const entries = listRetirements();
  const sites = scanRefusalSites();
  const declaredFiles = readDeclaredSiteFiles(entries);
  if (process.argv.includes('--list')) {
    printList(entries, sites, declaredFiles);
    return;
  }
  // A scan that found no call at all observed nothing; reporting it as clean would be a silence.
  if (entries.length > 0 && sites.length === 0) {
    console.error(
      `❌ ${GATE}: found no read of the retirement projection under ${SITE_ROOTS.join(', ')}; the scan is broken.`
    );
    process.exitCode = 1;
    return;
  }
  const texts = scanUserFacingText();
  if (texts.length === 0) {
    console.error(
      `❌ ${GATE}: the user-facing scope resolved to no tracked file; the scan is broken.`
    );
    process.exitCode = 1;
    return;
  }
  const architectureTexts = scanArchitectureText();
  if (architectureTexts.length === 0) {
    console.error(
      `❌ ${GATE}: docs/architecture/ resolved to no tracked page; the scan is broken.`
    );
    process.exitCode = 1;
    return;
  }
  const codeStrings = scanCodeStrings(REPO_ROOT);
  if (!codeStrings.some((source) => source.lines.length > 0)) {
    console.error(`❌ ${GATE}: the code scope held no string literal; the scan is broken.`);
    process.exitCode = 1;
    return;
  }
  const { failures, warnings } = runRetirementChecks({
    entries,
    sites,
    declaredFiles,
    texts,
    codeStrings,
    architectureTexts,
    wording: loadWordingRules(REPO_ROOT),
    expectedPage: renderUpgradingPage(entries),
    upgradingPage: readRepoFile(UPGRADING_PAGE),
    expectedProjection: renderRetirementProjection(entries),
    projection: readRepoFile(PROJECTION_FILE),
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
  const declared = Object.keys(declaredFiles).length;
  console.log(
    `✅ ${GATE}: ${entries.length} entries, each refused at a site and driven by a test; ${sites.length} site(s) reading the projection and ${declared} declared file(s), ${texts.length} user-facing file(s) free of a retired name, the upgrade page and the runtime projection current, ${warnings.length} past its date; ${codeStrings.length} code file(s) and the user-facing text free of third-state wording, and the same text plus ${architectureTexts.length} architecture page(s) free of promise wording, outside its exemptions`
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

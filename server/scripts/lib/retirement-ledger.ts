// @lifecycle canonical - Loads and validates the retirement ledger for the scripts that read all of it.
/**
 * The retirement ledger, `tooling/contracts/registries/retirements.json`: one entry per spelling
 * the product once accepted and now refuses. This is the full-entry reader, for the readers that
 * need every field: the gate (`validate-retirements.ts`), the generator that writes the upgrade
 * page and the runtime projection (`generate-retirements-doc.ts`), and tests.
 *
 * The product never imports this module. A refusal site reads the generated projection
 * (`src/shared/utils/_generated/retirement-notices.ts`), which holds only the three fields a
 * refusal prints; the ledger's shape is checked here, once per generator or gate run, so a
 * malformed ledger cannot produce a projection. A refusal that lives outside TypeScript is
 * declared on its entry (`refusalSites`) and has no projection member.
 */

import ledgerDocument from '../../tooling/contracts/registries/retirements.json' with { type: 'json' };

/** What kind of spelling an entry retires; the generated upgrade page groups by it. */
const RETIREMENT_KINDS = [
  'environment-variable',
  'config-key',
  'config-file',
  'command-operator',
  'resource-field',
  'folder-layout',
  'transport',
  'tool-parameter',
  'prompt-argument',
] as const;

type RetirementKind = (typeof RETIREMENT_KINDS)[number];

/**
 * A refusal that lives outside TypeScript (a shipped resource script, a hook), where the projection
 * cannot be read: a tracked file and text that file holds at its refusal.
 */
interface DeclaredRefusalSite {
  /** Repository-relative path of a tracked file. */
  readonly file: string;
  /** One line of text the file holds where it refuses the spelling. */
  readonly marker: string;
}

/** One ledger entry, as validated at load. */
export interface RetirementEntry {
  /** Kebab-case, stable: the projection names the entry's constant after it. */
  readonly id: string;
  readonly kind: RetirementKind;
  /** The spelling as a user once wrote it. */
  readonly retired: string;
  /** What to write instead, as a phrase a site can place after "Expected" or "use". */
  readonly replacement: string;
  /** The first release that refused the spelling (`MAJOR.MINOR.PATCH`). */
  readonly refusedIn: string;
  /** ISO date after which the refusal itself is due for deletion. */
  readonly forgetAfter: string;
  /** A regular expression no user-facing text may match outside the generated page, or null. */
  readonly docPattern: string | null;
  /** Why `docPattern` is null; present exactly when it is. */
  readonly docPatternReason?: string;
  /**
   * Where the spelling is refused when no TypeScript site reads the projection. An entry that
   * declares sites has no projection member; the gate checks each file is tracked and holds its
   * marker.
   */
  readonly refusalSites?: readonly DeclaredRefusalSite[];
}

const ENTRY_KEYS = new Set([
  'id',
  'kind',
  'retired',
  'replacement',
  'refusedIn',
  'forgetAfter',
  'docPattern',
  'docPatternReason',
  'refusalSites',
]);
const SITE_KEYS = new Set(['file', 'marker']);
const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** `2027-02-30` matches the pattern but names no day; the round trip through `Date` refuses it. */
function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function compiles(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

function docPatternProblems(entry: Record<string, unknown>): string[] {
  const { docPattern, docPatternReason } = entry;
  if (docPattern === null) {
    return isNonEmptyString(docPatternReason)
      ? []
      : ['docPattern is null, so docPatternReason must say why the spelling cannot be searched'];
  }
  const problems: string[] = [];
  if (!isNonEmptyString(docPattern) || !compiles(docPattern)) {
    problems.push('docPattern must be a regular expression that compiles, or null');
  }
  if (docPatternReason !== undefined) {
    problems.push('docPatternReason is only for an entry whose docPattern is null');
  }
  return problems;
}

/** A path inside the repository, written relative to its root. */
function isRepositoryPath(value: unknown): boolean {
  return isNonEmptyString(value) && !value.startsWith('/') && !value.split('/').includes('..');
}

function siteProblems(site: unknown, at: string): string[] {
  if (!isRecord(site)) return [`${at} must be an object {file, marker}`];
  const problems = Object.keys(site)
    .filter((key) => !SITE_KEYS.has(key))
    .map((key) => `${at}.${key} is not a refusal site field`);
  if (!isRepositoryPath(site['file'])) {
    problems.push(`${at}.file must be a path relative to the repository root`);
  }
  const marker = site['marker'];
  if (!isNonEmptyString(marker) || marker.includes('\n')) {
    problems.push(`${at}.marker must be one non-empty line of text`);
  }
  return problems;
}

function refusalSitesProblems(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length === 0) {
    return ['refusalSites must be a non-empty array of {file, marker}, or absent'];
  }
  return value.flatMap((site, index) => siteProblems(site, `refusalSites[${index}]`));
}

/** Every problem with one entry, each naming the field; empty when the entry is well formed. */
function entryProblems(entry: Record<string, unknown>): string[] {
  const problems = Object.keys(entry)
    .filter((key) => !ENTRY_KEYS.has(key))
    .map((key) => `${key} is not a ledger field`);
  if (typeof entry['id'] !== 'string' || !KEBAB_ID.test(entry['id'])) {
    problems.push('id must be kebab-case');
  }
  if (!RETIREMENT_KINDS.includes(entry['kind'] as RetirementKind)) {
    problems.push(`kind must be one of ${RETIREMENT_KINDS.join(', ')}`);
  }
  for (const field of ['retired', 'replacement'] as const) {
    if (!isNonEmptyString(entry[field])) problems.push(`${field} must be non-empty text`);
  }
  if (typeof entry['refusedIn'] !== 'string' || !RELEASE_VERSION.test(entry['refusedIn'])) {
    problems.push('refusedIn must be a release version MAJOR.MINOR.PATCH');
  }
  if (typeof entry['forgetAfter'] !== 'string' || !isCalendarDate(entry['forgetAfter'])) {
    problems.push('forgetAfter must be an ISO calendar date YYYY-MM-DD');
  }
  return [
    ...problems,
    ...docPatternProblems(entry),
    ...refusalSitesProblems(entry['refusalSites']),
  ];
}

/**
 * Validates a parsed ledger document and returns its entries. Throws one error listing every
 * problem, each prefixed with the entry it belongs to, so a broken ledger is fixed in one pass.
 */
export function parseRetirementLedger(document: unknown): RetirementEntry[] {
  if (!isRecord(document) || !Array.isArray(document['retirements'])) {
    throw new Error('retirements.json must be an object holding a "retirements" array');
  }
  const entries: unknown[] = document['retirements'];
  const problems: string[] = [];
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const label = isRecord(entry) && typeof entry['id'] === 'string' ? entry['id'] : `#${index}`;
    const found = isRecord(entry) ? entryProblems(entry) : ['an entry must be an object'];
    if (seen.has(label)) found.push('id is used by an earlier entry');
    seen.add(label);
    problems.push(...found.map((problem) => `retirements[${index}] (${label}): ${problem}`));
  });
  if (problems.length > 0) {
    throw new Error(`retirements.json is malformed:\n  ${problems.join('\n  ')}`);
  }
  return entries as RetirementEntry[];
}

let validated: readonly RetirementEntry[] | undefined;

/** Every ledger entry, in ledger order; the shape is checked on the first call. */
export function listRetirements(): readonly RetirementEntry[] {
  validated ??= parseRetirementLedger(ledgerDocument);
  return validated;
}

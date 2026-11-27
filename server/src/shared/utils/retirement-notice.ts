// @lifecycle canonical - Loads the retirement ledger and answers each refusal site's text.
/**
 * The retirement ledger, `tooling/contracts/registries/retirements.json`: one entry per spelling
 * the product once accepted and now refuses. A refusal site calls `retirementNotice(id)` and
 * composes the returned text under its own prefix (`Refusing to start:`, a schema issue, a
 * notice), so the replacement sentence is written once, in the ledger. `npm run
 * validate:retirements` joins every entry to its call sites and reports expired entries.
 *
 * The JSON is imported rather than read, so esbuild inlines it into the server bundle and the
 * `cpm` bundle alike. Its shape is checked once, at import: a malformed ledger throws there,
 * naming the entry and the field, before any refusal could print half a sentence.
 */

import ledgerDocument from '../../../tooling/contracts/registries/retirements.json' with { type: 'json' };

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
] as const;

type RetirementKind = (typeof RETIREMENT_KINDS)[number];

/** One ledger entry, as validated at load. */
export interface RetirementEntry {
  /** Kebab-case, stable: the literal argument a refusal site passes to `retirementNotice`. */
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
}

/** The text a refusal site composes under its own prefix. */
export interface RetirementNotice {
  readonly retired: string;
  readonly replacement: string;
  readonly refusedIn: string;
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
]);
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
  return [...problems, ...docPatternProblems(entry)];
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

const RETIREMENTS: readonly RetirementEntry[] = parseRetirementLedger(ledgerDocument);

/** Every ledger entry, in ledger order. */
export function listRetirements(): readonly RetirementEntry[] {
  return RETIREMENTS;
}

/**
 * The retired spelling, its replacement and the first refusing release, for the site that refuses
 * it. An id with no entry throws: a refusal that cannot name its replacement is a defect, and
 * `validate:retirements` reports the same call statically.
 */
export function retirementNotice(id: string): RetirementNotice {
  const entry = RETIREMENTS.find((candidate) => candidate.id === id);
  if (entry === undefined) {
    throw new Error(`retirementNotice: retirements.json has no entry '${id}'`);
  }
  return { retired: entry.retired, replacement: entry.replacement, refusedIn: entry.refusedIn };
}

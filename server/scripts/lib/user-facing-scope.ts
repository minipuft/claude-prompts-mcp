// @lifecycle canonical - The one definition of which tracked text a user reads, as data and a reader.
/**
 * The text a user reads, defined once. A gate that asks "does user-facing text say X" takes its
 * file set and its lines from here, so the question has one answer and a second check does not
 * re-derive the set.
 *
 * The set is built from `git ls-files`, never from a directory walk: an untracked file cannot
 * enter, and no ignore rule can remove a tracked one (`tracked-scope.js` records the incident).
 *
 * Three shapes of text, one reader each:
 *   - `text`: a file whose every line is read as written (markdown, and the resource files a
 *     prompt, gate or framework ships).
 *   - `contract`: a tool contract, where only the description strings are read; its parameter
 *     names and enum values are the tool's own surface and are not prose.
 *   - exempt: the generated upgrade page, which is where a retired name is meant to be read, and
 *     the changelog, which is the record of what changed.
 *
 * The architecture pages are not in the set: they are contributor text that names old rows and
 * old schemas on purpose. `listArchitectureFiles` returns them for the one question they share
 * with user-facing text, whether a page promises a change instead of describing the product.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { trackedFilesUnder } from './tracked-scope.js';

export interface UserFacingScope {
  /** Tracked files read in full, by exact repository-relative path. */
  readonly files: readonly string[];
  /** Tracked trees read in full: files under `root` with one of `extensions`, minus `except`. */
  readonly trees: readonly {
    readonly root: string;
    readonly extensions: readonly string[];
    readonly except: readonly string[];
  }[];
  /** Tool contracts: the JSON files directly under `directory`; only `keys` hold prose. */
  readonly contracts: { readonly directory: string; readonly keys: readonly string[] };
  /** Read by no gate that takes its set from here. */
  readonly exempt: readonly string[];
}

const USER_FACING_SCOPE: UserFacingScope = {
  files: ['README.md', 'server/README.md', 'cli/README.md', 'CONTRIBUTING.md', 'hooks/README.md'],
  trees: [
    {
      root: 'docs/',
      extensions: ['.md'],
      except: ['docs/adr/', 'docs/architecture/'],
    },
    {
      root: 'server/resources/',
      extensions: ['.md', '.yaml', '.yml', '.json', '.txt'],
      except: [],
    },
  ],
  contracts: {
    directory: 'server/tooling/contracts/',
    keys: ['description', 'shortDescription', 'summary'],
  },
  exempt: ['docs/reference/upgrading.md', 'CHANGELOG.md'],
};

/** Contributor pages read only for promise wording; see the module header. */
const ARCHITECTURE_TREE: UserFacingScope['trees'][number] = {
  root: 'docs/architecture/',
  extensions: ['.md'],
  except: [],
};

/** How a file's lines are read. */
type UserFacingKind = 'text' | 'contract';

export interface UserFacingFile {
  /** Repository-relative, forward slashes. */
  readonly file: string;
  readonly kind: UserFacingKind;
}

/** One line of user-facing text with its 1-based line number in the file. */
export interface UserFacingLine {
  readonly line: number;
  readonly text: string;
}

function isUnderTree(file: string, tree: UserFacingScope['trees'][number]): boolean {
  return (
    file.startsWith(tree.root) &&
    tree.extensions.some((extension) => file.endsWith(extension)) &&
    !tree.except.some((prefix) => file.startsWith(prefix))
  );
}

function isContract(file: string, contracts: UserFacingScope['contracts']): boolean {
  return (
    file.startsWith(contracts.directory) &&
    file.endsWith('.json') &&
    !file.slice(contracts.directory.length).includes('/')
  );
}

/**
 * Classifies tracked paths against a scope; pure, so a test plants paths without a repository.
 * A path in no shape, or exempt, is left out.
 */
export function selectUserFacingFiles(
  tracked: readonly string[],
  scope: UserFacingScope = USER_FACING_SCOPE
): UserFacingFile[] {
  const selected: UserFacingFile[] = [];
  for (const file of tracked) {
    if (scope.exempt.includes(file)) continue;
    if (isContract(file, scope.contracts)) {
      selected.push({ file, kind: 'contract' });
    } else if (scope.files.includes(file) || scope.trees.some((tree) => isUnderTree(file, tree))) {
      selected.push({ file, kind: 'text' });
    }
  }
  return selected;
}

/** Every user-facing file the index holds, from `git ls-files`. */
export function listUserFacingFiles(
  repoRoot: string,
  scope: UserFacingScope = USER_FACING_SCOPE
): UserFacingFile[] {
  const prefixes = [
    ...scope.files,
    ...scope.trees.map((tree) => tree.root),
    scope.contracts.directory,
  ];
  return selectUserFacingFiles(trackedFilesUnder([...prefixes], { cwd: repoRoot }), scope);
}

/** The tracked architecture pages, each read in full as text; pure over the paths given. */
function selectArchitectureFiles(tracked: readonly string[]): UserFacingFile[] {
  return tracked
    .filter((file) => isUnderTree(file, ARCHITECTURE_TREE))
    .map((file) => ({ file, kind: 'text' as const }));
}

/** Every architecture page the index holds, from `git ls-files`. */
export function listArchitectureFiles(repoRoot: string): UserFacingFile[] {
  return selectArchitectureFiles(trackedFilesUnder([ARCHITECTURE_TREE.root], { cwd: repoRoot }));
}

/**
 * A contract's prose lines: the string value of each prose key, one per line, as the user reads
 * it (JSON escapes resolved, an embedded newline kept as one line of its own).
 */
function contractLines(text: string, keys: readonly string[]): UserFacingLine[] {
  const keyed = new RegExp(`^\\s*"(?:${keys.join('|')})"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`);
  return text.split('\n').flatMap((raw, index) => {
    const match = keyed.exec(raw);
    if (match?.[1] === undefined) return [];
    const value: unknown = JSON.parse(match[1]);
    return typeof value === 'string'
      ? value.split('\n').map((piece) => ({ line: index + 1, text: piece }))
      : [];
  });
}

/** The lines of one file a user reads. */
function userFacingLines(
  kind: UserFacingKind,
  text: string,
  scope: UserFacingScope = USER_FACING_SCOPE
): UserFacingLine[] {
  if (kind === 'contract') return contractLines(text, scope.contracts.keys);
  return text.split('\n').map((piece, index) => ({ line: index + 1, text: piece }));
}

/** Reads a listed file and returns its user-facing lines. */
export function readUserFacingLines(repoRoot: string, entry: UserFacingFile): UserFacingLine[] {
  return userFacingLines(entry.kind, readFileSync(path.join(repoRoot, entry.file), 'utf8'));
}

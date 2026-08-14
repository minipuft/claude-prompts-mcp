/**
 * What a validation step READS — derived from its source, not asserted by its author.
 *
 * Every gate reads some stand-in for the property it claims. The stand-in gets chosen for
 * availability and then quietly becomes the definition, and nobody re-asks whether it is still
 * the thing. Measured across this repo, that single substitution accounts for most of the gates
 * that were green while their subject was broken:
 *
 *   claim                        read instead                    escaped
 *   "the code compiles"          the working tree                HEAD (E7 — `typecheck:committed`)
 *   "shipped content is clean"   a filesystem walk               untracked files reddening it (E6)
 *   "links resolve"              `git ls-files`                  files a move had just created
 *   "a plan row's files exist"   a hand-written ✓                "I edited" ≠ "it is committed" (E11)
 *
 * None of those are subtle once the substrate is written down beside the claim. All of them were
 * invisible while it was not. So `SUITE` declares `reads` per step and this module re-derives it,
 * because a declaration nobody re-measures is the same class of artifact as the ✓ that started
 * this — true when written, unchecked afterwards.
 *
 * DERIVATION IS A SUPERSET, AND DELIBERATELY SO. The signals below are lexical: a script that
 * mentions `readFileSync` anywhere reports `file`, whether or not that call is reachable in suite
 * mode. A superset can only produce false ALARMS, which are cheap — someone reads the script and
 * fixes the declaration. Narrowing it to reachable calls would need a call-graph and would produce
 * false SILENCE, which is the failure this file exists to prevent.
 *
 * UNRESOLVABLE THROWS. The prototype of this module reported `none` for two steps: one whose
 * npm command resolves to `../scripts/` rather than `scripts/`, and one whose `git ls-files` usage
 * lives in an imported helper. Both under-reported silently, which is precisely the value-dead
 * shape `validate:no-phantom-columns` documents as its own blind spot — a checker that names a
 * thing and always yields nothing. A step whose source cannot be located is an error here, never
 * an empty result.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

/**
 * The vocabulary. Each value names a DIFFERENT set of bytes, and the differences are exactly
 * where the failures above live — `tracked` and `head` disagree about a staged file, `tracked`
 * and `walk` disagree about an untracked one.
 */
export const SUBSTRATE = Object.freeze({
  /** Enumerates through the git index (`git ls-files`). A `git add`ed file is in scope; HEAD is not. */
  TRACKED: 'tracked',
  /** Reads STAGED content (`--cached`, `git show :file`) rather than what is on disk. */
  INDEX: 'index',
  /** Reads the COMMITTED state — `git show HEAD:`, or a detached worktree. */
  HEAD: 'head',
  /** Enumerates the working tree directly (readdir/glob). Sees untracked files. */
  WALK: 'walk',
  /** Reads working-tree file CONTENT. */
  FILE: 'file',
  /** Delegates to another process, whose substrate is its own and is not derived here. */
  SPAWN: 'spawn',
  /**
   * Reads no artifact at all — only declarations imported from source.
   *
   * `validate:table-contracts` is the pure case: zero fs calls, it compares a contract module
   * against an embedded DDL constant. This value earns its place by predicting a blind spot the
   * repo had already found by hand — `sqlite-persistence.md` documents that
   * `validate:no-phantom-columns` catches declaration-dead columns and not VALUE-dead ones. That
   * is not a quirk of that gate; it is what `declared` means. A gate reading declarations can
   * never observe what a writer binds at runtime, and now says so before someone rediscovers it.
   */
  DECLARED: 'declared',
});

const VALUES = new Set(Object.values(SUBSTRATE));

/**
 * Lexical signals. Ordered by specificity so `--cached` is not merely `tracked`.
 *
 * `walk` deliberately includes a bare `walk(`/`collect(` call: several scripts define a local
 * recursive directory walker with exactly that name, and matching only `readdirSync` would miss
 * the helper while catching its body — reporting the signal for the file that defines it and not
 * for a file that imports it.
 */
const SIGNALS = [
  [SUBSTRATE.INDEX, /--cached\b|git show :|['"]:(?![/\\])[\w./-]+['"]/],
  // `HEAD:` must be quoted — a git revision reaches a process as a string argument. Unquoted it
  // also matches this module's own `HEAD: 'head'` vocabulary key, which is a property name and
  // reads nothing. Self-reference is the recurring hazard in a module that pattern-matches source.
  [SUBSTRATE.HEAD, /['"`]HEAD:|show\s+HEAD|rev-parse\s+HEAD|worktree\s+add|diff-tree/],
  [SUBSTRATE.TRACKED, /ls-files|trackedFilesUnder/],
  [SUBSTRATE.WALK, /readdir\b|readdirSync|globSync|opendir\b|\bwalk\(|\bcollect\(/],
  // The PROMISES API counts. Matching only the `*Sync` spellings classified
  // `verify:action-metadata` as reading nothing, because it imports `readFile` from
  // `node:fs/promises` — a silent under-report, and the one direction this module forbids. Async
  // file access is still file access; `\b` covers both spellings in one pattern.
  [SUBSTRATE.FILE, /readFile\b|readFileSync|existsSync|statSync|\baccess\(|createReadStream/],
  [SUBSTRATE.SPAWN, /spawnSync|execSync|execFileSync|\bnpx\b|\bnpm run\b/],
];

/** `import ... from './lib/x.js'` — the only import shape the scripts use for shared helpers. */
const LOCAL_IMPORT = /from\s+['"](\.\.?\/[\w./-]+\.[cm]?js)['"]/g;

/**
 * A token inside a regex literal is a PATTERN, not an operation.
 *
 * This module found the case in itself on its first run: `validate:suite-membership` imports it,
 * import-following reached this file, and the SIGNALS table above — which literally contains
 * `HEAD:` and `readdir` as search patterns — reported that the membership gate reads HEAD and
 * walks directories. It does neither.
 *
 * That is not a tolerable false alarm. Everywhere else a superset is the safe direction, because
 * an over-report costs a reading and an under-report costs a silent gap. Here it is different:
 * the declaration must EQUAL the derivation, so an over-report forces someone to declare a
 * substrate the gate does not have, which corrupts the ledger the whole mechanism exists to keep
 * honest. A wrong entry is worse than a missing one.
 *
 * Stripping is applied ONLY to the text used for signal matching. Import extraction runs on the
 * raw source, because a path like `./lib/exception-hygiene.js` contains `/lib/`, which is
 * indistinguishable from a regex literal by shape alone — stripping first would sever the import
 * graph and re-introduce the under-report this file was built to prevent.
 */
const REGEX_LITERAL = /\/(?![/*])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n])+\/[dgimsuvy]*/g;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /(^|[^:])\/\/[^\n]*/g;

/**
 * Reduce source to the text that could actually perform an operation.
 *
 * Comments go first, and they matter more than the regex literals did: the false `head` and
 * `walk` on the membership gate survived regex-stripping and turned out to come from THIS file's
 * own prose — the paragraph explaining that `head` means `git show HEAD:` contains the token it
 * describes. A module that documents what it searches for will always trip its own search.
 *
 * `LINE_COMMENT` refuses a `//` preceded by `:` so that a `https://` inside a real string is not
 * mistaken for the start of a comment and used to delete the rest of the line.
 */
function operationalText(text) {
  return text.replace(BLOCK_COMMENT, ' ').replace(LINE_COMMENT, '$1 ').replace(REGEX_LITERAL, ' ');
}

/**
 * Resolve an npm command to the script file it runs.
 *
 * Returns null when the command names no script file at all (ruff, prettier and friends), which
 * is a legitimate shape — those derive from the command string. Throws only when the command
 * NAMES a script that cannot be found, because that is drift rather than a different shape.
 */
export function resolveScriptFile(command) {
  const match = command.match(/(?:\.\.\/)?scripts\/[\w./-]+\.[cm]?[jt]s/);
  if (!match) return null;
  const candidates = [
    path.join(SERVER_ROOT, match[0]),
    path.join(REPO_ROOT, match[0].replace(/^\.\.\//, '')),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `substrate: command names ${match[0]} but no such file exists (looked in server/ and repo root). ` +
        `A step whose source cannot be located cannot be measured, and reporting no signals for it ` +
        `would be a silent under-report.`
    );
  }
  return found;
}

/**
 * Every signal reachable from `text`, following local imports so a helper's substrate counts as
 * its caller's. `tracked-scope.js` exists precisely so several gates share one `git ls-files`
 * call; not following it reports `none` for every one of them.
 */
function signalsFrom(text, fromFile, seen) {
  const found = new Set();
  const operations = operationalText(text);
  for (const [name, pattern] of SIGNALS) {
    if (pattern.test(operations)) found.add(name);
  }
  if (fromFile === null) return found;
  for (const match of text.matchAll(LOCAL_IMPORT)) {
    const resolved = path.resolve(path.dirname(fromFile), match[1]);
    if (seen.has(resolved) || !existsSync(resolved)) continue;
    seen.add(resolved);
    for (const signal of signalsFrom(readFileSync(resolved, 'utf8'), resolved, seen)) {
      found.add(signal);
    }
  }
  return found;
}

/**
 * Derive the substrate of one npm command. Sorted for stable comparison against a declaration.
 */
export function deriveSubstrate(command) {
  const file = resolveScriptFile(command);
  if (file === null) {
    // A command that names no script of ours runs someone else's binary — ruff, prettier, tsc.
    // That IS a spawn by definition, not an inference, and the delegate's own substrate is not
    // derivable from this repository's source.
    const signals = signalsFrom(command, null, new Set());
    signals.add(SUBSTRATE.SPAWN);
    return [...signals].sort();
  }
  const text = `${command}\n${readFileSync(file, 'utf8')}`;
  const signals = signalsFrom(text, file, new Set());
  // No fs and no git means the step read nothing off disk — it compared declarations it imported.
  // Returning an empty set here instead would be the silent under-report this module forbids.
  if (signals.size === 0) signals.add(SUBSTRATE.DECLARED);
  return [...signals].sort();
}

/**
 * Compare a step's declared `reads` against the derived set.
 *
 * Equality, not containment: a declaration that omits a real signal hides the substrate the step
 * actually depends on, and one that claims a signal the source does not contain is a claim about
 * code that is not there. Both are the drift this is built to catch.
 */
export function auditSubstrate(steps, commandFor) {
  const findings = [];
  for (const step of steps) {
    const command = commandFor(step.script);
    if (command === undefined) {
      findings.push({ step: step.script, problem: 'no npm script defines this step' });
      continue;
    }
    if (!Array.isArray(step.reads) || step.reads.length === 0) {
      findings.push({ step: step.script, problem: 'declares no `reads` substrate' });
      continue;
    }
    const unknown = step.reads.filter((value) => !VALUES.has(value));
    if (unknown.length > 0) {
      findings.push({
        step: step.script,
        problem: `unknown substrate value(s): ${unknown.join(', ')}`,
      });
      continue;
    }
    const derived = deriveSubstrate(command);
    const declared = [...step.reads].sort();
    if (derived.join(',') !== declared.join(',')) {
      findings.push({
        step: step.script,
        problem: `declares [${declared.join(', ')}] but source contains [${derived.join(', ')}]`,
      });
    }
  }
  return findings;
}

/** The repo-root-relative git binary check, so a caller can skip cleanly outside a checkout. */
export function insideGitRepo() {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: REPO_ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

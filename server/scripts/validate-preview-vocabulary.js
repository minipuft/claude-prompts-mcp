#!/usr/bin/env node
/**
 * `dry_run` is gone. This is what stops it coming back.
 *
 * P2.2 replaced a boolean modifier with an action (`action:"preview"` + `preview_action`, and
 * `preview` + `preview_detail` on `skills_sync`). Replacing the sites it was found at closes those
 * instances; the vocabulary is a CLASS, and a class is not closed until something fails when a new
 * member appears. The next `dry_run` will not arrive as a copy of an old one — it will arrive as a
 * new parameter on a new surface, named by whoever reaches for the obvious word.
 *
 * WHAT THIS MEASURES, precisely: no identifier, object key, string literal, JSON key, CLI flag or
 * HTTP route segment in the surfaces this repo owns is named `dry_run`, `dryRun` or `dry-run`.
 *
 * WHAT IT DOES NOT MEASURE: prose. Comments and documentation that EXPLAIN the removal are the
 * opposite of a regression, and a grep that cannot tell the two apart would force the explanation
 * to be deleted in order to pass — which is how a decision loses its reason. So comments are
 * stripped from source before matching, and prose files match only on code-shaped occurrences.
 *
 * The distinction is load-bearing rather than fussy: at the time of writing, `src/` holds nine
 * comments naming `dry_run` and zero references to it, and a token-presence probe would call that
 * a failure. Naming the property the probe measures is the difference between the two answers.
 *
 * Homonyms are real here and are NOT exemptions — they are a different word. `npm ci --dry-run`,
 * `renovate --dry-run=extract` and a gate's prose about "the founding dry-run" (a rehearsal) are
 * other people's vocabulary or plain English; this repo's own parameter is what was removed. Scope
 * is therefore the directories this repo's tool and CLI surfaces live in, not the whole tree.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

/**
 * Directories whose contents ARE this repo's tool, CLI and HTTP surface.
 *
 * `server/scripts/` is deliberately absent: four validators there quote `npm ci --dry-run` and
 * `renovate --dry-run=extract` in comments, which are those tools' flags and not ours. Including
 * the directory would make the gate's first act be to exempt four true statements.
 */
const SCANNED = [
  path.join(SERVER_ROOT, 'src'),
  path.join(SERVER_ROOT, 'tests'),
  path.join(SERVER_ROOT, 'tooling', 'contracts'),
  path.join(REPO_ROOT, 'cli', 'src'),
];

/** Documentation that describes the surface, where a stale flag misinstructs an operator. */
const SCANNED_DOCS = [
  path.join(REPO_ROOT, 'docs'),
  path.join(REPO_ROOT, 'CLAUDE.md'),
  path.join(REPO_ROOT, 'AGENTS.md'),
  path.join(REPO_ROOT, 'CONTRIBUTING.md'),
  path.join(SERVER_ROOT, 'skills-sync.example.yaml'),
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.json']);
const PROSE_EXTENSIONS = new Set(['.md', '.yaml', '.yml']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '__snapshots__']);

/** The removed vocabulary, in every spelling a parameter, flag or route ever wore. */
const VOCABULARY = /\bdry[_-]?run\b/i;

/**
 * Stamped exemptions. An entry names the file, why the word survives there, and the observation
 * that retires it. Empty is the intended steady state.
 *
 * Every entry is re-checked on each run: an exemption whose file no longer contains the word is
 * itself a failure, because a satisfied exemption reads as coverage while covering nothing.
 */
const EXEMPTIONS = [
  {
    file: 'CHANGELOG.md',
    reason: 'historical record — cleanup-standards.md names it an explicit exception',
    retiresWhen: 'never; a changelog describes what WAS true',
  },
];

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  if (!statSync(dir).isDirectory()) return [dir];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    out.push(...(statSync(full).isDirectory() ? walk(full) : [full]));
  }
  return out;
}

/**
 * Remove `//` and block comments so a line that EXPLAINS the removal is not read as a use of it.
 *
 * Deliberately crude — it does not parse strings, so a `//` inside a string literal truncates the
 * line. That errs toward missing a finding rather than inventing one, and every real occurrence
 * this gate exists to catch is a declaration or a key, not a URL inside a string.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

/**
 * In prose, only CODE-SHAPED occurrences count. A sentence about the removal is prose and passes.
 *
 * `dry_run` and `dryRun` are unambiguous — no English sentence spells it that way — so they match
 * anywhere. The hyphenated `dry-run` matches ONLY as a CLI flag or a URL segment, because "a
 * dry-run" is ordinary English and this repo does not own the phrase.
 *
 * A "backticked token anywhere on the line" rule was tried first and was wrong: on a line with
 * several inline-code spans, `[^`]*` matches the PROSE BETWEEN two of them, so
 * `` `MCP_CATALOG_WRITE_TOKEN` gates dry-run/apply `` read as a backticked token. It flagged two
 * true sentences for a reason unrelated to why they needed changing.
 */
const PROSE_CODE_SHAPED = /(\bdry_run\b)|(\bdryRun\b)|(--dry-run\b)|(\/dry-run\b)/;

/**
 * The one legitimate reason for documentation to still spell `dry_run`: telling an upgrading
 * reader what the parameter they are searching for became.
 *
 * A migration note is the highest-value place for the old name to appear, and deleting it to
 * satisfy a gate would make the gate the reason a reader cannot find the answer. So it is allowed
 * per LINE and only with this marker, which costs a deliberate act and shows up under `rg`.
 *
 * Marked, not exempted, and counted: the run reports how many exist, so they cannot accumulate
 * quietly into a second vocabulary living in the docs.
 *
 * Scope is the PARAGRAPH the marker opens: blank lines between the marker and the paragraph are
 * skipped, and the scope closes at the first blank line AFTER content. Two narrower rules were
 * tried and both failed on real input — line-scoped made a two-sentence explanation need the
 * marker twice, and "closes at the next blank line" was closed immediately by Prettier, which puts
 * a blank line after an HTML comment. A marker the repo's own formatter disarms is worse than no
 * marker, because it looks applied.
 */
const MIGRATION_NOTE = /preview-vocabulary:\s*migration-note/;

function scanFile(file, { prose }) {
  const findings = [];
  const notes = [];
  const raw = readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  const haystack = (prose ? raw : stripComments(raw)).split('\n');
  const pattern = prose ? PROSE_CODE_SHAPED : VOCABULARY;

  // 'off' | 'armed' (marker seen, waiting for the paragraph) | 'open' (inside it)
  let marker = 'off';
  haystack.forEach((line, i) => {
    const source = lines[i] ?? line;
    const blank = source.trim() === '';
    if (MIGRATION_NOTE.test(source)) marker = 'armed';
    else if (blank) marker = marker === 'open' ? 'off' : marker;
    else if (marker === 'armed') marker = 'open';

    const markedParagraph = marker === 'armed' || marker === 'open';

    if (!pattern.test(line)) return;
    (markedParagraph ? notes : findings).push({
      file,
      line: i + 1,
      text: line.trim().slice(0, 160),
    });
  });
  return { findings, notes };
}

function collect() {
  const findings = [];
  const notes = [];
  const absorb = (result) => {
    findings.push(...result.findings);
    notes.push(...result.notes);
  };

  for (const root of SCANNED) {
    for (const file of walk(root)) {
      if (!SOURCE_EXTENSIONS.has(path.extname(file))) continue;
      absorb(scanFile(file, { prose: false }));
    }
  }
  for (const root of SCANNED_DOCS) {
    for (const file of walk(root)) {
      if (!PROSE_EXTENSIONS.has(path.extname(file))) continue;
      absorb(scanFile(file, { prose: true }));
    }
  }
  return { findings, notes };
}

/** An exemption whose condition no longer holds is a finding, not a courtesy. */
function checkSatisfiedExemptions() {
  const satisfied = [];
  for (const exemption of EXEMPTIONS) {
    const full = path.join(REPO_ROOT, exemption.file);
    if (!existsSync(full)) {
      satisfied.push(`${exemption.file} — the file no longer exists`);
      continue;
    }
    if (!VOCABULARY.test(readFileSync(full, 'utf8'))) {
      satisfied.push(`${exemption.file} — no longer contains the word (${exemption.retiresWhen})`);
    }
  }
  return satisfied;
}

function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();

  const exempt = new Set(EXEMPTIONS.map((e) => path.join(REPO_ROOT, e.file)));
  const collected = collect();
  const findings = collected.findings.filter((f) => !exempt.has(f.file));
  const notes = collected.notes.filter((f) => !exempt.has(f.file));
  const satisfied = checkSatisfiedExemptions();

  if (findings.length > 0) {
    console.error(
      `[preview-vocabulary] FAIL: ${findings.length} site(s) still name the removed \`dry_run\` ` +
        `vocabulary.\n` +
        'The replacements are `action:"preview"` + `preview_action` (resource_manager) and ' +
        '`preview` + `preview_detail` (skills_sync). If this is a NEW surface, name it with those ' +
        'rather than reintroducing a boolean whose polarity a caller can invert:\n'
    );
    for (const f of findings) {
      console.error(`  ${path.relative(REPO_ROOT, f.file)}:${f.line}: ${f.text}`);
    }
  }

  if (satisfied.length > 0) {
    console.error(
      `\n[preview-vocabulary] FAIL: ${satisfied.length} exemption(s) are satisfied and must be ` +
        'deleted — an exemption for a condition that no longer holds reads as coverage:\n'
    );
    for (const s of satisfied) console.error(`  ${s}`);
  }

  if (findings.length > 0 || satisfied.length > 0) process.exit(1);

  console.log(
    `[preview-vocabulary] OK: no \`dry_run\` declaration, key, flag or route across ` +
      `${SCANNED.length} source roots and ${SCANNED_DOCS.length} documentation roots ` +
      `(${EXEMPTIONS.length} stamped exemption(s), all still needed; ${notes.length} marked ` +
      `migration note(s)).`
  );
}

/**
 * Prove each predicate can fail AND can pass, on both sides of the comment/prose boundary this
 * gate's whole value rests on. A gate that has only ever said OK is unverified, not passing.
 */
function runSelfTest() {
  const failures = [];

  const declaration = '  dry_run?: boolean;';
  const jsonKey = '      "name": "dry_run",';
  const replacement = '  preview_action?: PreviewableAction;';
  if (!VOCABULARY.test(declaration)) failures.push('missed a `dry_run` declaration');
  if (!VOCABULARY.test(jsonKey)) failures.push('missed a `dry_run` JSON key');
  if (VOCABULARY.test(replacement)) failures.push('flagged the replacement parameter');

  // The distinction the gate exists to make: an explanation is not a reintroduction.
  const explanation = stripComments('  // `dry_run` was removed because a boolean inverts.\n');
  const blockExplanation = stripComments('/**\n * Preview replaced the `dry_run` boolean.\n */\n');
  if (VOCABULARY.test(explanation)) failures.push('a line comment explaining the removal failed');
  if (VOCABULARY.test(blockExplanation))
    failures.push('a block comment explaining the removal failed');
  if (!VOCABULARY.test(stripComments(declaration)))
    failures.push('comment stripping swallowed a real declaration');

  // Prose: a flag or a backticked token counts; a sentence about the removal does not.
  if (!PROSE_CODE_SHAPED.test('Add `--dry-run` to any of them.'))
    failures.push('prose predicate missed a CLI flag');
  if (!PROSE_CODE_SHAPED.test('| `POST` | `/api/v1/authority/prompts/{id}/dry-run` |'))
    failures.push('prose predicate missed an HTTP route');
  if (PROSE_CODE_SHAPED.test('The dry run flag was removed in favour of a preview action.'))
    failures.push('prose predicate flagged a sentence about the removal');
  if (!MIGRATION_NOTE.test('<!-- preview-vocabulary: migration-note -->'))
    failures.push('migration-note marker is not recognised');
  if (MIGRATION_NOTE.test('a note about the preview vocabulary'))
    failures.push('migration-note marker matched ordinary prose');
  if (PROSE_CODE_SHAPED.test('`MCP_CATALOG_WRITE_TOKEN` gates dry-run/apply and `/api/v1/tools/*`'))
    failures.push('prose predicate matched the gap between two inline-code spans');
  if (!PROSE_CODE_SHAPED.test('| `dry_run` | Preview an update |'))
    failures.push('prose predicate missed a snake_case parameter in a table');

  if (failures.length > 0) {
    for (const failure of failures)
      console.error(`[preview-vocabulary] SELF-TEST FAIL: ${failure}`);
    process.exit(1);
  }
  console.log(
    '[preview-vocabulary] SELF-TEST OK: catches declarations, keys, flags and routes; ignores ' +
      'comments and prose that explain the removal.'
  );
}

main();

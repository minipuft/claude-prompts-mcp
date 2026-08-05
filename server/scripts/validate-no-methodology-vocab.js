#!/usr/bin/env node

/**
 * Guards the methodology -> framework vocabulary rename against recurrence.
 *
 * Allowlist, not zero-tolerance. The rename left deliberate survivors: back-compat folds that
 * must keep naming the old spelling, the archived plan and changelog, and the historical record
 * of past renames. A zero check would have to be disabled on day one, and a disabled check is
 * worse than none.
 *
 * Every allowlist entry carries a RETIREMENT CONDITION. An entry whose condition has come true is
 * a deletion waiting to happen, not a permanent exemption.
 *
 * Exit 0 when every hit is allowlisted; exit 1 with the offending lines otherwise.
 */

import { execSync } from 'node:child_process';

/** Paths excluded wholesale, with why. */
const EXCLUDED_PATHS = [
  // Archived record of the sweep itself; rewriting it would falsify the history it exists to keep.
  { glob: '**/plans/**', reason: 'archived plan files' },
  { glob: 'CHANGELOG.md', reason: 'historical release record' },
  { glob: 'cli/dist/**', reason: 'build artifact, regenerated' },
  { glob: 'server/dist/**', reason: 'build artifact, regenerated' },
  { glob: '**/node_modules/**', reason: 'third-party' },
];

/**
 * Allowlisted survivors. `match` is a substring tested against the matching LINE, scoped to
 * `file` (a substring of the repo-relative path).
 *
 * RETIREMENT: every entry states what makes it deletable. When that becomes true, delete the
 * fold AND this entry in the same commit.
 */
const ALLOWLIST = [
  // --- Back-compat folds. All retire together once no supported release's resources use the
  // --- pre-rename spellings. v2.1.0 shipped 7 framework files containing `methodologyGates`, so
  // --- a user who copied one into their workspace still depends on these. RETIREMENT: the first
  // --- major release after the rename ships, i.e. when v2.1.0 workspaces are no longer supported.
  { file: 'framework-schema.ts', match: 'methodologyGates' },
  { file: 'gate-schema.ts', match: 'methodology' },
  { file: 'core-config.ts', match: 'methodologyGates' },
  { file: 'infra/config/index.ts', match: 'methodologies' },
  { file: 'infra/config/index.ts', match: 'methodologyGates' },
  { file: 'config-input-validator.ts', match: 'gates.methodologyGates' },
  { file: 'config-utils.ts', match: 'gates.methodologyGates' },
  { file: 'config-operations.ts', match: 'gates.methodologyGates' },
  { file: 'config.schema.json', match: 'methodologyGates' },
  { file: 'framework-authoring-keys.ts', match: 'methodology_' },
  { file: 'framework-lifecycle-processor.ts', match: 'methodology_' },
  { file: 'framework-file-writer.ts', match: 'methodology' },
  { file: 'resource-manager/core/router.ts', match: 'methodology_' },
  { file: 'resource-manager/core/types.ts', match: 'methodology_' },
  { file: 'framework-manager/core/types.ts', match: 'methodology_' },
  { file: 'template-variables.ts', match: 'METHODOLOGY' },
  { file: 'framework_builder/script.py', match: 'methodology_' },
  { file: 'resources/schemas/framework.schema.json', match: 'methodologyGates' },

  // --- Tests that pin the folds above, scoped one entry per test file so each names the fold it
  // --- actually guards.
  // ---
  // --- This was a single blanket `{ file: 'tests/', match: 'methodolog' }`. That exempted the
  // --- whole test tree, so 18 stale `methodology` assertions in tests/integration survived a
  // --- guard written to prevent exactly them — four suites were failing against production that
  // --- had correctly renamed. Its retirement condition ("same commit as the fold each one
  // --- guards") could not be checked, because the entry named no fold. An exemption you cannot
  // --- retire is the defect this file exists to catch, so it does not get to keep one.
  { file: 'tests/unit/infra/config/legacy-key-migration.test.ts', match: 'methodolog' },
  { file: 'tests/unit/gates/pass-criteria-framework-fold.test.ts', match: 'methodolog' },
  {
    file: 'tests/unit/mcp-tools/framework-manager/authoring-key-fold.test.ts',
    match: 'methodolog',
  },
  {
    file: 'tests/unit/mcp-tools/system-control/framework-action-handler.test.ts',
    match: 'methodolog',
  },
  { file: 'tests/unit/frameworks/template-variable-substitution.test.ts', match: 'methodolog' },
  { file: 'tests/unit/frameworks/framework-gates-field.test.ts', match: 'methodolog' },
  { file: 'tests/unit/versioning/version-history-service.test.ts', match: 'methodolog' },

  // --- Prose recording what a rewritten test used to assert, so the next reader does not
  // --- "restore" it. Each is a comment, not an assertion — verify by re-reading the line.
  // --- RETIREMENT: when the note stops being useful, delete note and entry together.
  {
    file: 'tests/integration/database/resource-change-tracker-baseline.test.ts',
    match: 'methodolog',
  },
  { file: 'tests/integration/framework/framework-creation.test.ts', match: 'methodolog' },
  { file: 'tests/integration/resources/resource-registration.test.ts', match: 'methodolog' },

  // --- Prose explaining what was renamed and why. RETIREMENT: when the fold it documents goes.
  { file: 'resources/gates/framework-compliance/gate.yaml', match: 'methodology' },
  { file: 'docs/', match: 'methodolog' },
  { file: 'CLAUDE.md', match: 'methodolog' },

  // --- Banned-path regexes that keep the pre-rename directory name unusable. RETIREMENT: never
  // --- while the ban is wanted; the old path must stay named to stay banned.
  { file: 'eslint.config.js', match: 'methodology' },

  // --- Names a removed env var so a user who copied it from an older revision can tell what
  // --- happened (Tier 6 policy). RETIREMENT: when the removal is old enough to stop mentioning.
  { file: 'server/README.md', match: 'MCP_METHODOLOGIES_PATH' },

  // --- Explains a defect whose cause was the pre-rename key. RETIREMENT: with the comment.
  { file: 'system-control-router.ts', match: 'enableMethodologyGates' },

  // --- This guard names the vocabulary it forbids, and package.json names the guard.
  // --- RETIREMENT: when the guard itself is deleted.
  { file: 'validate-no-methodology-vocab.js', match: 'methodolog' },
  { file: 'package.json', match: 'validate:no-methodology-vocab' },
  { file: 'package.json', match: 'validate-no-methodology-vocab.js' },
];

function collectHits() {
  const globArgs = EXCLUDED_PATHS.map((p) => `--glob '!${p.glob}'`).join(' ');
  try {
    return execSync(`rg -n -i --no-heading ${globArgs} 'methodolog' .`, {
      encoding: 'utf8',
      cwd: new URL('../..', import.meta.url).pathname,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    })
      .split('\n')
      .filter((line) => line.trim() !== '');
  } catch (error) {
    // rg exits 1 when nothing matched, which is a clean pass.
    if (error.status === 1) return [];
    throw error;
  }
}

function isAllowlisted(hitLine) {
  const firstColon = hitLine.indexOf(':');
  const file = hitLine.slice(0, firstColon);
  const secondColon = hitLine.indexOf(':', firstColon + 1);
  const text = hitLine.slice(secondColon + 1);

  const haystack = text.toLowerCase();
  return ALLOWLIST.some(
    (entry) => file.includes(entry.file) && haystack.includes(entry.match.toLowerCase())
  );
}

const violations = collectHits().filter((line) => !isAllowlisted(line));

if (violations.length > 0) {
  console.error(`Found ${violations.length} non-allowlisted 'methodology' vocabulary hit(s).`);
  console.error('The vocabulary is `framework`. If a hit is a deliberate back-compat fold, add it');
  console.error('to ALLOWLIST in scripts/validate-no-methodology-vocab.js WITH a retirement');
  console.error('condition — an exemption without one is how the vocabulary came back.\n');
  for (const line of violations.slice(0, 40)) console.error(`  ${line}`);
  if (violations.length > 40) console.error(`  ... and ${violations.length - 40} more`);
  process.exit(1);
}

console.log('No non-allowlisted methodology vocabulary found.');

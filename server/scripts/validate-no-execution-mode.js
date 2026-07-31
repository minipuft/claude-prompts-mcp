#!/usr/bin/env node

/**
 * Guards the automation `mode` -> `trigger` + `confirm` migration against recurrence.
 *
 * Scoped deliberately narrow. `mode` is one of the heaviest homonyms in this repo —
 * `gates.mode`, `frameworks.mode`, `resources.mode`, `identity.mode`, enforcement mode, and
 * `CommandExecutionMode` ('single'|'chain'|'auto'|'prompt'|'template') in metrics are all
 * unrelated live concepts. A repo-wide `mode` check would be noise, so this guard looks only
 * inside the automation module and its shared types, where the migration happened.
 *
 * Allowlist, not zero-tolerance: the deprecated field is still parsed and folded forward, so the
 * fold and its documentation must keep naming it. Every entry carries a RETIREMENT CONDITION.
 *
 * Exit 0 when every hit is allowlisted; exit 1 with the offending lines otherwise.
 */

import { execSync } from 'node:child_process';

/** Only these paths are checked. Everything else uses `mode` for unrelated concepts. */
const SCOPE = ['src/modules/automation', 'src/shared/types/automation.ts'];

/**
 * Deliberate survivors. `match` is tested against the matching LINE (case-insensitive), scoped
 * to `file` (a substring of the path).
 */
const ALLOWLIST = [
  // --- The deprecation fold itself: `mode: auto|manual|confirm` is still accepted from older
  // --- script YAML and mapped to `trigger`/`confirm` with a runtime warning. `ExecutionModeSchema`
  // --- and `ExecutionModeYaml` correctly keep the old name because they parse the old field.
  // --- RETIREMENT: when script authors can no longer be carrying pre-migration YAML — delete the
  // --- transform, both symbols, `script-definition-loader`'s migration branch, and these entries.
  { file: 'core/script-schema.ts', match: 'mode' },
  { file: 'core/script-definition-loader.ts', match: 'mode' },

  // --- Prose describing what the deprecated field maps to. RETIREMENT: with the fold above.
  { file: 'shared/types/automation.ts', match: 'confirm mode' },
  { file: 'shared/types/automation.ts', match: '(mode, trigger, strict)' },

  // --- Unrelated concept: `strict` parameter matching, nothing to do with execution triggers.
  // --- RETIREMENT: none — this is a correct, current use of the word.
  { file: 'automation', match: 'strict mode' },
  { file: 'automation', match: 'strict matching mode' },
  { file: 'detection/tool-detection-service.ts', match: 'non-strict mode' },

  // --- Prose in the filter explaining WHY it is no longer named for `mode`, plus the legacy
  // --- `skippedManual` field kept for shape compatibility. Deleting this prose would lose the
  // --- reason the rename happened. RETIREMENT: with the fold in script-schema.ts.
  { file: 'execution/tool-trigger-filter.ts', match: 'mode' },

  // --- This guard names the vocabulary it forbids, and package.json names the guard.
  // --- RETIREMENT: when the guard itself is deleted.
  { file: 'validate-no-execution-mode.js', match: 'mode' },
  { file: 'package.json', match: 'validate-no-execution-mode' },
];

function collectHits() {
  try {
    return execSync(`rg -n -i --no-heading -w 'mode' ${SCOPE.join(' ')}`, {
      encoding: 'utf8',
      cwd: new URL('..', import.meta.url).pathname,
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
  const text = hitLine.slice(secondColon + 1).toLowerCase();

  return ALLOWLIST.some(
    (entry) => file.includes(entry.file) && text.includes(entry.match.toLowerCase())
  );
}

const violations = collectHits().filter((line) => !isAllowlisted(line));

if (violations.length > 0) {
  console.error(`Found ${violations.length} non-allowlisted 'mode' usage(s) in automation scope.`);
  console.error('Script tools are configured with `trigger` + `confirm`, not `mode`. The old');
  console.error('field is still parsed and folded forward, but new code must not read it. If a');
  console.error('hit is part of that fold, add it to ALLOWLIST in');
  console.error('scripts/validate-no-execution-mode.js WITH a retirement condition.\n');
  for (const line of violations.slice(0, 40)) console.error(`  ${line}`);
  if (violations.length > 40) console.error(`  ... and ${violations.length - 40} more`);
  process.exit(1);
}

console.log('No non-allowlisted execution-mode vocabulary in automation scope.');

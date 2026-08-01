#!/usr/bin/env node

/**
 * Forbids re-introducing pure re-export shim files.
 *
 * A shim here means a file whose entire code body is import/export-from statements AND which
 * carries a backward-compatibility marker. Such a file gives a symbol a second import path
 * without owning anything, which is the "one concept, two names" defect this codebase is
 * removing: `rg` for the canonical path then misses every consumer using the alias path.
 *
 * Sibling guards (`validate-no-prompt-gates-alias`, `validate-no-legacy-sidecars`,
 * `validate-no-tool-layer-validator-imports`) each pin one known regression. This one pins a
 * shape, because the shims removed in this sweep were in six different directories.
 *
 * Deliberately NOT flagged: a file that re-exports AND defines something of its own
 * (`infra/logging/index.ts` re-exports `Logger` but is the 495-line logger implementation), and
 * a barrel with no compat marker. The marker is what distinguishes "kept so old imports still
 * resolve" from "this is the module's public surface".
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = 'src';

const COMPAT_MARKER = /backward[- ]compat|backwards compat|Kept for compat|Compatibility export/i;

/**
 * `src/types.ts` is the one surviving shim. It is exempt because retiring it means repointing
 * every consumer at `shared/types/*`, which is Tier 3 vocabulary work, not a same-PR change.
 *
 * RETIREMENT CONDITION: when no file imports from `src/types.js`, delete both the file and this
 * entry. An allowlist that outlives its target is the debt this guard exists to prevent.
 */
const ALLOWLIST = new Set(['src/types.ts']);

/** Code lines only — comments carry the marker but say nothing about the file's shape. */
function codeLines(source) {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^(\/\/|\/\*|\*)/.test(line));
}

/** True when every code line belongs to an import/export statement and at least one has `from`. */
function isPureReExport(lines) {
  if (lines.length === 0) {
    return false;
  }
  const statementShape = /^(export\s|import\s|\}|\)|\{|type\s|[A-Za-z_$][\w$]*\s*,?$)/;
  const hasFromClause = lines.some((line) => /\bfrom\s+['"]/.test(line));
  return hasFromClause && lines.every((line) => statementShape.test(line));
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function validate() {
  const violations = [];

  for (const file of walk(ROOT)) {
    const normalized = file.split(path.sep).join('/');
    if (ALLOWLIST.has(normalized)) {
      continue;
    }
    const source = readFileSync(file, 'utf8');
    if (!COMPAT_MARKER.test(source)) {
      continue;
    }
    if (isPureReExport(codeLines(source))) {
      violations.push(normalized);
    }
  }

  if (violations.length > 0) {
    console.error('Cross-layer compat re-export shim(s) found:');
    for (const file of violations) {
      console.error(`  ${file}`);
    }
    console.error(
      '\nA pure re-export file with a compat marker gives a symbol a second import path.\n' +
        'Point consumers at the canonical module and delete the shim, or — if it is a real\n' +
        'public surface — drop the backward-compatibility wording that marks it as temporary.'
    );
    process.exit(1);
  }

  console.log('Cross-layer compat re-export check passed.');
}

validate();

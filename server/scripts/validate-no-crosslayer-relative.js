#!/usr/bin/env node

/**
 * Guards the subpath-import migration against decay.
 *
 * 614 cross-layer relative imports were rewritten to package.json "imports" specifiers
 * (`#shared/x.js` rather than `../../shared/x.js`). The subpath form names the layer it
 * comes from and stays correct when the importing file moves; a `../../` chain encodes the
 * importer's depth into the specifier, so moving the file silently changes what it means.
 *
 * WHY NOT ESLint `no-restricted-imports`
 * It matches specifier TEXT. Banning `../../*` flags 197 legitimate deep intra-layer
 * imports — `mcp/tools/handlers/x.ts` importing `../../schemas/y.js` never leaves `mcp` —
 * and catches zero real violations. Whether an import crosses a layer is a question about
 * the RESOLVED path, which is the same reason the migration used ts-morph and not sed.
 *
 * Resolution here is pure path arithmetic: a relative specifier is a path, so `path.resolve`
 * answers it exactly without loading the TypeScript program.
 *
 * Intra-layer relative imports are left alone on purpose. `#shared/foo.js` for a sibling is
 * noise; `./foo.js` says "next to me", which is information.
 *
 * `--self-test` proves the rule can still fail.
 *
 * RETIREMENT CONDITION: delete when no contributor could plausibly write a cross-layer
 * relative import, i.e. when the subpath form has been the only one for a full release.
 *
 * MECHANISM: script — resolution — decides layer crossing from the RESOLVED path; a textual `../../*` ban was measured to flag 197 legitimate intra-layer imports and zero real violations
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(SERVER, 'src');

/** Top-level directories under src/ that package.json "imports" exposes. */
const LAYERS = new Set(['shared', 'infra', 'engine', 'modules', 'mcp', 'runtime', 'cli-shared']);

/** Matches the specifier in `from '…'`, `import('…')` and `export … from '…'`. */
const SPECIFIER = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

/** The layer a file belongs to, or null for files sitting directly in src/. */
function layerOf(absPath) {
  const rel = path.relative(SRC, absPath);
  if (rel.startsWith('..')) return null;
  const [top] = rel.split(path.sep);
  return top && LAYERS.has(top) ? top : null;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(full)) yield full;
  }
}

/**
 * Returns the cross-layer relative imports in one file's source text.
 * Pure — the self-test drives it with fabricated inputs.
 */
function findViolations(absPath, source) {
  const fromLayer = layerOf(absPath);
  if (!fromLayer) return [];

  const violations = [];
  for (const [, specifier] of source.matchAll(SPECIFIER)) {
    if (!specifier.startsWith('.')) continue;

    const targetLayer = layerOf(path.resolve(path.dirname(absPath), specifier));
    if (targetLayer && targetLayer !== fromLayer) {
      violations.push({ specifier, fromLayer, targetLayer });
    }
  }
  return violations;
}

/** Each case must produce at least one violation, or the rule it exercises is inert. */
const SELF_TEST_CASES = [
  {
    rule: 'a cross-layer ../../ import is rejected',
    file: path.join(SRC, 'mcp', 'tools', 'handler.ts'),
    source: "import { Logger } from '../../infra/logging/index.js';",
    expectViolation: true,
  },
  {
    rule: 'a cross-layer import at any depth is rejected',
    file: path.join(SRC, 'mcp', 'a', 'b', 'c', 'deep.ts'),
    source: "export { x } from '../../../../shared/x.js';",
    expectViolation: true,
  },
  {
    rule: 'a cross-layer dynamic import is rejected',
    file: path.join(SRC, 'engine', 'gates', 'g.ts'),
    source: "const m = await import('../../modules/prompts/index.js');",
    expectViolation: true,
  },
  {
    rule: 'a deep INTRA-layer import is accepted (the eslint rule got this wrong)',
    file: path.join(SRC, 'mcp', 'tools', 'handlers', 'x.ts'),
    source: "import { y } from '../../schemas/y.js';",
    expectViolation: false,
  },
  {
    rule: 'the subpath form is accepted',
    file: path.join(SRC, 'mcp', 'tools', 'handler.ts'),
    source: "import { Logger } from '#infra/logging/index.js';",
    expectViolation: false,
  },
  {
    rule: 'a sibling import is accepted',
    file: path.join(SRC, 'mcp', 'tools', 'handler.ts'),
    source: "import { y } from './y.js';",
    expectViolation: false,
  },
];

function runSelfTest() {
  console.log('\nvalidate:no-crosslayer-relative self-test — every rule must behave\n');

  let failures = 0;
  for (const { rule, file, source, expectViolation } of SELF_TEST_CASES) {
    const got = findViolations(file, source).length > 0;
    const ok = got === expectViolation;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${rule}`);
    if (!ok) failures += 1;
  }

  console.log(
    failures === 0
      ? `\nOK: all ${SELF_TEST_CASES.length} rules are falsifiable\n`
      : `\nFAILED: ${failures} rule(s) behaved wrongly\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  const offenders = [];
  for (const file of walk(SRC)) {
    for (const violation of findViolations(file, readFileSync(file, 'utf8'))) {
      offenders.push(
        `  ${path.relative(SERVER, file)}\n` +
          `    ${violation.specifier}  (${violation.fromLayer} -> ${violation.targetLayer}) ` +
          `use #${violation.targetLayer}/…`
      );
    }
  }

  if (offenders.length > 0) {
    console.error(`Cross-layer relative imports found (${offenders.length}):\n`);
    console.error(offenders.join('\n'));
    console.error(
      '\nUse the subpath form declared in package.json "imports". It names the layer ' +
        "rather than the importer's depth, so it survives the file moving."
    );
    process.exit(1);
  }

  console.log('No cross-layer relative imports found.');
}

main();

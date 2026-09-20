#!/usr/bin/env node

/**
 * Fails when a `SAFE_BUSINESS_ATTRIBUTES` entry (infra/observability/telemetry/types.ts) has no
 * emission site anywhere else in `src/`.
 *
 * WHY THIS SHAPE. P4.70 and P4.72 each found one allowlisted telemetry attribute that nothing
 * emitted — a declaration that reads as a settled contract because it typechecks and is
 * documented, while no code path ever assigns it a real value. P4.73 found five more in the same
 * file. Three sightings of "declared, allowlisted, never emitted" makes this a class, not a list
 * of one-off fixes, so it gets a gate that fails the NEXT one too.
 *
 * THE PROPERTY THIS MEASURES: "an assignment site exists outside the declaration". NOT "the
 * string appears somewhere" — `rg --fixed-strings` already answers that and still misses the
 * defect, because the string legitimately appears in three places that are not an emission: the
 * `SAFE_BUSINESS_ATTRIBUTES` array entry itself, the interface field it types
 * (`PipelineRootAttributes` and its siblings, all declared in this same file), and a test fixture
 * that feeds the literal into `AttributePolicyEnforcer.sanitize()` to test the generic
 * allow/deny path — never asserting that a producer sets it.
 *
 * PREDICATE: a quoted object-literal key matching the attribute name, in a `src/**\/*.ts` file
 * that is neither the declaration file nor a test. Every one of these attribute names is typed as
 * an interface field ONLY in the declaration file (`PipelineRootAttributes`, `GateEventAttributes`,
 * `ChainEventAttributes`, etc. all live there) — so excluding just that one file, rather than
 * trying to distinguish a `PropertySignature` from a `PropertyAssignment` by regex, already
 * removes every declaration-only match and leaves only real emission sites.
 *
 * MECHANISM: script — relation — walks `src/**\/*.ts`, greps each file for a quoted-key pattern
 * per allowlisted attribute; no compiler, no other script's output.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = path.join(SERVER_ROOT, 'src');
const DECLARATION_FILE = path.join(SRC_ROOT, 'infra', 'observability', 'telemetry', 'types.ts');

/** Read the allowlist straight from source — no build step, no stale copy to drift. */
function readAllowlist() {
  const text = readFileSync(DECLARATION_FILE, 'utf8');
  const match = text.match(/SAFE_BUSINESS_ATTRIBUTES\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!match) {
    throw new Error(`Could not locate SAFE_BUSINESS_ATTRIBUTES array in ${DECLARATION_FILE}`);
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function isTestPath(rel) {
  return /(^|\/)(tests|__tests__)\//.test(rel) || /\.test\.[cm]?[jt]sx?$/.test(rel);
}

/** Every `.ts`/`.tsx` file under `src/`, excluding the declaration file and tests. */
function collectFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      collectFiles(full, acc);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (full === DECLARATION_FILE) continue;
    if (isTestPath(path.relative(SERVER_ROOT, full))) continue;
    acc.push(full);
  }
  return acc;
}

function escapeForRegex(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `attribute` appears as a quoted object-literal key in `file`. */
function isEmittedIn(file, pattern) {
  return pattern.test(readFileSync(file, 'utf8'));
}

function findUnemitted(attributes, files) {
  return attributes.filter((attribute) => {
    const pattern = new RegExp(`['"]${escapeForRegex(attribute)}['"]\\s*:`);
    return !files.some((file) => isEmittedIn(file, pattern));
  });
}

function main() {
  const attributes = readAllowlist();
  const files = collectFiles(SRC_ROOT);
  const unemitted = findUnemitted(attributes, files);

  if (unemitted.length > 0) {
    const plural = unemitted.length === 1 ? 'entry has' : 'entries have';
    console.error(
      `UNEMITTED: ${unemitted.length} SAFE_BUSINESS_ATTRIBUTES ${plural} no emission site in ` +
        'src/ (outside the declaration file and tests/):'
    );
    for (const attribute of unemitted) console.error(`  - ${attribute}`);
    console.error(
      '\nEach entry needs a real assignment site in src/, or must be removed from ' +
        'SAFE_BUSINESS_ATTRIBUTES together with its row in ' +
        'docs/guides/telemetry-observability.md.'
    );
    process.exit(1);
  }

  console.log(
    '[validate-telemetry-attribute-emitters] OK: all ' +
      `${attributes.length} SAFE_BUSINESS_ATTRIBUTES entries have an emission site`
  );
}

main();

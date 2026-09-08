#!/usr/bin/env tsx
/**
 * The declared shipped-framework set must match the frameworks actually in the package.
 *
 * WHY THIS EXISTS. `SHIPPED_FRAMEWORK_IDS` is what the deletion guard consults to refuse removing
 * a framework the server ships, and what the registry loads as built-in. It is a DECLARED list
 * rather than a directory scan, deliberately: in a default install the bundled resources directory
 * and the configured frameworks directory are the same path, so a scan could not tell a shipped
 * framework from one the operator created, and refusing both would trade a data-loss bug for a
 * capability bug.
 *
 * A declared list buys that precision and costs the ability to rot, which is exactly what
 * happened. Measured 2026-09-07: two hand-written copies of the set each named four ids while
 * eight shipped, and `focus`, `liquescent`, `radiant` and `verify` were deletable from the bundled
 * tree because no guard named them. This gate is the closure condition for that class — not the
 * four ids that were missing, but the disagreement itself, in either direction.
 *
 * WHAT IT CHECKS
 *   · every directory under `resources/frameworks/` holding a `framework.yaml` is declared;
 *   · every declared id has such a directory.
 *
 * Both directions are failures. A declared id with no directory makes the registry throw at
 * startup, since every shipped id is loaded fail-fast.
 *
 * `--self-test` proves each direction can still fail.
 */

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHIPPED_FRAMEWORK_IDS } from '../src/engine/frameworks/definitions/shipped-frameworks.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRAMEWORKS_DIR = path.join(SERVER_ROOT, 'resources', 'frameworks');

/** Directories under a frameworks root that actually define a framework. */
function frameworksOnDisk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(path.join(dir, name, 'framework.yaml')))
    .sort();
}

interface Divergence {
  kind: 'undeclared' | 'missing';
  id: string;
  detail: string;
}

export function findDivergences(
  declared: readonly string[],
  onDisk: readonly string[]
): Divergence[] {
  const declaredSet = new Set(declared);
  const onDiskSet = new Set(onDisk);
  const findings: Divergence[] = [];

  for (const id of onDisk) {
    if (!declaredSet.has(id)) {
      findings.push({
        kind: 'undeclared',
        id,
        detail:
          `ships in resources/frameworks/${id}/ but is absent from SHIPPED_FRAMEWORK_IDS, so the ` +
          `deletion guard would let a caller remove it from the package tree`,
      });
    }
  }

  for (const id of declared) {
    if (!onDiskSet.has(id)) {
      findings.push({
        kind: 'missing',
        id,
        detail:
          `is declared in SHIPPED_FRAMEWORK_IDS but has no resources/frameworks/${id}/framework.yaml, ` +
          `so the registry will throw FATAL at startup`,
      });
    }
  }

  return findings;
}

function selfTest(): number {
  const cases: {
    name: string;
    declared: string[];
    onDisk: string[];
    expect: (_findings: Divergence[]) => boolean;
  }[] = [
    {
      name: 'an agreeing set reports nothing',
      declared: ['a', 'b'],
      onDisk: ['a', 'b'],
      expect: (f) => f.length === 0,
    },
    {
      name: 'a framework on disk but undeclared is reported (the motivating instance)',
      declared: ['a'],
      onDisk: ['a', 'b'],
      expect: (f) => f.length === 1 && f[0].kind === 'undeclared' && f[0].id === 'b',
    },
    {
      name: 'a declared framework with no directory is reported',
      declared: ['a', 'b'],
      onDisk: ['a'],
      expect: (f) => f.length === 1 && f[0].kind === 'missing' && f[0].id === 'b',
    },
    {
      name: 'both directions are reported together',
      declared: ['a', 'x'],
      onDisk: ['a', 'y'],
      expect: (f) => f.length === 2 && f.some((d) => d.id === 'x') && f.some((d) => d.id === 'y'),
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const ok = c.expect(findDivergences(c.declared, c.onDisk));
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
    if (!ok) failed += 1;
  }

  // The real set must agree with the real tree — the check the gate exists to make.
  const live = findDivergences(SHIPPED_FRAMEWORK_IDS, frameworksOnDisk(FRAMEWORKS_DIR));
  const liveOk = live.length === 0;
  console.log(`${liveOk ? 'PASS' : 'FAIL'}  the declared set matches this checkout`);
  if (!liveOk) failed += 1;

  return failed === 0 ? 0 : 1;
}

function run(): number {
  const onDisk = frameworksOnDisk(FRAMEWORKS_DIR);
  if (onDisk.length === 0) {
    console.error(`✖ No frameworks found under ${FRAMEWORKS_DIR} — the probe cannot observe.`);
    return 1;
  }

  const findings = findDivergences(SHIPPED_FRAMEWORK_IDS, onDisk);
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`✖ '${finding.id}' ${finding.detail}`);
    }
    console.error(
      `\nFix: edit SHIPPED_FRAMEWORK_IDS in ` +
        `src/engine/frameworks/definitions/shipped-frameworks.ts so it names exactly the ` +
        `frameworks in resources/frameworks/.`
    );
    return 1;
  }

  console.log(
    `✅ Shipped frameworks: ${onDisk.length} on disk, all declared — ${onDisk.join(', ')}.`
  );
  return 0;
}

process.exit(process.argv.includes('--self-test') ? selfTest() : run());

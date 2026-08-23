#!/usr/bin/env tsx

/**
 * Runs dependency-cruiser and proves it analysed a representative source graph.
 *
 * dependency-cruiser can exit successfully after parsing zero TypeScript modules when its
 * transpiler integration is incompatible. Structured JSON removes the former human-summary
 * regex, but it does not remove the need for a false-green coverage floor.
 *
 * Measured 2026-08-23: 473 modules and 1,967 dependencies. The 400-module floor stays well below
 * ordinary churn and well above the parser-collapse case.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  formatDependencyCruiserViolations,
  parseDependencyCruiserJson,
  runDependencyCruiser,
  type DependencyCruiserGraph,
} from './lib/dependency-cruiser-graph.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE_FLOOR = 400;

export interface ArchitectureAssessment {
  readonly failures: readonly string[];
  readonly modules: number;
  readonly ok: boolean;
}

export function assessDependencyCruiserGraph(
  graph: DependencyCruiserGraph,
  exitCode: number,
  floor = MODULE_FLOOR
): ArchitectureAssessment {
  const failures: string[] = [];
  if (exitCode !== 0 || graph.summary.error > 0) {
    failures.push(
      `dependency-cruiser reported ${graph.summary.error} error violation(s) and exited ${exitCode}`
    );
  }
  if (graph.summary.totalCruised < floor) {
    failures.push(
      `only ${graph.summary.totalCruised} modules cruised, below the floor of ${floor}; ` +
        'the TypeScript parser or dependency-cruiser configuration may have collapsed'
    );
  }
  if (graph.summary.totalDependenciesCruised === 0) {
    failures.push(
      'zero dependencies cruised; an architecture check over an empty edge set is invalid'
    );
  }
  return {
    failures,
    modules: graph.summary.totalCruised,
    ok: failures.length === 0,
  };
}

function fixtureGraph(modules: number, dependencies: number, errors = 0): DependencyCruiserGraph {
  return {
    modules: [],
    summary: {
      violations: [],
      error: errors,
      warn: 0,
      info: 0,
      totalCruised: modules,
      totalDependenciesCruised: dependencies,
    },
  };
}

function selfTest(): void {
  assert.equal(assessDependencyCruiserGraph(fixtureGraph(473, 1967), 0).ok, true);
  assert.equal(assessDependencyCruiserGraph(fixtureGraph(0, 0), 0).ok, false);
  assert.equal(assessDependencyCruiserGraph(fixtureGraph(12, 3), 0).ok, false);
  assert.equal(assessDependencyCruiserGraph(fixtureGraph(473, 1967, 1), 1).ok, false);
  assert.equal(assessDependencyCruiserGraph(fixtureGraph(473, 0), 0).ok, false);
  assert.throws(() => parseDependencyCruiserJson('{'), /invalid JSON/u);
  assert.throws(
    () => parseDependencyCruiserJson('{"modules":[],"summary":{}}'),
    /required graph contract/u
  );
  process.stdout.write('validate:arch self-test — 7/7 cases passed\n');
}

function main(): void {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }
  const run = runDependencyCruiser({ cwd: SERVER_ROOT });
  const assessment = assessDependencyCruiserGraph(run.graph, run.exitCode);
  const violations = formatDependencyCruiserViolations(run.graph.summary.violations);
  if (violations.length > 0) process.stdout.write(`${violations}\n`);
  if (!assessment.ok) {
    process.stderr.write(
      `validate:arch FAILED\n${assessment.failures.map((failure) => `- ${failure}`).join('\n')}\n`
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `validate:arch OK — ${assessment.modules} modules and ${run.graph.summary.totalDependenciesCruised} dependencies cruised ` +
      `(${run.graph.summary.error} errors, ${run.graph.summary.warn} warnings; floor ${MODULE_FLOOR}).\n`
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `validate:arch FAILED — ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}

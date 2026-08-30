#!/usr/bin/env node

/**
 * Requires every process-spawning module to guard the two author-supplied inputs.
 *
 * WHAT IT PROTECTS. Row 1.6 of the 2026-08-24 security review found that
 * `MCP_SHELL_VERIFY_ALLOWLIST` bounds the command STRING only. Two other values arrive
 * from the same author in the same file and decide what that string means: the
 * environment (`shell_env`, `tool.env`) and the working directory (`shell_working_dir`,
 * `tool.workingDir`). Both are now guarded at both sinks. Nothing enforced that they
 * stay, and by `dev-workflow.md` — "a fix at the sites you found is not a fix of the
 * class" — the class would not be closed without this.
 *
 * WHY A GATE AND NOT ONLY THE THROW. `buildSafeEnvironment` throws on a denied key, so
 * a third sink cannot silently accept one. That backstop covers the ENV half only, and
 * it fires at runtime in whatever request happens to reach it. There is no equivalent
 * chokepoint for the working directory, because the permitted root differs per sink:
 * `shell_verify` answers to the operator's declared roots, a script tool answers to its
 * own install directory. A sink added later would default to "anywhere" with nothing
 * failing. This gate is what fails instead.
 *
 * THE PROPERTY MEASURED, stated exactly. Every `src/` file that calls `executeProcess`
 * must contain BOTH a call naming the environment guard and a call naming a
 * containment guard. Not "imports them" — calls. An import with no call is what a
 * careless merge resolution leaves behind, and it is the shape the sibling gate
 * `validate:resource-path-containment` was built to catch for resource writes.
 *
 * THE APPROXIMATION, AND WHY IT CANNOT ROT SILENTLY. The check is per-FILE, not per-call:
 * it proves a file guards, not that the guard is on the path of any particular spawn.
 * That approximation is exactly sound while a file spawns once, and unsound the moment
 * one spawns twice — so rather than write the limitation down and hope someone notices
 * the day it stops holding, the gate FAILS when a file gains a second spawn. A stated
 * blind spot with no detector is a permanent one (`cleanup-standards.md` §A Status
 * Outlives What It Described); this converts it into a condition that reports itself.
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Project, SyntaxKind } from 'ts-morph';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = 'validate:spawn-input-guards';
const SINK = 'executeProcess';

/**
 * One guard per author-supplied input. Each lists the call names that satisfy it, so a
 * sink may satisfy the containment requirement either through the shared helper or
 * through the shell-verify policy that wraps it.
 */
const REQUIRED = [
  {
    input: 'environment',
    calls: ['findUnsafeEnvironmentKeys'],
    fix: 'call findUnsafeEnvironmentKeys(env) and refuse before spawning (#shared/utils/process.js)',
  },
  {
    input: 'working directory',
    calls: ['isPathInside', 'assertPathInside', 'isWorkingDirAllowed'],
    fix: 'contain the cwd against a root the OPERATOR controls, not one the author supplied',
  },
];

/**
 * `process.ts` DEFINES the sink and the environment guard rather than consuming them.
 * Load-bearing: without it the scan reports the module that implements the control.
 */
const ACCEPTED = ['src/shared/utils/process.ts'];

function collect() {
  const project = new Project({
    tsConfigFilePath: path.join(SERVER_ROOT, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: false,
  });

  const sinks = [];
  const findings = [];

  for (const sourceFile of project.getSourceFiles()) {
    const rel = path.relative(SERVER_ROOT, sourceFile.getFilePath());
    if (!rel.startsWith('src' + path.sep)) continue;

    const calls = sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .map((call) => call.getExpression().getText());

    const spawnCount = calls.filter((text) => text === SINK || text.endsWith(`.${SINK}`)).length;
    if (spawnCount === 0) continue;
    if (ACCEPTED.includes(rel)) continue;

    sinks.push(rel);

    // The per-file check stops being sound here — see THE APPROXIMATION above.
    if (spawnCount > 1) {
      findings.push({
        file: rel,
        headline: `carries ${spawnCount} ${SINK}() calls, which this gate cannot tell apart`,
        fix: `it proves a FILE guards, not WHICH spawn it guards — the same claim only while a file spawns once. Upgrade this gate to per-call dataflow before adding the second spawn`,
      });
    }

    for (const requirement of REQUIRED) {
      const satisfied = requirement.calls.some((name) =>
        calls.some((text) => text === name || text.endsWith(`.${name}`))
      );
      if (!satisfied) {
        findings.push({
          file: rel,
          headline: `spawns a process without guarding the ${requirement.input}`,
          fix: requirement.fix,
        });
      }
    }
  }
  return { sinks, findings };
}

const { sinks, findings } = collect();

// A scan that matched no sinks is a broken scan reported as cleanliness.
if (sinks.length === 0) {
  console.error(`❌ ${GATE}: found ZERO callers of ${SINK}() — the scan is broken.`);
  process.exit(1);
}

for (const { file, headline, fix } of findings) {
  console.error(`❌ ${file} — ${headline}`);
  console.error(`     ${fix}`);
}

if (findings.length === 0) {
  console.log(
    `[validate-spawn-input-guards] OK: ${sinks.length} spawn sink(s) scanned, env + cwd guarded in each`
  );
  process.exit(0);
}
process.exit(1);

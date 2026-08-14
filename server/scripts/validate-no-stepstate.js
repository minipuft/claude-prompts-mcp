#!/usr/bin/env node

/**
 * Guards the `StepState` enum retirement (migration plan step 7).
 *
 * `StepState` was a 4-value enum whose `RENDERED` and `RESPONSE_CAPTURED` members had no
 * counterpart in the sticky-terminal `StepLifecycle` model — they are progress *within*
 * `working`, now carried by the `renderedAt` / `respondedAt` substate timestamps. Reintroducing
 * the enum would reintroduce the ambiguity the two-tier model exists to remove.
 *
 * Reports `StepState` only when it stands alone, so the surviving method names
 * (`setStepState`, `getStepState`, `transitionStepState`) do not trip it. Those names are
 * deliberately kept — they describe the operation, not the retired type.
 *
 * rg uses the Rust regex engine, which has no look-around, so the standalone test runs in JS
 * (which does support lookbehind) over rg's output rather than in the search pattern itself.
 *
 * RETIREMENT CONDITION: delete this guard once no contributor could plausibly reach for the enum,
 * i.e. when `StepLifecycle` + `StepMilestone` have been the only vocabulary for a full release.
 *
 * MECHANISM: script — reach — scans `tests/` as well as `src/`, and ESLint globally ignores `tests/` — an AST port would silently halve the scope
 *
 * SCOPE: git-tracked files under the targets, not a filesystem walk (plan row E6). Pointing rg at
 * a directory let untracked files into the scan — measured 2026-08-12, 13 of them under these two
 * roots alone, mostly a concurrent session's in-flight work. Nobody can act on a gate reddened by
 * someone else's uncommitted file.
 */

import { spawnSync } from 'node:child_process';

import { assertNonEmptyScope, trackedFilesUnder } from './lib/tracked-scope.js';

const PATTERN = 'StepState';
const STANDALONE = /(?<![A-Za-z])StepState(?![A-Za-z])/;
const TARGETS = ['src', 'tests'];

function runCheck() {
  const files = trackedFilesUnder(TARGETS);
  assertNonEmptyScope(files, TARGETS, 'validate:no-stepstate');

  // Argument array, not a shell string: ~670 paths survive no quoting scheme intact, and
  // bypassing the shell means the OS argument limit applies instead of the shell's.
  const result = spawnSync('rg', ['-n', PATTERN, ...files], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

  // rg exits 1 on "no matches" — the passing case for this guard.
  if (result.status === 1) {
    console.log('No retired StepState enum usage found.');
    process.exit(0);
  }
  if (result.status !== 0) {
    console.error(result.stderr?.trim() || `rg exited ${result.status}`);
    process.exit(1);
  }

  {
    const output = result.stdout;

    const offenders = output
      .trim()
      .split('\n')
      .filter((row) => row.trim() !== '')
      // Drop setStepState / getStepState / transitionStepState — kept on purpose.
      .filter((row) => STANDALONE.test(row))
      // Comments that explain the retirement are the one legitimate mention.
      .filter((row) => !/:\s*(\/\/|\*|\/\*)/.test(row));

    if (offenders.length > 0) {
      console.error('Retired `StepState` enum found (use `StepLifecycle` + `StepMilestone`):');
      console.error(offenders.join('\n'));
      process.exit(1);
    }

    console.log(`No retired StepState enum usage found (${files.length} tracked files scanned).`);
  }
}

runCheck();

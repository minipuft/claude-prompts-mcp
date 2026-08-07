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
 */

import { execSync } from 'node:child_process';

const PATTERN = 'StepState';
const STANDALONE = /(?<![A-Za-z])StepState(?![A-Za-z])/;
const TARGETS = ['src', 'tests'];

function runCheck() {
  try {
    const output = execSync(`rg -n "${PATTERN}" ${TARGETS.join(' ')}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

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

    console.log('No retired StepState enum usage found.');
  } catch (error) {
    // rg exits 1 on "no matches" — the passing case for this guard.
    if (error.status === 1) {
      console.log('No retired StepState enum usage found.');
      process.exit(0);
    }

    const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
    console.error(stderr !== '' ? stderr : String(error));
    process.exit(1);
  }
}

runCheck();

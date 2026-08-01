#!/usr/bin/env node

/**
 * Guards the `ChainSessionManager` -> `ChainSessionStore` retirement (sweep step 3.3).
 *
 * The class was renamed ahead of its identifiers, leaving 177 sites reading
 * `chainSessionManager` / `getChainSessionManager()` against a class named
 * `ChainSessionStore`. Two names for one concept is the defect this sweep removes;
 * this guard keeps the old name from reappearing via copy-paste.
 *
 * RETIREMENT CONDITION: delete this guard when `Store` is the only session-collaborator
 * suffix in the codebase and no reviewer could plausibly reintroduce `Manager` here.
 */

import { execSync } from 'node:child_process';

const PATTERN = 'chainsessionmanager';
const TARGETS = ['src', 'tests', '../hooks', '../docs'];

function runCheck() {
  try {
    // -i: the retired name appears in class, variable, mock, and prose casings alike.
    const output = execSync(`rg -in "${PATTERN}" ${TARGETS.join(' ')}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (output.trim() !== '') {
      console.error('Retired `ChainSessionManager` vocabulary found (use `ChainSessionStore`):');
      console.error(output.trim());
      process.exit(1);
    }

    console.log('No retired ChainSessionManager vocabulary found.');
  } catch (error) {
    // rg exits 1 on "no matches" — that is the passing case for this guard.
    if (error.status === 1) {
      console.log('No retired ChainSessionManager vocabulary found.');
      process.exit(0);
    }

    const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
    console.error(stderr !== '' ? stderr : String(error));
    process.exit(1);
  }
}

runCheck();

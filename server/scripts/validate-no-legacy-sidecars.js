#!/usr/bin/env node

/**
 * Forbids the JSON sidecar state files that SQLite replaced.
 *
 * RETIREMENT CONDITION: this one does not retire on a vocabulary schedule, unlike the guards
 * that watch a renamed symbol. It forbids six file-path and field shapes, and a contributor can
 * reach for a sidecar without ever typing a retired name — writing `runtime-state/sessions/x.json`
 * is a natural thing to do when you want to persist something and have not yet found the state
 * store. Delete it when persistence can no longer be added outside `SqliteStateStore`, i.e. when
 * a write to disk from outside that module fails a stronger structural check than this grep.
 */

import { execSync } from 'node:child_process';

const PATTERN = [
  'verify-active\\.json',
  '\\.history\\.json',
  'runtime-state/sessions/.+\\.json',
  'ralph-sessions/.+/session\\.json',
  'session_state_file',
  'legacy_state_file',
].join('|');
const TARGETS = ['src', '../cli/src', '../hooks', '../docs/guides', '../docs/reference'];

function runCheck() {
  try {
    const output = execSync(`rg -n "${PATTERN}" ${TARGETS.join(' ')}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (output.trim() !== '') {
      console.error('Legacy sidecar references found:');
      console.error(output.trim());
      process.exit(1);
    }
    console.log('No legacy sidecar references found.');
  } catch (error) {
    if (error.status === 1) {
      // rg exit 1 means no matches
      console.log('No legacy sidecar references found.');
      process.exit(0);
    }
    const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
    console.error(stderr !== '' ? stderr : String(error));
    process.exit(1);
  }
}

runCheck();

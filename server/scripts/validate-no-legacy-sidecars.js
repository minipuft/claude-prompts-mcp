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
 *
 * MECHANISM: script — reach — scans `../cli/src`, `../hooks`, `../docs/guides` and `../docs/reference`, all outside the ESLint root
 *
 * SCOPE: git-tracked files under the targets, not a filesystem walk (plan row E6). A directory
 * handed to rg admits untracked files, so a concurrent session's uncommitted sidecar would red
 * this gate for everyone; and rg skips dot-paths, so a tracked one could hide.
 */

import { spawnSync } from 'node:child_process';

import { assertNonEmptyScope, trackedFilesUnder } from './lib/tracked-scope.js';

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
  const files = trackedFilesUnder(TARGETS);
  assertNonEmptyScope(files, TARGETS, 'validate:no-legacy-sidecars');

  const result = spawnSync('rg', ['-n', PATTERN, ...files], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

  // rg exits 1 when nothing matched — the passing case for this guard.
  if (result.status === 1) {
    console.log(`No legacy sidecar references found (${files.length} tracked files scanned).`);
    process.exit(0);
  }
  if (result.status !== 0) {
    console.error(result.stderr?.trim() || `rg exited ${result.status}`);
    process.exit(1);
  }

  const output = result.stdout.trim();
  if (output !== '') {
    console.error('Legacy sidecar references found:');
    console.error(output);
    process.exit(1);
  }
  console.log(`No legacy sidecar references found (${files.length} tracked files scanned).`);
}

runCheck();

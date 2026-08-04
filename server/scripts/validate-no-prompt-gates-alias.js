#!/usr/bin/env node

/**
 * Forbids re-aliasing `args.gates` onto `gateConfiguration` in the prompt lifecycle processor,
 * which would give one concept two accepted spellings at the tool boundary.
 *
 * RETIREMENT CONDITION: not soon, and this guard is the opposite of a tombstone. Its target file
 * already contains `gateConfiguration: args['gate_configuration'],` — the exact left-hand side of
 * the first forbidden expression — so reintroducing the defect is appending ` || args.gates` to a
 * line that is already there. Both spellings remain live in the surface: `gate_configuration` in
 * resource-manager.schema.ts, `args.gates` in three tool-layer files. Delete this guard when one
 * of those two spellings no longer exists, at which point the coalescing expression cannot be
 * written at all.
 */

import { execSync } from 'node:child_process';

const PATTERN = [
  "gateConfiguration:\\s*args\\['gate_configuration'\\]\\s*\\|\\|\\s*args\\.gates",
  'args\\.gates\\s*\\|\\|\\s*currentPrompt\\?\\.gateConfiguration',
].join('|');

const TARGET = 'src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts';

function runCheck() {
  try {
    const output = execSync(`rg -n "${PATTERN}" ${TARGET}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (output.trim() !== '') {
      console.error('Legacy prompt gate alias usage found:');
      console.error(output.trim());
      process.exit(1);
    }

    console.log('No legacy prompt gate alias usage found.');
  } catch (error) {
    if (error.status === 1) {
      console.log('No legacy prompt gate alias usage found.');
      process.exit(0);
    }

    const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
    console.error(stderr !== '' ? stderr : String(error));
    process.exit(1);
  }
}

runCheck();

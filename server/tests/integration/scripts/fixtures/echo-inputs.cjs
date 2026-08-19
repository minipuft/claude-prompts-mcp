#!/usr/bin/env node
// Fixture: reads the JSON inputs the executor writes to stdin and echoes them
// back. Used by the happy-path and argv-safety cases.
let raw = '';
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  let inputs = {};
  if (raw.trim() !== '') {
    try {
      inputs = JSON.parse(raw);
    } catch {
      inputs = { parseError: true };
    }
  }
  process.stdout.write(JSON.stringify({ received: inputs, ok: true }));
});

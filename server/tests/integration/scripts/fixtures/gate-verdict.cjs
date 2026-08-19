#!/usr/bin/env node
// Fixture: a script tool shaped like a gate verifier. Echoes back the verdict
// its `verdict` input asks for, so a test can assert BOTH polarities without a
// second fixture. `marker` proves the verdict came from THIS file rather than
// from a shell that happened to succeed.
let raw = '';
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  const inputs = raw.trim() === '' ? {} : JSON.parse(raw);
  process.stdout.write(
    JSON.stringify({
      passed: inputs.verdict === 'pass',
      reason: `verdict fixture saw ${JSON.stringify(inputs.verdict ?? null)}`,
      details: { marker: 'gate-verdict.cjs', received: inputs },
    })
  );
});

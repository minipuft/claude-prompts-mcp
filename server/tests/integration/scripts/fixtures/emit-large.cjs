#!/usr/bin/env node
// Fixture: emits a JSON object whose `payload` field is exactly OUTPUT_CHARS
// long, so a test can drive stdout to either side of the executor's cap.
// The size arrives through the per-execution env (request.env), which is merged
// after the SAFE_ENV_ALLOWLIST filter and so does not need an allowlist entry.
const size = Number.parseInt(process.env.OUTPUT_CHARS ?? '100', 10);
process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ marker: 'emit-large', payload: 'x'.repeat(size) }));
});

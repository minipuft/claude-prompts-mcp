#!/usr/bin/env node
// Fixture: writes a sentinel file named by its `sentinel` input. Execution is
// therefore observable from outside the process, which is what a bypass
// reproduction needs — a return value alone cannot distinguish "ran" from
// "was reported as having run".
const fs = require('fs');
let raw = '';
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  const inputs = raw.trim() === '' ? {} : JSON.parse(raw);
  if (typeof inputs.sentinel === 'string' && inputs.sentinel !== '') {
    fs.writeFileSync(inputs.sentinel, 'executed');
  }
  process.stdout.write(JSON.stringify({ summary: '{{ api_key }}', ran: true }));
});

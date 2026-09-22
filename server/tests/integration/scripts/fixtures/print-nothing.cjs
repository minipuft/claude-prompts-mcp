#!/usr/bin/env node
// Exits 0 having written nothing to stdout. A script tool that returns no value at all is
// refused rather than reported as a success carrying an empty string.
process.stdin.resume();
process.stdin.on('data', () => {});
process.stdin.on('end', () => process.exit(0));

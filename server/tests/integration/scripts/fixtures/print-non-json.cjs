#!/usr/bin/env node
// Fixture: emits plain text on stdout. A script tool's contract is a JSON object there, so this
// is refused by name rather than wrapped as `{ output: '<the text>' }` and reported as success.
process.stdout.write('this is not json');

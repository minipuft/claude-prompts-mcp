#!/usr/bin/env node
// Fixture: writes diagnostics to stderr and exits non-zero.
process.stderr.write('fixture failed on purpose');
process.exit(3);

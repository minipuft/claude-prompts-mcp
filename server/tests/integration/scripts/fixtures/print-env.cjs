#!/usr/bin/env node
// Fixture: reports the environment it was handed, so the allowlist case can
// assert a parent secret never crossed the boundary.
process.stdout.write(JSON.stringify({ env: process.env }));

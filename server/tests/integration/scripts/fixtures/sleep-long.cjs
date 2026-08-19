#!/usr/bin/env node
// Fixture: outlives any timeout the timeout case sets, so SIGTERM/SIGKILL is
// what ends it rather than normal exit.
setTimeout(() => {
  process.stdout.write(JSON.stringify({ finished: true }));
}, 60000);

#!/usr/bin/env tsx
// Thin CLI wrapper — delegates to the canonical service module for full gate bundling support.
import {
  runSkillsSyncFromArgv,
  type SkillsSyncOutput,
} from '../src/modules/skills-sync/service.js';

// The console-backed output lives here, not in the service: this process is a one-shot CLI whose
// stdout is the terminal (and the `--json` report), never the MCP STDIO protocol channel.
const consoleOutput: SkillsSyncOutput = {
  log: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

runSkillsSyncFromArgv(process.argv, consoleOutput).catch((err: Error) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});

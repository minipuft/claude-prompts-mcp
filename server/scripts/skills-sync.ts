#!/usr/bin/env tsx
// Thin CLI wrapper — delegates to the canonical service module for full gate bundling support,
// reading and writing the directories the server itself resolves.
import {
  runSkillsSyncFromArgv,
  type SkillsSyncOutput,
} from '../src/modules/skills-sync/service.js';
import { resolveSkillsSyncPaths } from '../src/runtime/skills-sync-paths.js';

// The console-backed output lives here, not in the service: this process is a one-shot CLI whose
// stdout is the terminal (and the `--json` report), never the MCP STDIO protocol channel.
const consoleOutput: SkillsSyncOutput = {
  log: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

// Paths resolve inside the chain, so a refused path setting reports as `Fatal:` like any failure.
Promise.resolve()
  .then(() => runSkillsSyncFromArgv(process.argv, consoleOutput, resolveSkillsSyncPaths()))
  .catch((err: Error) => {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
  });

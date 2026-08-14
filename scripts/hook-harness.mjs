#!/usr/bin/env node

/**
 * Materializes a TRACED copy of this plugin so a headless session can prove which hooks fired,
 * and proves the copy has not drifted from the real one.
 *
 * WHY A TRACED COPY AT ALL
 * `--debug hooks` logs only hooks that PRODUCE OUTPUT. A hook that exits 0 silently — which is
 * every hook's normal path — leaves no trace, so absence from the log means "said nothing", not
 * "did not run". Measured 2026-08-12: four plugin hooks read as absent and were in fact firing.
 * Wrapping each command in `sh -c 'echo <id> >> TRACE; exec <original>'` makes every invocation
 * mark itself. `exec` replaces the shell, so the hook still receives the same stdin, the same
 * argv, and returns the same exit code — the echo is the only added effect.
 *
 * THE DRIFT THIS FILE EXISTS TO PREVENT
 * A second hooks.json maintained beside the real one is a parallel system: it passes its own
 * tests while the shipped file moves, and the harness then certifies a configuration nobody runs.
 * So there is no second file. The traced config is DERIVED from `hooks/hooks.json` at build time,
 * and `--self-test` proves the derivation is lossless by unwrapping it back and requiring a deep
 * match against the source. A transform that round-trips cannot describe a different plugin.
 *
 * Coverage drifts too, and more quietly: adding a hook to hooks.json silently gains no scenario.
 * `--self-test` therefore also requires every registered hook to be named by a SCENARIO or by an
 * UNTESTABLE entry carrying what would close it, and reports an UNTESTABLE entry that stopped
 * being necessary.
 *
 * WHAT RUNS WHEN
 *   --self-test   pure, milliseconds, no API calls  -> belongs in validate:all
 *   --build       writes a traced plugin to a temp dir -> manual
 *   (running the scenarios spawns `claude -p` and costs real money -> always manual)
 *
 * Usage:
 *   node scripts/hook-harness.mjs --self-test
 *   node scripts/hook-harness.mjs --build <outdir>
 *   node scripts/hook-harness.mjs --scenarios
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS_JSON = path.join(REPO, "hooks", "hooks.json");

/**
 * Scenarios that drive a hook to fire, keyed by the `name` in hooks.json.
 *
 * `prompt` is fed to `claude -p`. `expect` is the trace id the run must contain. These were
 * measured, not guessed — every entry below fired in a real headless session on 2026-08-12.
 */
const SCENARIOS = {
  "prompt-suggest": {
    prompt: ">>reference_demo",
    expect: "UserPromptSubmit|prompt-suggest",
    note: "fires on every prompt; the >> syntax is what makes its injection observable",
  },
  "gate-enforce": {
    prompt:
      "Call the claude-prompts prompt_engine tool with command '>>reference_demo'",
    expect: "PreToolUse|gate-enforce",
    note: "needs a real prompt_engine call — see MCP_REGISTRATION below",
  },
  "chain-tracker": {
    prompt:
      "Call the claude-prompts prompt_engine tool with command '>>reference_demo'",
    expect: "PostToolUse|chain-tracker",
    note: "post-prompt-engine.py registers under the name `chain-tracker`",
  },
  "delegation-enforce": {
    prompt: "Use the Bash tool to run: echo HARNESS",
    expect: "PreToolUse|delegation-enforce",
  },
  "ralph-context-tracker": {
    prompt: "Use the Bash tool to run: echo HARNESS",
    expect: "PostToolUse|ralph-context-tracker",
  },
  "ralph-stop": {
    prompt: "Reply with exactly: OK",
    expect: "Stop|ralph-stop",
    note: "Stop fires on every run; verify it does not BLOCK (terminal_reason: completed)",
  },
};

/**
 * Registered hooks with no scenario. Each needs what would retire it, or it is a permanent hole
 * wearing a temporary label.
 */
const UNTESTABLE = {
  "compact-recovery": {
    reason:
      "SessionStart matcher `compact` fires only after a real compaction, which a short headless " +
      "run cannot reach — a session must first fill its context window.",
    closedBy:
      "A way to force compaction in headless mode, or a fixture that invokes the hook directly " +
      "with a recorded SessionStart:compact payload.",
  },
};

/**
 * The MCP server must be registered with ABSOLUTE paths, not the plugin `.mcp.json`.
 *
 * Measured 2026-08-12: loaded through `--plugin-dir`, the bundled `.mcp.json` did not serve its
 * tools — the model's ToolSearch for `prompt_engine` returned "none found" and the server process
 * exited cleanly. `gate-enforce` and `chain-tracker` only fired once the server was registered
 * via `--mcp-config` with absolute paths. The codex port recorded the same shape against
 * codex-cli 0.146, so treat placeholder interpolation as unreliable until proven otherwise.
 */
export const MCP_REGISTRATION = (repo, workspace) => ({
  mcpServers: {
    "claude-prompts": {
      type: "stdio",
      command: "node",
      args: [path.join(repo, "server/dist/index.js"), "--transport=stdio"],
      env: {
        MCP_WORKSPACE: workspace,
        MCP_RESOURCES_PATH: path.join(repo, "server/resources"),
      },
    },
  },
});

/** Wrap one command so it marks itself. Pure, and invertible by `unwrap`. */
export function wrap(command, event, name, tracePath) {
  if (command.includes("'")) {
    throw new Error(
      `cannot trace a command containing a single quote (${name}): the wrapper is sh -c '...'`,
    );
  }
  return `sh -c 'echo "${event}|${name}" >> ${tracePath}; exec ${command}'`;
}

const WRAPPED = /^sh -c 'echo "[^"]*" >> \S+; exec (.*)'$/;

/** Recover the original command. `unwrap(wrap(x)) === x` is the anti-drift invariant. */
export function unwrap(command) {
  const match = WRAPPED.exec(command);
  return match ? match[1] : command;
}

/** Every registered hook as `{event, name, command}`. */
export function registeredHooks(config) {
  const out = [];
  for (const [event, matchers] of Object.entries(config.hooks || {})) {
    for (const matcher of matchers) {
      for (const hook of matcher.hooks || []) {
        out.push({
          event,
          name: hook.name || "unnamed",
          command: hook.command || "",
        });
      }
    }
  }
  return out;
}

/** Derive the traced config from a real one. Never stored — rebuilt on every use. */
export function traceConfig(config, tracePath) {
  const traced = JSON.parse(JSON.stringify(config));
  for (const [event, matchers] of Object.entries(traced.hooks || {})) {
    for (const matcher of matchers) {
      for (const hook of matcher.hooks || []) {
        hook.command = wrap(
          hook.command,
          event,
          hook.name || "unnamed",
          tracePath,
        );
      }
    }
  }
  return traced;
}

/** Undo `traceConfig`. Used only by the self-test, which is the point. */
export function untraceConfig(traced) {
  const plain = JSON.parse(JSON.stringify(traced));
  for (const matchers of Object.values(plain.hooks || {})) {
    for (const matcher of matchers) {
      for (const hook of matcher.hooks || [])
        hook.command = unwrap(hook.command);
    }
  }
  return plain;
}

/**
 * Coverage findings: a registered hook with neither a scenario nor a declared exception, and an
 * exception that no longer describes anything.
 */
export function coverageProblems(config) {
  const problems = [];
  const hooks = registeredHooks(config);
  const names = new Set(hooks.map((hook) => hook.name));

  for (const { event, name } of hooks) {
    if (SCENARIOS[name] || UNTESTABLE[name]) continue;
    problems.push(
      `${event}|${name} is registered but has no scenario and no UNTESTABLE entry — adding a ` +
        "hook must not silently add an untested hook",
    );
  }

  for (const [name, entry] of Object.entries(UNTESTABLE)) {
    if (!names.has(name)) {
      problems.push(
        `UNTESTABLE names \`${name}\`, which no longer registers — delete the entry`,
      );
    } else if (SCENARIOS[name]) {
      problems.push(
        `\`${name}\` is both UNTESTABLE and has a scenario — the exception is satisfied; ` +
          `delete it. closedBy said: ${entry.closedBy}`,
      );
    } else if (!(entry.closedBy || "").trim()) {
      problems.push(
        `UNTESTABLE \`${name}\` has no closedBy — an exception with no exit is permanent`,
      );
    }
  }

  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    if (!names.has(name)) {
      problems.push(
        `SCENARIOS names \`${name}\`, which no longer registers — delete the scenario`,
      );
    } else if (!scenario.expect.endsWith(`|${name}`)) {
      problems.push(
        `scenario \`${name}\` expects \`${scenario.expect}\`, which is not its own id`,
      );
    }
  }

  return problems.sort();
}

function readConfig() {
  return JSON.parse(readFileSync(HOOKS_JSON, "utf8"));
}

/**
 * Write a traced plugin. `dist` and `resources` are SYMLINKED to the repo so the harness runs the
 * real build, while `runtime-state` stays local so a run cannot mutate this repo's state.db.
 */
function build(outDir) {
  const trace = path.join(outDir, "trace.log");
  mkdirSync(path.join(outDir, ".claude-plugin"), { recursive: true });
  mkdirSync(path.join(outDir, "server", "runtime-state"), { recursive: true });

  cpSync(path.join(REPO, "hooks"), path.join(outDir, "hooks"), {
    recursive: true,
  });
  cpSync(
    path.join(REPO, ".claude-plugin", "plugin.json"),
    path.join(outDir, ".claude-plugin", "plugin.json"),
  );

  for (const dir of ["dist", "resources"]) {
    const link = path.join(outDir, "server", dir);
    if (!existsSync(link)) symlinkSync(path.join(REPO, "server", dir), link);
  }

  writeFileSync(
    path.join(outDir, "hooks", "hooks.json"),
    `${JSON.stringify(traceConfig(readConfig(), trace), null, 2)}\n`,
  );
  writeFileSync(
    path.join(outDir, "mcp-config.json"),
    `${JSON.stringify(MCP_REGISTRATION(REPO, outDir), null, 2)}\n`,
  );
  writeFileSync(trace, "");

  console.log(`traced plugin: ${outDir}`);
  console.log(`  trace file:  ${trace}`);
  console.log("\nRun a scenario (costs API credits):");
  console.log(
    `  cd ${outDir} && claude -p '<prompt>' --plugin-dir ${outDir} ` +
      `--mcp-config ${outDir}/mcp-config.json --dangerously-skip-permissions --output-format json`,
  );
  console.log(`  sort ${trace} | uniq -c    # every hook that fired`);
}

/** Each assertion must be able to fail; a check that cannot fail enforces nothing. */
function selfTest() {
  const config = readConfig();
  let failures = 0;
  const check = (name, ok) => {
    if (ok) console.log(`✔ ${name}`);
    else {
      console.error(`✖ ${name}`);
      failures += 1;
    }
  };

  // THE anti-drift invariant: the traced copy is the real config, reversibly transformed.
  const traced = traceConfig(config, "/tmp/t.log");
  check(
    "traced config unwraps back to the real hooks.json, byte for byte",
    JSON.stringify(untraceConfig(traced)) === JSON.stringify(config),
  );
  check(
    "tracing actually changed every command (the transform is not a no-op)",
    registeredHooks(traced).every((hook) =>
      hook.command.startsWith("sh -c 'echo "),
    ) && registeredHooks(config).length > 0,
  );
  check(
    "every real command round-trips individually",
    registeredHooks(config).every(
      ({ event, name, command }) =>
        unwrap(wrap(command, event, name, "/tmp/t.log")) === command,
    ),
  );
  check(
    "a command that was never wrapped is returned unchanged",
    unwrap("python3 /x/y.py") === "python3 /x/y.py",
  );

  // A drifted copy must be caught, or the invariant above is decorative.
  const drifted = traceConfig(config, "/tmp/t.log");
  registeredHooks(drifted); // touch
  const firstEvent = Object.keys(drifted.hooks)[0];
  drifted.hooks[firstEvent][0].hooks[0].command =
    "sh -c 'echo \"x|y\" >> /tmp/t.log; exec python3 /impostor.py'";
  check(
    "a traced copy whose underlying command changed FAILS the round-trip",
    JSON.stringify(untraceConfig(drifted)) !== JSON.stringify(config),
  );

  check(
    "a command containing a single quote is refused rather than silently mis-quoted",
    (() => {
      try {
        wrap("python3 'x'.py", "E", "n", "/tmp/t.log");
        return false;
      } catch {
        return true;
      }
    })(),
  );

  // Coverage: adding a hook must not silently add an untested hook.
  const problems = coverageProblems(config);
  check(
    `every registered hook has a scenario or a declared exception`,
    problems.length === 0,
  );
  for (const problem of problems) console.error(`    ${problem}`);

  const extra = JSON.parse(JSON.stringify(config));
  extra.hooks.Stop[0].hooks.push({
    command: "python3 x.py",
    name: "brand-new-hook",
  });
  check(
    "a NEWLY ADDED hook with no scenario is detected",
    coverageProblems(extra).some((problem) =>
      problem.includes("brand-new-hook"),
    ),
  );

  const satisfied = JSON.parse(JSON.stringify(config));
  satisfied.hooks.Stop[0].hooks.push({
    command: "python3 x.py",
    name: "ralph-stop",
  });
  check(
    "a scenario naming a hook that no longer registers is detected",
    coverageProblems({ hooks: {} }).some((problem) =>
      problem.includes("no longer registers"),
    ),
  );

  const covered = Object.keys(SCENARIOS).length;
  const total = registeredHooks(config).length;
  console.log(
    `\nhook-harness self-test ${failures === 0 ? "OK" : "FAILED"} — ${covered}/${total} registered ` +
      `hooks have scenarios, ${Object.keys(UNTESTABLE).length} declared untestable.`,
  );
  return failures === 0 ? 0 : 1;
}

function listScenarios() {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    console.log(
      `${name}\n  expect: ${scenario.expect}\n  prompt: ${scenario.prompt}`,
    );
    if (scenario.note) console.log(`  note:   ${scenario.note}`);
  }
  for (const [name, entry] of Object.entries(UNTESTABLE)) {
    console.log(
      `${name}\n  UNTESTABLE: ${entry.reason}\n  closedBy:   ${entry.closedBy}`,
    );
  }
}

const argv = process.argv.slice(2);
if (argv.includes("--self-test")) process.exit(selfTest());
else if (argv.includes("--scenarios")) listScenarios();
else if (argv.includes("--build")) {
  const outDir = argv[argv.indexOf("--build") + 1];
  if (!outDir) {
    console.error("--build needs an output directory");
    process.exit(1);
  }
  build(path.resolve(outDir));
} else {
  console.error(
    "usage: hook-harness.mjs [--self-test | --build <dir> | --scenarios]",
  );
  process.exit(1);
}

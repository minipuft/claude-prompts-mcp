#!/usr/bin/env node

const assert = require("node:assert/strict");
const { statSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

function interpreterCandidates(platform) {
  return platform === "win32"
    ? [
        { command: "py", prefixArgs: ["-3"] },
        { command: "python3", prefixArgs: [] },
        { command: "python", prefixArgs: [] },
      ]
    : [
        { command: "python3", prefixArgs: [] },
        { command: "python", prefixArgs: [] },
      ];
}

function isPythonFile(filePath) {
  try {
    return path.extname(filePath) === ".py" && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function runPythonHook({
  script,
  args = [],
  platform = process.platform,
  spawn = spawnSync,
  fileExists = isPythonFile,
}) {
  if (!script || !fileExists(script)) {
    return {
      exitCode: 2,
      message: `Python hook script is missing or invalid: ${script || "<missing>"}`,
    };
  }

  for (const candidate of interpreterCandidates(platform)) {
    const result = spawn(
      candidate.command,
      [...candidate.prefixArgs, script, ...args],
      {
        shell: false,
        stdio: "inherit",
        windowsHide: true,
      },
    );

    if (result.error?.code === "ENOENT") continue;
    if (result.error) {
      return {
        exitCode: 1,
        message: `Failed to launch ${candidate.command}: ${result.error.message}`,
      };
    }
    if (typeof result.status === "number") return { exitCode: result.status };
    return {
      exitCode: 1,
      message: result.signal
        ? `Python hook terminated by signal ${result.signal}`
        : "Python hook exited without a status",
    };
  }

  return {
    exitCode: 127,
    message:
      "No Python 3 interpreter found. Install Python 3 with the Windows py launcher or provide python3/python on PATH.",
  };
}

function selfTest() {
  assert.deepEqual(interpreterCandidates("win32"), [
    { command: "py", prefixArgs: ["-3"] },
    { command: "python3", prefixArgs: [] },
    { command: "python", prefixArgs: [] },
  ]);
  assert.deepEqual(interpreterCandidates("linux"), [
    { command: "python3", prefixArgs: [] },
    { command: "python", prefixArgs: [] },
  ]);

  const attempted = [];
  const fallback = runPythonHook({
    script: "/fixture/hook.py",
    platform: "win32",
    fileExists: () => true,
    spawn: (command, args) => {
      attempted.push([command, args]);
      return command === "py"
        ? { error: Object.assign(new Error("missing"), { code: "ENOENT" }) }
        : { status: 0 };
    },
  });
  assert.equal(fallback.exitCode, 0);
  assert.deepEqual(
    attempted.map(([command]) => command),
    ["py", "python3"],
  );
  assert.deepEqual(attempted[0][1], ["-3", "/fixture/hook.py"]);

  let failureAttempts = 0;
  const scriptFailure = runPythonHook({
    script: "/fixture/hook.py",
    platform: "win32",
    fileExists: () => true,
    spawn: () => {
      failureAttempts += 1;
      return { status: 7 };
    },
  });
  assert.equal(scriptFailure.exitCode, 7);
  assert.equal(failureAttempts, 1);

  assert.equal(runPythonHook({ script: "missing.py" }).exitCode, 2);
  assert.equal(
    runPythonHook({
      script: "/fixture/hook.py",
      fileExists: () => true,
      spawn: () => ({
        error: Object.assign(new Error("missing"), { code: "ENOENT" }),
      }),
    }).exitCode,
    127,
  );

  process.stdout.write("python-hook-runner self-test — 7/7 checks passed\n");
}

function main() {
  if (process.argv[2] === "--self-test") {
    selfTest();
    return;
  }

  const result = runPythonHook({
    script: process.argv[2],
    args: process.argv.slice(3),
  });
  if (result.message) process.stderr.write(`${result.message}\n`);
  process.exitCode = result.exitCode;
}

if (require.main === module) main();

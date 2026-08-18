#!/usr/bin/env node
/**
 * Every hook this plugin ships must be reachable, and every hook it registers must exist.
 *
 * Both directions failed silently before this gate (2026-08-05):
 *
 *   unregistered -> a hook that sits in `hooks/` wired into no `hooks.json`, here or
 *                   downstream. It looks like a live hook in every listing, ships in the npm
 *                   tarball, and runs nowhere — and a downstream adapter can import it as if
 *                   it were a supported module.
 *
 *   dangling     -> the reverse is worse. A `hooks.json` entry naming a file that is not in
 *                   the package makes the hook command fail to launch, and a hook that fails
 *                   to launch is read as a BLOCK decision on that event by Codex — so a
 *                   half-shipped hook set can block every user prompt rather than degrade.
 *
 * This is a packaging invariant, not a style rule: `hooks/` is published, consumed by three
 * downstream ports, and its `hooks.json` is copied verbatim into their plugin caches.
 *
 * An unregistered hook is allowed ONLY with a declared exception naming what closes it. An
 * exception with no exit is a permanent bypass wearing a temporary label.
 *
 * Usage:
 *   node scripts/validate-hook-registration.js
 *   node scripts/validate-hook-registration.js --self-test
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const HOOKS_DIR = path.join(REPO_ROOT, "hooks");
const HOOKS_JSON = path.join(HOOKS_DIR, "hooks.json");

/** Modules, not hooks: imported by hooks rather than invoked by an event. */
const MODULE_PREFIXES = ["_"];

/**
 * Lifecycle events a hook may register on.
 *
 * Measured 2026-08-12: renaming `PreToolUse` to `PreToolUze` in hooks.json left this gate GREEN.
 * Every check above walks `Object.values(config.hooks)` and never reads the key, so a typo'd event
 * registers the script, satisfies "registered", and fires on nothing. That is the same dead-hook
 * shape the file opens with, entered through the one door it did not watch.
 *
 * Kept as a literal set rather than derived: there is no machine-readable source for it, and a
 * list that silently accepts anything is what produced the finding.
 */
const KNOWN_EVENTS = new Set([
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Notification",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "SessionStart",
  "SessionEnd",
]);

/**
 * Tool names a `PreToolUse`/`PostToolUse` matcher may name literally.
 *
 * A matcher is a REGEX, so this only grades bare alternatives — `Edit|Write|Bash` — and skips
 * anything carrying regex syntax (`.*prompt_engine` names an MCP tool by pattern and cannot be
 * enumerated here). `Edt|Wrte|Bsh` passed every check before this existed: the hook stayed
 * registered, the file stayed present, and it matched no tool the host ever emits.
 *
 * `Task` and `Agent` are BOTH listed deliberately — the subagent tool was renamed and a matcher
 * naming only the retired one degrades silently to no coverage.
 */
const KNOWN_TOOLS = new Set([
  "Agent",
  "Bash",
  "BashOutput",
  "Edit",
  "ExitPlanMode",
  "Glob",
  "Grep",
  "KillShell",
  "NotebookEdit",
  "Read",
  "Skill",
  "SlashCommand",
  "Task",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "Write",
]);

/** Events whose matcher names a TOOL. Everything else matches a source/trigger string. */
const TOOL_MATCHED_EVENTS = new Set(["PreToolUse", "PostToolUse"]);

/** A matcher we grade literally: bare names and `|` only, no regex metacharacters. */
const LITERAL_MATCHER = /^[A-Za-z0-9_]+(\|[A-Za-z0-9_]+)*$/;

const UNREGISTERED_EXCEPTIONS = {};

/** Script basenames referenced by any command in hooks.json. */
function registeredScripts(config) {
  const names = new Set();
  for (const matchers of Object.values(config.hooks || {})) {
    for (const matcher of matchers) {
      for (const hook of matcher.hooks || []) {
        const command = hook.command || "";
        for (const match of command.matchAll(/([\w.-]+\.py)/g))
          names.add(match[1]);
      }
    }
  }
  return names;
}

function shippedHooks(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".py"))
    .filter((f) => !MODULE_PREFIXES.some((p) => f.startsWith(p)))
    .sort();
}

/**
 * Wiring that is present but cannot fire: an unknown event, or a matcher that names no real tool.
 *
 * Both are INVISIBLE to the registration checks, which only ask whether a script is named and
 * whether its file exists. A hook can pass both and still be as dead as an unregistered one — the
 * difference is that this kind looks wired in every listing, including this gate's own output.
 */
function deadWiring(config) {
  const problems = [];

  for (const [event, matchers] of Object.entries(config.hooks || {})) {
    if (!KNOWN_EVENTS.has(event)) {
      problems.push(
        `event \`${event}\` is not a lifecycle event — every hook under it is registered and ` +
          "fires on nothing",
      );
      continue;
    }

    for (const matcher of matchers) {
      const pattern = matcher.matcher;
      // Absent or `*` means "every invocation of this event" — nothing to grade.
      if (pattern === undefined || pattern === "*") continue;

      try {
        new RegExp(pattern);
      } catch (error) {
        problems.push(
          `${event} matcher \`${pattern}\` is not a valid regex: ${error.message}`,
        );
        continue;
      }

      if (!TOOL_MATCHED_EVENTS.has(event)) continue;
      if (!LITERAL_MATCHER.test(pattern)) continue; // a real pattern; not enumerable here

      const unknown = pattern
        .split("|")
        .filter((name) => !KNOWN_TOOLS.has(name));
      if (unknown.length > 0) {
        problems.push(
          `${event} matcher \`${pattern}\` names no such tool: ${unknown.join(", ")} — the hook ` +
            "is registered and matches nothing",
        );
      }
    }
  }

  return problems.sort();
}

/**
 * A `hooks.json` anywhere the host does not read is a registration file that looks authoritative
 * and is inert.
 *
 * This is not hypothetical: six global hooks under `~/.claude/hooks/hooks.json` were dead for
 * weeks because Claude Code reads `settings.json`, not that file, and nothing said so. Here the
 * host auto-discovers exactly `hooks/hooks.json`; any sibling copy is a trap for the next reader.
 */
function orphanRegistrationFiles(repoRoot, canonical) {
  const found = [];
  const skip = new Set(["node_modules", "dist", ".git", "coverage", ".next"]);

  const walk = (dir, depth) => {
    if (depth > 3) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name === "hooks.json" && full !== canonical)
        found.push(path.relative(repoRoot, full));
    }
  };
  walk(repoRoot, 0);
  return found.sort();
}

function collect(hooksDir, hooksJsonPath) {
  const config = JSON.parse(fs.readFileSync(hooksJsonPath, "utf8"));
  const registered = registeredScripts(config);
  const shipped = shippedHooks(hooksDir);
  const dead = deadWiring(config);

  const unregistered = shipped.filter(
    (f) => !registered.has(f) && !UNREGISTERED_EXCEPTIONS[f],
  );
  const dangling = [...registered]
    .filter((f) => !fs.existsSync(path.join(hooksDir, f)))
    .sort();
  const staleExceptions = Object.keys(UNREGISTERED_EXCEPTIONS).filter(
    (f) => !shipped.includes(f) || registered.has(f),
  );

  return { registered, shipped, unregistered, dangling, staleExceptions, dead };
}

function selfTest() {
  const os = require("node:os");
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "hook-registration-"));
  const write = (name, body) =>
    fs.writeFileSync(path.join(sandbox, name), body);
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  try {
    write("alpha.py", "");
    write("_module.py", "");
    write(
      "hooks.json",
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "*",
              hooks: [
                { command: "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/alpha.py" },
              ],
            },
          ],
        },
      }),
    );
    let result = collect(sandbox, path.join(sandbox, "hooks.json"));
    assert(result.unregistered.length === 0, "registered hook wrongly flagged");
    assert(
      result.dangling.length === 0,
      "existing hook wrongly flagged as dangling",
    );
    assert(
      !result.shipped.includes("_module.py"),
      "underscore module treated as a hook",
    );

    // An unregistered hook with no exception is the motivating failure — it must fail.
    write("orphan.py", "");
    result = collect(sandbox, path.join(sandbox, "hooks.json"));
    assert(
      result.unregistered.includes("orphan.py"),
      "unregistered hook NOT detected — the gate is vacuous",
    );

    // A hooks.json entry naming a missing file must fail too.
    fs.unlinkSync(path.join(sandbox, "alpha.py"));
    result = collect(sandbox, path.join(sandbox, "hooks.json"));
    assert(
      result.dangling.includes("alpha.py"),
      "dangling registration NOT detected",
    );

    // --- dead wiring: registered, file present, fires on nothing -----------------------------
    const wiring = (hooks) => deadWiring({ hooks });

    assert(
      wiring({ PreToolUze: [{ matcher: "*", hooks: [{ command: "x.py" }] }] })
        .length === 1,
      "a typo'd EVENT was not detected — this exact mutation left the gate green on 2026-08-12",
    );
    assert(
      wiring({ PreToolUse: [{ matcher: "Edt|Wrte", hooks: [] }] }).length === 1,
      "a matcher naming no real tool was not detected",
    );
    assert(
      wiring({ PreToolUse: [{ matcher: "Edit|Write|Bash", hooks: [] }] })
        .length === 0,
      "a valid tool matcher was wrongly flagged",
    );
    assert(
      wiring({ PreToolUse: [{ matcher: ".*prompt_engine", hooks: [] }] })
        .length === 0,
      "a regex matcher must be skipped, not graded against the literal tool list",
    );
    assert(
      wiring({ PreToolUse: [{ matcher: "Edit(", hooks: [] }] }).length === 1,
      "an uncompilable matcher was not detected",
    );
    assert(
      wiring({ SessionStart: [{ matcher: "compact", hooks: [] }] }).length ===
        0,
      "a non-tool event matcher must not be graded against tool names",
    );
    assert(
      wiring({ Stop: [{ hooks: [] }] }).length === 0,
      'an absent matcher means "every invocation" and must not be flagged',
    );

    // --- orphan registration files ------------------------------------------------------------
    const canonical = path.join(sandbox, "hooks.json");
    assert(
      orphanRegistrationFiles(sandbox, canonical).length === 0,
      "the canonical hooks.json was wrongly reported as an orphan",
    );
    fs.mkdirSync(path.join(sandbox, "nested"));
    write(path.join("nested", "hooks.json"), "{}");
    assert(
      orphanRegistrationFiles(sandbox, canonical).includes("nested/hooks.json"),
      "a second hooks.json was NOT detected — the global dead-hook shape stays invisible",
    );

    console.log(
      "validate-hook-registration self-test OK — detects an unregistered hook, a dangling " +
        "registration, a typo'd event, a matcher naming no real tool, an uncompilable matcher, " +
        "an orphan registration file, and ignores underscore-prefixed modules.",
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();

  const { shipped, unregistered, dangling, staleExceptions, dead } = collect(
    HOOKS_DIR,
    HOOKS_JSON,
  );
  const orphans = orphanRegistrationFiles(REPO_ROOT, HOOKS_JSON);
  let failed = false;

  if (dead.length > 0) {
    console.error(
      "[validate-hook-registration] registered wiring that cannot fire:\n",
    );
    for (const problem of dead) console.error(`  ${problem}`);
    console.error(
      "\nThese pass every registration check — the script is named and the file exists — and the\n" +
        "hook still runs on nothing. Fix the event name or the matcher.",
    );
    failed = true;
  }

  if (orphans.length > 0) {
    if (failed) console.error("");
    console.error(
      "[validate-hook-registration] hooks.json files the host never reads:\n",
    );
    for (const orphan of orphans) console.error(`  ${orphan}`);
    console.error(
      "\nOnly hooks/hooks.json is auto-discovered. A second one looks like registration and is\n" +
        "inert — the exact shape that left six global hooks dead for weeks.",
    );
    failed = true;
  }

  if (dangling.length > 0) {
    console.error(
      "[validate-hook-registration] hooks.json names files that do not exist:\n",
    );
    for (const name of dangling) console.error(`  ${name}`);
    console.error(
      "\nA hook command that cannot launch is read as a BLOCK decision on that event by Codex.\n" +
        "Ship the file or remove the registration.",
    );
    failed = true;
  }

  if (unregistered.length > 0) {
    if (failed) console.error("");
    console.error(
      "[validate-hook-registration] shipped hooks that no hooks.json registers:\n",
    );
    for (const name of unregistered) console.error(`  hooks/${name}`);
    console.error(
      "\nThese ship in the npm tarball and run nowhere, which reads as a live hook to anyone\n" +
        "listing the directory. Register it, delete it, move it to a `_`-prefixed module, or add\n" +
        "an UNREGISTERED_EXCEPTIONS entry naming what closes it.",
    );
    failed = true;
  }

  if (staleExceptions.length > 0) {
    if (failed) console.error("");
    console.error(
      "[validate-hook-registration] exceptions that no longer apply:\n",
    );
    for (const name of staleExceptions)
      console.error(`  ${name} — now registered or deleted`);
    console.error(
      "\nRemove the entry; a bypass outliving its cause is how they become permanent.",
    );
    failed = true;
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }

  const exempt = Object.keys(UNREGISTERED_EXCEPTIONS).length;
  console.log(
    `validate-hook-registration OK — ${shipped.length - exempt}/${shipped.length} shipped hooks ` +
      `registered, ${exempt} declared exception(s), no dangling registrations; every event and ` +
      "matcher can fire, one registration file.",
  );
}

main();

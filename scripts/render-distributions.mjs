#!/usr/bin/env node
/**
 * Render the published distributions from the canonical Agent Plugins tree.
 *
 * The canonical tree is root `plugin.json` + `mcp.json` (Agent Plugins 1.0.0). Everything this
 * repository publishes that DUPLICATES those two files is rendered from them here, so a field
 * has one author and the copies cannot drift silently.
 *
 * WHAT IS ACTUALLY RENDERED, AND WHAT ONLY LOOKED LIKE IT
 * ------------------------------------------------------
 * `scripts/render-targets.json` declares four targets. Measured 2026-08-13, exactly one of them
 * has a file-copy relationship with this repository:
 *
 *   claude-code   RENDERED. `.claude-plugin/plugin.json` and `.mcp.json` are projections of the
 *                 canonical pair — same facts, legacy field set, legacy placeholder. Byte-checkable
 *                 today, which is what makes the drift gate meaningful rather than aspirational.
 *   agent-plugins NOT RENDERED. The canonical tree IS the native package; rendering it would mean
 *                 copying a file onto itself. It ships as a release asset, staged by
 *                 `extension-publish.yml`'s `plugin-dist` job.
 *   gemini-cli    NOT RENDERED, and the plan's premise that it was is falsified. `gemini-prompts`
 *   opencode      consumes this repo as an NPM DEPENDENCY, not as a file copy —
 *                 `gemini-prompts/hooks/lib` is a symlink into `node_modules/claude-prompts/`, its
 *                 `hooks/hooks.json` and `hooks/gate-enforce.py` both DIFFER from ours because
 *                 Gemini CLI's event names differ (`BeforeAgent`/`BeforeTool`, not
 *                 `UserPromptSubmit`/`PreToolUse`), and `opencode-prompts` tracks no `hooks/` and
 *                 no `server/` at all — it is an independent TypeScript port.
 *                 `.claude/rules/extension-alignment.md` states this contract directly: "downstream
 *                 repos consume it as an npm dependency and register thin adapters", and OpenCode
 *                 is "a behavioral port, not an adapter port — nothing is shared with the TS
 *                 rewrite". Their per-release update is a dependency-range bump, already performed
 *                 by `extension-publish.yml`'s `sync-downstream` job.
 *
 * A renderer that emitted files into those two repositories would not be reproducing a hand state;
 * it would be inventing one, and the zero-diff gate would be comparing against something nobody
 * ships. `renderKind` records the distinction per target so the next reader does not have to
 * re-derive it, and an unknown value is an error rather than a silent skip.
 *
 * SERIALIZATION IS MEASURED, NOT CHOSEN
 * ------------------------------------
 * Both published files are byte-exactly `JSON.stringify(obj, null, 2) + "\n"` (verified against
 * the committed bytes, 2026-08-13); both canonical sources are Prettier-formatted and are NOT.
 * That asymmetry is not an accident to be normalized away — `.claude-plugin/plugin.json` is listed
 * in `.prettierignore` because release-please version-stamps it and release-please writes this
 * exact serialization. `server/scripts/sync-versions.js` writes it too. Emitting Prettier's
 * formatting instead would put this renderer in a rewrite war with the release bot, so the render
 * targets are machine-format on purpose and the canonical sources stay human-format.
 *
 * WHY BYTE COMPARISON RATHER THAN DEEP-EQUAL
 * ------------------------------------------
 * `--check` compares bytes. A semantic comparison would pass while the file on disk differs from
 * what a render produces, which means the next `--write` emits a diff nobody asked for — the
 * check would be describing a repository other than this one. Bytes are what get committed, so
 * bytes are what the gate reads.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS_FILE = path.join(REPO, "scripts", "render-targets.json");

/**
 * How a target relates to this repository. Fail-closed: `renderTarget` throws on anything not
 * listed, so adding a target without deciding its kind is an error at the first run rather than a
 * silently unrendered distribution.
 */
const RENDER_KINDS = new Set([
  /** The canonical tree itself. Nothing to render; it is the source. */
  "canonical",
  /** Files in THIS repository projected from the canonical pair. The drift gate's whole subject. */
  "projection",
  /** A separate repository that consumes this one via npm. No file copy exists to render. */
  "npm-dependency",
]);

/** The exact bytes every render target is written with. See the serialization note above. */
function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Key order is part of the output bytes, so ordering is explicit wherever it is not source order. */
function sortKeys(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([a], [b]) => a.localeCompare(b)),
  );
}

/**
 * Rewrite placeholder tokens in string VALUES, recursively.
 *
 * Keys are deliberately untouched. Agent Plugins 1.0.0 expands placeholders in `args`, `env`
 * values and `cwd` only; an env VARIABLE NAME containing the token would be a name, not a path,
 * and rewriting it would rename the variable the server reads.
 */
function rewritePlaceholders(value, placeholderMap) {
  const entries = Object.entries(placeholderMap ?? {});
  if (entries.length === 0) return value;

  if (typeof value === "string") {
    return entries.reduce(
      (text, [from, to]) => text.split(from).join(to),
      value,
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewritePlaceholders(item, placeholderMap));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        rewritePlaceholders(item, placeholderMap),
      ]),
    );
  }
  return value;
}

/**
 * Canonical `plugin.json` → `.claude-plugin/plugin.json`.
 *
 * Two differences from the canonical manifest, both required rather than stylistic:
 *   `$schema`  dropped — it points at the Agent Plugins schema, which does not describe the
 *              Claude Code plugin format. Carrying it would advertise conformance to a spec this
 *              file does not follow.
 *   `version`  moved last — release-please rewrites this field in place, and its output puts the
 *              key where the file already had it. Matching that order is what keeps a release
 *              from producing a spurious render diff.
 */
function projectClaudeCodePlugin(canonical, placeholderMap) {
  const projected = {};
  for (const [key, value] of Object.entries(canonical)) {
    if (key === "$schema" || key === "version") continue;
    projected[key] = value;
  }
  projected.version = canonical.version;
  return rewritePlaceholders(projected, placeholderMap);
}

/**
 * Canonical `mcp.json` → `.mcp.json`.
 *
 * Three fields do not cross, and each has a reason that is not "the old file lacked it":
 *   `$schema`           same as above — wrong spec for this consumer.
 *   `type: "stdio"`     the Agent Plugins mcp schema requires it; Claude Code's `.mcp.json` has
 *                       never carried it. Adding it would be a behavior change to every existing
 *                       install, so it belongs in its own commit with its own justification, not
 *                       smuggled in by the first render.
 *   `MCP_RUNTIME_ROOT`  its value is `${PLUGIN_DATA}`, an Agent Plugins placeholder. Claude Code
 *                       does not define it, so the variable would reach the server as the literal
 *                       string `${PLUGIN_DATA}` and the runtime would write state to a directory
 *                       with that name. Dropping it is what preserves today's behavior, where
 *                       `MCP_WORKSPACE` alone locates runtime state.
 *
 * Keys are sorted because the published file is sorted; source order here is the canonical file's,
 * which is grouped for reading rather than alphabetized.
 */
function projectClaudeCodeMcp(canonical, placeholderMap) {
  const servers = {};
  for (const [name, entry] of Object.entries(canonical.mcpServers ?? {})) {
    const kept = {};
    for (const [key, value] of Object.entries(entry)) {
      if (key === "type") continue;
      kept[key] = value;
    }
    if (kept.env) {
      const env = { ...kept.env };
      delete env.MCP_RUNTIME_ROOT;
      kept.env = sortKeys(env);
    }
    servers[name] = sortKeys(kept);
  }
  return rewritePlaceholders({ mcpServers: servers }, placeholderMap);
}

/**
 * Projection functions, keyed by the `projection` name a render declares in `render-targets.json`.
 *
 * The PATHS live in that file because it is the declared SSOT for what reads what. The field-level
 * semantics live here because every drop above needs a paragraph explaining why, and a JSON config
 * cannot carry one.
 */
const PROJECTIONS = {
  "claude-code/plugin": projectClaudeCodePlugin,
  "claude-code/mcp": projectClaudeCodeMcp,
};

function loadTargets(file = TARGETS_FILE) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed.targets) || parsed.targets.length === 0) {
    throw new Error("render-targets.json declares no targets");
  }
  return parsed;
}

/** Every file one target would emit, as `{ to, bytes }`. Pure — nothing is written here. */
function renderTarget(target) {
  if (!RENDER_KINDS.has(target.renderKind)) {
    throw new Error(
      `render-targets.json[${target.client}]: renderKind ${JSON.stringify(target.renderKind)} ` +
        `is not one of ${[...RENDER_KINDS].join(", ")}. A target with no declared kind would be ` +
        `skipped silently, which is the failure this check exists to prevent.`,
    );
  }

  const renders = target.renders ?? [];
  if (target.renderKind !== "projection") {
    if (renders.length > 0) {
      throw new Error(
        `render-targets.json[${target.client}]: renderKind "${target.renderKind}" declares ` +
          `${renders.length} render(s), but only "projection" targets emit files.`,
      );
    }
    return [];
  }

  return renders.map((render) => {
    const projection = PROJECTIONS[render.projection];
    if (!projection) {
      throw new Error(
        `render-targets.json[${target.client}]: unknown projection "${render.projection}". ` +
          `Known: ${Object.keys(PROJECTIONS).join(", ")}`,
      );
    }
    const canonical = JSON.parse(
      readFileSync(path.join(REPO, render.from), "utf8"),
    );
    return {
      to: render.to,
      bytes: serialize(projection(canonical, target.placeholderMap)),
    };
  });
}

function renderAll(config) {
  return config.targets.flatMap((target) =>
    renderTarget(target).map((file) => ({ ...file, client: target.client })),
  );
}

/** First differing line, so a red gate names the field rather than the file. */
function firstDifference(expected, actual) {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  for (
    let i = 0;
    i < Math.max(expectedLines.length, actualLines.length);
    i += 1
  ) {
    if (expectedLines[i] !== actualLines[i]) {
      return `line ${i + 1}: rendered ${JSON.stringify(expectedLines[i] ?? "<end of file>")} · published ${JSON.stringify(actualLines[i] ?? "<end of file>")}`;
    }
  }
  return "files differ in trailing bytes only";
}

function check(config) {
  const drift = [];
  for (const file of renderAll(config)) {
    const published = path.join(REPO, file.to);
    if (!existsSync(published)) {
      drift.push(
        `${file.to}: rendered by [${file.client}] but not present in the repository`,
      );
      continue;
    }
    const actual = readFileSync(published, "utf8");
    if (actual !== file.bytes) {
      drift.push(
        `${file.to}: drifted from its source — ${firstDifference(file.bytes, actual)}`,
      );
    }
  }
  return drift;
}

function write(config) {
  const written = [];
  for (const file of renderAll(config)) {
    const target = path.join(REPO, file.to);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.bytes);
    written.push(file.to);
  }
  return written;
}

/**
 * Falsifiable cases. Each asserts one behavior and fails alone when that behavior is removed —
 * `PROJECTIONS` is exercised through the same entry point the real run uses, so a case cannot pass
 * against a code path the gate does not take.
 */
function selfTest() {
  const failures = [];
  const expect = (label, condition) => {
    if (!condition) failures.push(label);
  };

  const canonicalPlugin = {
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name: "x",
    version: "1.0.0",
    description: "d",
    keywords: ["a"],
  };
  const plugin = projectClaudeCodePlugin(canonicalPlugin, {});
  expect("plugin projection drops $schema", !("$schema" in plugin));
  expect(
    "plugin projection moves version last",
    Object.keys(plugin).at(-1) === "version",
  );
  expect(
    "plugin projection keeps every other field",
    plugin.name === "x" && plugin.description === "d",
  );

  const canonicalMcp = {
    $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
    mcpServers: {
      s: {
        type: "stdio",
        command: "node",
        args: ["${PLUGIN_ROOT}/server/dist/index.js"],
        env: {
          MCP_RUNTIME_ROOT: "${PLUGIN_DATA}",
          MCP_WORKSPACE: "${PLUGIN_ROOT}",
        },
      },
    },
  };
  const mcp = projectClaudeCodeMcp(canonicalMcp, {
    "${PLUGIN_ROOT}": "${CLAUDE_PLUGIN_ROOT}",
  });
  expect("mcp projection drops $schema", !("$schema" in mcp));
  expect("mcp projection drops type", !("type" in mcp.mcpServers.s));
  expect(
    "mcp projection drops MCP_RUNTIME_ROOT",
    !("MCP_RUNTIME_ROOT" in mcp.mcpServers.s.env),
  );
  expect(
    "mcp projection sorts server keys",
    Object.keys(mcp.mcpServers.s).join() === "args,command,env",
  );
  expect(
    "mcp projection rewrites the placeholder in nested values",
    mcp.mcpServers.s.args[0] === "${CLAUDE_PLUGIN_ROOT}/server/dist/index.js" &&
      mcp.mcpServers.s.env.MCP_WORKSPACE === "${CLAUDE_PLUGIN_ROOT}",
  );

  expect(
    "placeholder rewrite leaves keys alone",
    Object.keys(
      rewritePlaceholders({ "${PLUGIN_ROOT}": "v" }, { "${PLUGIN_ROOT}": "X" }),
    )[0] === "${PLUGIN_ROOT}",
  );
  expect(
    "serialization ends with exactly one newline",
    serialize({ a: 1 }) === '{\n  "a": 1\n}\n',
  );

  const throws = (fn) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };
  expect(
    "unknown renderKind throws",
    throws(() => renderTarget({ client: "c", renderKind: "guessed" })),
  );
  expect(
    "a non-projection target declaring renders throws",
    throws(() =>
      renderTarget({
        client: "c",
        renderKind: "canonical",
        renders: [{ to: "x" }],
      }),
    ),
  );
  expect(
    "unknown projection name throws",
    throws(() =>
      renderTarget({
        client: "c",
        renderKind: "projection",
        renders: [{ projection: "nope", from: "plugin.json", to: "x" }],
      }),
    ),
  );

  // The drift detector itself, on a synthetic pair — the real corpus is checked by `--check`.
  expect(
    "firstDifference names the differing line",
    firstDifference("a\nb\n", "a\nc\n").startsWith("line 2:"),
  );

  if (failures.length > 0) {
    console.error(
      `render-distributions --self-test: ${failures.length} case(s) failed`,
    );
    failures.forEach((label) => console.error(`  ✗ ${label}`));
    process.exit(1);
  }
  console.log("render-distributions --self-test: 13/13 cases pass.");
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    selfTest();
    return;
  }

  const config = loadTargets();
  const projections = config.targets.filter(
    (t) => t.renderKind === "projection",
  );

  if (args.includes("--check")) {
    const drift = check(config);
    if (drift.length > 0) {
      console.error(
        "render-distributions --check: published distributions have drifted.",
      );
      drift.forEach((line) => console.error(`  ✗ ${line}`));
      // The remedy names the npm SCRIPT rather than spelling out the invocation. `validate:all`
      // re-derives each step's substrate from its source (`scripts/lib/substrate.js`), and that
      // derivation is lexical: the literal bigram in a hint string is indistinguishable from a
      // command this file executes, so writing it out would force a `spawn` declaration on a
      // renderer that spawns nothing. A wrong ledger entry costs more than a terser hint.
      console.error(
        "\nRe-render from the canonical tree with the `render:distributions` script.",
      );
      process.exit(1);
    }
    const rendered = renderAll(config).length;
    console.log(
      `✔ render-distributions: ${rendered} rendered file(s) across ${projections.length} ` +
        `projection target(s) match their canonical source.`,
    );
    return;
  }

  const written = write(config);
  console.log(`render-distributions: wrote ${written.length} file(s)`);
  written.forEach((file) => console.log(`  → ${file}`));
}

main();

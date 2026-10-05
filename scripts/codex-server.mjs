#!/usr/bin/env node
// Local operator tool; never edits plugin caches or the running Codex session.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  rm,
  lstat,
  open,
  readFile,
  readdir,
  rename,
  unlink,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { isDeepStrictEqual, parseArgs } from "node:util";

const repoRoot = resolve(import.meta.dirname, "..");
const directId = "claude_prompts_mcp";
const productionId = "codex-prompts@minipuft";
const developmentId = "codex-prompts@codex-prompts-dev";
const reconnect =
  "Reconnect/restart Codex to load this configuration. Running session/build: unknown (not inspected).";

function readToml(text) {
  let parser;
  try {
    parser = createRequire(join(repoRoot, "server/package.json"))("smol-toml");
  } catch {
    throw new Error(
      "TOML parser unavailable. Install the locked server dependencies before using this script.",
    );
  }
  try {
    return parser.parse(text, { integersAsBigInt: true });
  } catch {
    // Parser errors can contain source excerpts, including credentials.
    throw new Error("Invalid TOML configuration; no changes written.");
  }
}

function requireEntries(config) {
  const direct = config.mcp_servers?.[directId];
  const production = config.plugins?.[productionId];
  const development = config.plugins?.[developmentId];
  for (const [id, entry] of [
    [directId, direct],
    [productionId, production],
    [developmentId, development],
  ]) {
    if (!entry || typeof entry.enabled !== "boolean") {
      throw new Error(
        `Missing explicit enabled boolean for ${id}; see docs/guides/codex-development.md.`,
      );
    }
  }
  if (
    typeof direct.command !== "string" ||
    !Array.isArray(direct.args) ||
    direct.url !== undefined
  ) {
    throw new Error(
      `Expected an existing STDIO command/args entry for ${directId}.`,
    );
  }
  return { direct, production, development };
}

// Only a deliberately narrow source layout is editable. TOML parsing owns validity;
// a second complete parse proves that every semantic change matches the intent.
function replaceField(text, header, field, value) {
  const escapedHeader = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headers = [
    ...text.matchAll(
      new RegExp(`^\\[${escapedHeader}\\][ \\t]*(?:#[^\\r\\n]*)?\\r?$`, "gm"),
    ),
  ];
  if (headers.length !== 1)
    throw new Error(`Unsupported or ambiguous table layout: [${header}].`);
  const start = headers[0].index + headers[0][0].length;
  const tail = text.slice(start);
  const next = tail.search(/^\s*\[/m);
  const end = next === -1 ? text.length : start + next;
  const section = text.slice(start, end);
  const fields = [
    ...section.matchAll(
      new RegExp(
        `^([ \\t]*${field}[ \\t]*=[ \\t]*)([^\\r\\n]*?)([ \\t]*(?:#[^\\r\\n]*)?)\\r?$`,
        "gm",
      ),
    ),
  ];
  if (fields.length !== 1)
    throw new Error(`Expected one single-line ${field} in [${header}].`);
  const match = fields[0];
  const offset = start + match.index + match[1].length;
  return text.slice(0, offset) + value + text.slice(offset + match[2].length);
}

function plannedConfig(text, mode) {
  const config = readToml(text);
  const { direct, production, development } = requireEntries(config);
  direct.enabled = mode === "engine-only";
  production.enabled = mode === "prod";
  development.enabled = mode === "dev";
  const updates = [
    [`mcp_servers.${directId}`, "enabled", String(direct.enabled)],
    [`plugins."${productionId}"`, "enabled", String(production.enabled)],
    [`plugins."${developmentId}"`, "enabled", String(development.enabled)],
  ];
  if (mode === "engine-only") {
    direct.command = "node";
    direct.args = [join(repoRoot, "server/dist/index.js"), "--client=codex"];
    updates.push([
      `mcp_servers.${directId}`,
      "command",
      JSON.stringify(direct.command),
    ]);
    updates.push([
      `mcp_servers.${directId}`,
      "args",
      `[${direct.args.map((arg) => JSON.stringify(arg)).join(", ")}]`,
    ]);
  }
  let changed = updates.reduce(
    (current, [header, field, value]) =>
      replaceField(current, header, field, value),
    text,
  );
  if (mode === "dev") {
    config.features ??= {};
    config.features.hooks = true;
    changed = enableHooks(changed, readToml(text));
  }
  if (!isDeepStrictEqual(readToml(changed), config)) {
    throw new Error(
      "Unsupported TOML layout: proposed edit changed unexpected settings; no changes written.",
    );
  }
  return changed;
}

function enableHooks(text, config) {
  if (config.features?.hooks !== undefined)
    return replaceField(text, "features", "hooks", "true");
  if (config.features) {
    const header = /^\[features\][ \t]*(?:#[^\r\n]*)?\r?$/m;
    if (!header.test(text))
      throw new Error("Unsupported features table layout.");
    return text.replace(header, "$&\nhooks = true");
  }
  return text + "\n[features]\nhooks = true\n";
}

async function optionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Cannot read JSON metadata at ${path}.`, { cause: error });
  }
}

async function cachedPlugins(configPath, marketplace) {
  const base = join(
    dirname(configPath),
    "plugins/cache",
    marketplace,
    "codex-prompts",
  );
  let children;
  try {
    children = await readdir(base, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error(`Cannot inspect plugin cache at ${base}.`, {
      cause: error,
    });
  }
  const entries = [];
  for (const child of children
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(base, child.name);
    const manifest = await optionalJson(
      join(path, ".codex-plugin/plugin.json"),
    );
    const engine = await optionalJson(
      join(path, "node_modules/claude-prompts/package.json"),
    );
    if (manifest?.name === "codex-prompts")
      entries.push({
        path,
        plugin: manifest.version ?? "unknown",
        engine: engine?.version ?? "unknown",
      });
  }
  return entries;
}

async function status(configPath, wrapperRoot) {
  const config = readToml(await readFile(configPath, "utf8"));
  const { direct, production, development } = requireEntries(config);
  const metadata = await optionalJson(join(repoRoot, "server/package.json"));
  console.log(`Configuration: ${configPath}`);
  console.log(
    `Direct checkout entry: ${direct.enabled ? "enabled" : "disabled"}`,
  );
  // Never print arbitrary command arguments or environment values.
  console.log(
    `Configured entry point: ${JSON.stringify(direct.args.find((arg) => typeof arg === "string" && arg.endsWith("/dist/index.js")) ?? "unrecognized")}`,
  );
  console.log(
    `This checkout: ${repoRoot}; source package version: ${metadata?.version ?? "unknown"} (not loaded-build evidence)`,
  );
  for (const [id, entry, marketplace] of [
    [productionId, production, "minipuft"],
    [developmentId, development, "codex-prompts-dev"],
  ]) {
    console.log(`${id}: ${entry.enabled ? "enabled" : "disabled"}`);
    const cached = await cachedPlugins(configPath, marketplace);
    for (const item of cached)
      console.log(
        `  Cached artifact: ${item.path}; plugin ${item.plugin}; engine package ${item.engine}`,
      );
    if (cached.length === 0)
      console.log("  No cached artifact found beside this config.");
  }
  const { readDevPluginStatus } = await import("./codex-dev-plugin.mjs");
  const installed = await cachedPlugins(configPath, "codex-prompts-dev");
  const evidence = await readDevPluginStatus({
    upstreamRoot: repoRoot,
    wrapperRoot,
    destination: devDestination(configPath),
    installedRoot: installed.length === 1 ? installed[0].path : undefined,
  });
  for (const label of ["source", "staged", "installed"]) {
    const item = evidence[label];
    const summary =
      item &&
      Object.fromEntries(
        [
          "engineVersion",
          "pluginVersion",
          "bundleHash",
          "sharedHooksHash",
          "adaptersHash",
          "resourcesHash",
          "artifactHash",
          "stagedAt",
        ].map((key) => [key, item[key]]),
      );
    console.log(
      `${label} provenance: ${summary ? JSON.stringify(summary) : "unavailable"}`,
    );
  }
  for (const label of [
    "sourceDrift",
    "stagedDrift",
    "installedDrift",
    "errors",
  ])
    console.log(`${label}: ${JSON.stringify(evidence[label])}`);
  console.log(
    `Hook feature: ${config.features?.hooks === true ? "enabled" : "not explicitly enabled"}; hook trust is reviewed by Codex, not granted here.`,
  );
  console.log(
    "Running session/build: unknown. Configuration and cached package versions do not prove what Codex has loaded.",
  );
}

function verifyDevelopmentBuild() {
  for (const script of ["build", "verify:mcp"]) {
    const result = spawnSync("npm", ["run", script], {
      cwd: join(repoRoot, "server"),
      stdio: "inherit",
    });
    if (result.error || result.status !== 0)
      throw new Error(`npm run ${script} failed; configuration unchanged.`);
  }
}

async function backupConfig(configPath, original) {
  await assertConfigState(configPath, original);
  const backup = `${configPath}.bak.codex-server.${Date.now()}.${randomUUID()}`;
  const file = await open(backup, "wx", 0o600);
  try {
    await file.writeFile(original);
  } finally {
    await file.close();
  }
  console.log(`Backup (private): ${backup}`);
}

function adoptMarketplaceConfig(original, registered, root) {
  const addition = `[marketplaces.codex-prompts-dev]\nsource_type = "local"\nsource = ${JSON.stringify(root)}\n`;
  if (
    registered !== original + "\n" + addition &&
    registered !== original + "\n\n" + addition
  )
    throw new Error(
      "Configuration changed unexpectedly during marketplace registration; concurrent edits preserved.",
    );
  const expected = readToml(original);
  expected.marketplaces ??= {};
  if (expected.marketplaces["codex-prompts-dev"] !== undefined)
    throw new Error(
      "Managed marketplace configuration already exists with unexpected registration state.",
    );
  expected.marketplaces["codex-prompts-dev"] = {
    source_type: "local",
    source: root,
  };
  if (!isDeepStrictEqual(readToml(registered), expected))
    throw new Error("Unexpected managed marketplace configuration fields.");
  return registered;
}

async function writeConfig(
  configPath,
  original,
  changed,
  mode,
  backupNeeded = true,
) {
  const temporary = `${configPath}.tmp.${randomUUID()}`;
  if ((await readFile(configPath, "utf8")) !== original)
    throw new Error(
      "Configuration changed during validation; retry after the other writer finishes.",
    );
  if (backupNeeded) await backupConfig(configPath, original);
  const temporaryFile = await open(temporary, "wx", 0o600);
  try {
    await temporaryFile.writeFile(changed);
    await temporaryFile.sync();
    await temporaryFile.close();
    await chmod(temporary, mode);
    if ((await readFile(configPath, "utf8")) !== original)
      throw new Error(
        "Configuration changed before replacement; no changes written.",
      );
    await rename(temporary, configPath);
  } finally {
    await temporaryFile.close();
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

function devDestination(configPath) {
  return join(dirname(configPath), "dev-marketplace/plugins/codex-prompts");
}

function nativeCodex(configPath, args) {
  const result = spawnSync("codex", ["plugin", ...args, "--json"], {
    env: { ...process.env, CODEX_HOME: dirname(configPath) },
    encoding: "utf8",
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `Codex plugin ${args[0]} failed; native output withheld to protect configuration values.`,
    );
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("Codex plugin command returned invalid JSON.");
  }
}

async function ensureMarketplace(configPath, original) {
  const root = join(dirname(configPath), "dev-marketplace");
  const path = join(root, ".claude-plugin/marketplace.json");
  let manifest = await optionalJson(path);
  if (!manifest) {
    await mkdir(dirname(path), { recursive: true });
    manifest = {
      name: "codex-prompts-dev",
      owner: { name: "local-development" },
      plugins: [{ name: "codex-prompts", source: "./plugins/codex-prompts" }],
    };
    const file = await open(path, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(manifest, null, 2) + "\n");
    } finally {
      await file.close();
    }
  }
  const plugin = manifest.plugins?.find(
    (item) => item.name === "codex-prompts",
  );
  if (
    manifest.name !== "codex-prompts-dev" ||
    plugin?.source !== "./plugins/codex-prompts"
  )
    throw new Error(
      "Dev marketplace name/source conflicts with the managed local plugin.",
    );
  const listed = nativeCodex(configPath, ["marketplace", "list"]).marketplaces;
  if (!Array.isArray(listed))
    throw new Error("Unrecognized Codex marketplace list response.");
  const existing = listed.find((item) => item.name === "codex-prompts-dev");
  if (
    existing &&
    (resolve(existing.root) !== root ||
      existing.marketplaceSource?.sourceType !== "local")
  )
    throw new Error(
      "Registered dev marketplace has a different source; refusing to replace it.",
    );
  if (existing) {
    await assertConfigState(configPath, original);
    return { original, backupCreated: false };
  }
  await backupConfig(configPath, original);
  nativeCodex(configPath, ["marketplace", "add", root]);
  const registered = adoptMarketplaceConfig(
    original,
    await readFile(configPath, "utf8"),
    root,
  );
  return { original: registered, backupCreated: true };
}

async function installedDevelopment(configPath) {
  const listed = nativeCodex(configPath, ["list"]);
  const installed = listed.installed?.filter(
    (item) => item.pluginId === developmentId,
  );
  if (!Array.isArray(installed) || installed.length > 1)
    throw new Error("Unrecognized or ambiguous installed dev plugin state.");
  if (!installed.length) return null;
  const version = installed[0].version;
  if (typeof version !== "string" || basename(version) !== version)
    throw new Error("Invalid installed dev plugin version.");
  return join(
    dirname(configPath),
    "plugins/cache/codex-prompts-dev/codex-prompts",
    version,
  );
}

async function assertConfigState(configPath, expected) {
  if ((await readFile(configPath, "utf8")) !== expected)
    throw new Error(
      "Configuration changed during validation; refusing to overwrite another writer.",
    );
}

async function captureInstalled(configPath, previous) {
  if (!previous) return null;
  const directory = await mkdtemp(
    join(dirname(configPath), ".codex-dev-installed-backup-"),
  );
  await chmod(directory, 0o700);
  const snapshot = join(directory, "plugin");
  await cp(previous, snapshot, { recursive: true, dereference: true });
  return snapshot;
}

async function replayInstalled(configPath, stage, snapshot) {
  if (!snapshot) {
    if (await installedDevelopment(configPath)) {
      nativeCodex(configPath, ["remove", developmentId]);
      return true;
    }
    return false;
  }
  const parked = `${stage.destination}.replay-${randomUUID()}`;
  await rename(stage.destination, parked);
  try {
    await cp(snapshot, stage.destination, { recursive: true });
    nativeCodex(configPath, ["add", developmentId]);
  } finally {
    await rm(stage.destination, { recursive: true, force: true });
    await rename(parked, stage.destination);
  }
}

async function restoreInstalledSettings(context, observed) {
  const { configPath, stage, snapshot, helper } = context;
  await assertConfigState(configPath, observed);
  const marker = await optionalJson(
    join(stage.destination, ".codex-dev-plugin.json"),
  );
  const state = await helper.readDevPluginStatus({
    upstreamRoot: repoRoot,
    wrapperRoot: stage.provenance.wrapperRoot,
    destination: stage.destination,
  });
  if (
    marker?.artifactHash !== stage.provenance.artifactHash ||
    state.stagedDrift !== false
  )
    throw new Error(
      "managed plugin changed before installed-artifact rollback",
    );
  const removed = await replayInstalled(configPath, stage, snapshot);
  const after = await readFile(configPath, "utf8");
  const intended = readToml(observed);
  if (removed) delete intended.plugins[developmentId];
  else if (snapshot) intended.plugins[developmentId].enabled = true;
  if (!isDeepStrictEqual(readToml(after), intended))
    throw new Error("configuration changed during installed-artifact rollback");
  return after;
}

async function rollbackDevelopment(context) {
  const {
    configPath,
    stage,
    installAttempted,
    original,
    expected,
    fileMode,
    helper,
  } = context;
  const failures = [];
  let observed = await readFile(configPath, "utf8");
  const safe = observed === expected;
  if (!safe)
    failures.push(
      "configuration changed concurrently; original settings were not restored",
    );
  if (installAttempted && safe) {
    try {
      observed = await restoreInstalledSettings(context, observed);
    } catch (error) {
      failures.push(`installed rollback: ${error.message}`);
    }
  }
  if (safe && !failures.length && observed !== original) {
    try {
      await writeConfig(configPath, observed, original, fileMode, false);
    } catch (error) {
      failures.push(`settings rollback: ${error.message}`);
    }
  }
  try {
    await helper.restoreDevPlugin({
      destination: stage.destination,
      backupPath: stage.backupPath,
      expectedArtifactHash: stage.provenance.artifactHash,
    });
  } catch (error) {
    failures.push(`stage rollback: ${error.message}`);
  }
  if (failures.length)
    throw new Error(
      `Rollback incomplete: ${failures.join("; ")}. Valid managed marketplace registration is retained for retry.`,
    );
}

async function installDevelopment(
  configPath,
  wrapperRoot,
  original,
  changed,
  fileMode,
) {
  if (basename(configPath) !== "config.toml")
    throw new Error(
      "Native dev installation requires --config named config.toml (CODEX_HOME selects its directory).",
    );
  const helper = await import("./codex-dev-plugin.mjs");
  await assertConfigState(configPath, original);
  const stage = await helper.stageDevPlugin({
    upstreamRoot: repoRoot,
    wrapperRoot,
    destination: devDestination(configPath),
  });
  const context = {
    configPath,
    stage,
    original,
    expected: original,
    fileMode,
    helper,
    snapshot: null,
    installAttempted: false,
  };
  try {
    await assertConfigState(configPath, original);
    const marketplace = await ensureMarketplace(configPath, original);
    original = marketplace.original;
    context.original = original;
    context.expected = original;
    changed = plannedConfig(original, "dev");
    context.snapshot = await captureInstalled(
      configPath,
      await installedDevelopment(configPath),
    );
    if (changed !== original)
      await writeConfig(
        configPath,
        original,
        changed,
        fileMode,
        !marketplace.backupCreated,
      );
    context.expected = changed;
    await assertConfigState(configPath, changed);
    context.installAttempted = true;
    const installed = nativeCodex(configPath, ["add", developmentId]);
    const installedRoot = join(
      dirname(configPath),
      "plugins/cache/codex-prompts-dev/codex-prompts",
      stage.provenance.pluginVersion,
    );
    if (
      installed.pluginId !== developmentId ||
      resolve(installed.installedPath ?? "") !== installedRoot
    )
      throw new Error(
        "Installer returned an unexpected dev plugin destination.",
      );
    const current = await readFile(configPath, "utf8");
    if (current !== changed)
      throw new Error(
        "Configuration changed during native installation; refusing to erase concurrent edits.",
      );
    const evidence = await helper.readDevPluginStatus({
      upstreamRoot: repoRoot,
      wrapperRoot,
      destination: stage.destination,
      installedRoot,
    });
    if (
      evidence.sourceDrift !== false ||
      evidence.stagedDrift !== false ||
      evidence.installedDrift !== false ||
      evidence.errors.length ||
      evidence.installed?.artifactHash !== stage.provenance.artifactHash
    )
      throw new Error(
        "Installed dev plugin does not match the verified current source artifact.",
      );

    if (context.snapshot)
      await rm(dirname(context.snapshot), { recursive: true });
    console.log(
      `Installed engine ${stage.provenance.engineVersion}; hooks/adapters verified; artifact ${stage.provenance.artifactHash}.`,
    );
    console.log(
      "Hook trust remains subject to Codex review; this switch does not approve hook hashes.",
    );
  } catch (error) {
    try {
      await rollbackDevelopment(context);
    } catch (rollback) {
      throw new Error(`${error.message} ${rollback.message}`, {
        cause: rollback,
      });
    }
    throw new Error(
      `${error.message} Previous managed plugin and settings restored. Valid managed marketplace registration is retained for retry.`,
      { cause: error },
    );
  }
}

async function switchMode(configPath, mode, wrapperRoot) {
  const lockPath = `${configPath}.codex-server.lock`;
  const lock = await open(lockPath, "wx", 0o600);
  try {
    const info = await lstat(configPath);
    if (!info.isFile() || info.nlink !== 1)
      throw new Error(
        "Configuration must be a regular, unlinked file (no symlinks or hard links).",
      );
    const original = await readFile(configPath, "utf8");
    const changed = plannedConfig(original, mode);
    if (
      mode === "prod" &&
      (await cachedPlugins(configPath, "minipuft")).length === 0
    ) {
      throw new Error(
        "Published codex-prompts@minipuft plugin is not cached beside this config; install it explicitly before switching.",
      );
    }
    if (mode === "dev" || mode === "engine-only") verifyDevelopmentBuild();
    if (mode === "dev") {
      await installDevelopment(
        configPath,
        wrapperRoot,
        original,
        changed,
        info.mode & 0o777,
      );
      console.log(
        "Configured dev with verified local plugin and hooks enabled.",
      );
      console.log(reconnect);
      return;
    }
    if (changed === original)
      console.log(
        `Already configured for ${mode}; no configuration write or backup needed.`,
      );
    else {
      await writeConfig(configPath, original, changed, info.mode & 0o777);
      console.log(`Configured ${mode}.`);
    }
    console.log(reconnect);
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      config: { type: "string" },
      wrapper: { type: "string" },
      help: { type: "boolean" },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(
      "Usage: ./scripts/codex-server dev|engine-only|prod|status [--config /path/to/config.toml] [--wrapper /path/to/codex-prompts]",
    );
    return;
  }
  if (
    positionals.length !== 1 ||
    !["dev", "engine-only", "prod", "status"].includes(positionals[0])
  )
    throw new Error(
      "Usage: ./scripts/codex-server dev|engine-only|prod|status [--config PATH] [--wrapper PATH]",
    );
  const configPath = resolve(
    values.config ??
      join(process.env.CODEX_HOME || join(homedir(), ".codex"), "config.toml"),
  );
  const wrapperRoot = resolve(
    values.wrapper ?? join(repoRoot, "../codex-prompts"),
  );
  if (positionals[0] === "status") await status(configPath, wrapperRoot);
  else await switchMode(configPath, positionals[0], wrapperRoot);
}

main().catch((error) => {
  console.error(
    `codex-server: ${error.code === "EEXIST" ? "Switch lock already exists; another switch may be running. Inspect the .codex-server.lock file before removing it." : error.message}`,
  );
  process.exitCode = 1;
});

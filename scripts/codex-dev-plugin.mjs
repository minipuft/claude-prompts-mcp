/** Materialize the current engine and shared hooks behind unchanged Codex adapters. */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";

const MANAGER = "claude-prompts-codex-dev";
const MARKER = ".codex-dev-plugin.json";
const OMIT = new Set([
  ".git",
  "node_modules",
  "runtime-state",
  "logs",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".cache",
  "cache",
  "caches",
  "tests",
]);
const PACKAGE_PREFIX = "node_modules/claude-prompts/";

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function hashEntries(entries) {
  return hash(
    JSON.stringify(
      Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}

async function optionalStat(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function optionalManifest(root) {
  const path = join(root, MARKER);
  if (!(await optionalStat(path))) return null;
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`Invalid ownership manifest: ${path}`);
  const manifest = JSON.parse(await readFile(path, "utf8"));
  if (
    manifest.manager !== MANAGER ||
    manifest.schemaVersion !== 1 ||
    !manifest.files
  ) {
    throw new Error(`Unrecognized managed artifact: ${root}`);
  }
  return manifest;
}

function isExcluded(name) {
  return OMIT.has(name) || name.endsWith(".pyc") || name.endsWith(".pyo");
}

async function collectTree(root, prefix, entries) {
  const children = await readdir(root, { withFileTypes: true });
  for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
    if (isExcluded(child.name)) continue;
    const path = join(root, child.name);
    const target = `${prefix}${child.name}`;
    if (child.isSymbolicLink())
      throw new Error(`Runtime input must be a real file/directory: ${path}`);
    if (child.isDirectory()) await collectTree(path, `${target}/`, entries);
    else if (child.isFile()) entries.set(target, path);
    else throw new Error(`Unsupported runtime input: ${path}`);
  }
}

async function requireFile(path) {
  const info = await optionalStat(path);
  if (!info?.isFile() || info.isSymbolicLink())
    throw new Error(`Missing regular runtime file: ${path}`);
  return path;
}

function wrapperRuntimePath(path) {
  return (
    path === ".mcp.json" ||
    path === "package.json" ||
    path === "downstream-contract.json" ||
    path.startsWith(".codex-plugin/") ||
    path.startsWith("bin/") ||
    (path.startsWith("hooks/") &&
      path !== "hooks/lib" &&
      !path.startsWith("hooks/lib/"))
  );
}

async function wrapperEntries(root) {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0)
    throw new Error(`Cannot enumerate tracked wrapper runtime: ${root}`);
  const entries = new Map();
  for (const path of result.stdout.split("\0").filter(wrapperRuntimePath)) {
    if (path.split("/").some(isExcluded)) continue;
    entries.set(path, await requireFile(join(root, path)));
  }
  for (const path of [
    ".mcp.json",
    ".codex-plugin/plugin.json",
    "package.json",
    "bin/start-mcp.mjs",
    "bin/resource-config.mjs",
    "hooks/hooks.json",
    "hooks/_codex_bootstrap.py",
  ]) {
    if (!entries.has(path))
      throw new Error(`Wrapper runtime is not tracked: ${path}`);
  }
  return entries;
}

async function engineEntries(upstreamRoot) {
  const server = join(upstreamRoot, "server");
  const entries = new Map();
  for (const path of [
    "dist/index.js",
    "dist/index.js.map",
    "config.json",
    "config.schema.json",
    "package.json",
  ]) {
    entries.set(
      `${PACKAGE_PREFIX}${path}`,
      await requireFile(join(server, path)),
    );
  }
  const metadata = JSON.parse(
    await readFile(join(server, "package.json"), "utf8"),
  );
  // Package identity declares the CLI too; ship declared executable entries, not its dependencies.
  for (const path of Object.values(metadata.bin ?? {})) {
    const normalized = path.replace(/^\.\//, "");
    if (!normalized.startsWith("dist/") || normalized.includes(".."))
      throw new Error(`Unsupported package bin: ${path}`);
    entries.set(
      `${PACKAGE_PREFIX}${normalized}`,
      await requireFile(join(server, normalized)),
    );
    const map = join(server, `${normalized}.map`);
    if (await optionalStat(map))
      entries.set(`${PACKAGE_PREFIX}${normalized}.map`, await requireFile(map));
  }
  for (const path of ["README.md", "LICENSE"]) {
    const candidate = (await optionalStat(join(server, path)))
      ? join(server, path)
      : join(upstreamRoot, path);
    if (await optionalStat(candidate))
      entries.set(`${PACKAGE_PREFIX}${path}`, await requireFile(candidate));
  }
  await collectTree(
    join(server, "resources"),
    `${PACKAGE_PREFIX}resources/`,
    entries,
  );
  await collectTree(
    join(upstreamRoot, "hooks"),
    `${PACKAGE_PREFIX}hooks/`,
    entries,
  );
  return entries;
}

function groupFiles(files, predicate) {
  return Object.fromEntries(
    Object.entries(files).filter(([path]) => predicate(path)),
  );
}

function provenanceFor(files, metadata) {
  const sharedHooksHash = hashEntries(
    groupFiles(files, (path) => path.startsWith(`${PACKAGE_PREFIX}hooks/`)),
  );
  const adaptersHash = hashEntries(
    groupFiles(files, (path) => !path.startsWith(PACKAGE_PREFIX)),
  );
  const resourcesHash = hashEntries(
    groupFiles(files, (path) => path.startsWith(`${PACKAGE_PREFIX}resources/`)),
  );
  const artifactHash = hashEntries(files);
  return {
    schemaVersion: 1,
    manager: MANAGER,
    ...metadata,
    bundleHash: files[`${PACKAGE_PREFIX}dist/index.js`],
    sharedHooksHash,
    adaptersHash,
    resourcesHash,
    sourceHash: artifactHash,
    artifactHash,
    files,
  };
}

async function inventory({ upstreamRoot, wrapperRoot }) {
  const [wrapper, engine] = await Promise.all([
    wrapperEntries(wrapperRoot),
    engineEntries(upstreamRoot),
  ]);
  const entries = new Map([...wrapper, ...engine]);
  const files = {};
  for (const [path, input] of entries)
    files[path] = hash(await readFile(input));
  const enginePackage = JSON.parse(
    await readFile(join(upstreamRoot, "server/package.json"), "utf8"),
  );
  const pluginPackage = JSON.parse(
    await readFile(join(wrapperRoot, ".codex-plugin/plugin.json"), "utf8"),
  );
  if (
    enginePackage.name !== "claude-prompts" ||
    pluginPackage.name !== "codex-prompts" ||
    typeof enginePackage.version !== "string" ||
    typeof pluginPackage.version !== "string"
  ) {
    throw new Error(
      "Runtime package identities do not match Claude Prompts and Codex Prompts.",
    );
  }
  return {
    entries,
    provenance: provenanceFor(files, {
      upstreamRoot: resolve(upstreamRoot),
      wrapperRoot: resolve(wrapperRoot),
      engineVersion: enginePackage.version,
      pluginVersion: pluginPackage.version,
    }),
  };
}

function assertRelativeArtifactPath(path) {
  if (
    isAbsolute(path) ||
    path.split(/[\\/]/).some((part) => part === ".." || part === "")
  ) {
    throw new Error(`Unsafe artifact manifest path: ${path}`);
  }
}

async function compareArtifact(root, expected) {
  const missing = [];
  const changed = [];
  for (const [path, digest] of Object.entries(expected.files)) {
    assertRelativeArtifactPath(path);
    const candidate = join(root, path);
    const info = await optionalStat(candidate);
    if (!info?.isFile() || info.isSymbolicLink()) missing.push(path);
    else if (hash(await readFile(candidate)) !== digest) changed.push(path);
  }
  // Root hooks/lib changes upstream-hook resolution into adapter recursion.
  if (await optionalStat(join(root, "hooks/lib")))
    changed.push("hooks/lib (must be absent)");
  return {
    matches: missing.length === 0 && changed.length === 0,
    missing,
    changed,
  };
}

async function assertDestinationOwnership(destination, wrapperRoot) {
  const info = await optionalStat(destination);
  if (!info) return false;
  if (info.isSymbolicLink()) {
    const target = resolve(dirname(destination), await readlink(destination));
    if ((await realpath(target)) === (await realpath(wrapperRoot))) return true;
    throw new Error(`Refusing unknown plugin source symlink: ${destination}`);
  }
  if (!info.isDirectory() || !(await optionalManifest(destination))) {
    throw new Error(`Refusing unmanaged plugin source: ${destination}`);
  }
  return true;
}

async function materialize(stage, snapshot) {
  for (const [path, source] of snapshot.entries) {
    const output = join(stage, path);
    await mkdir(dirname(output), { recursive: true });
    await copyFile(source, output);
    if (hash(await readFile(output)) !== snapshot.provenance.files[path]) {
      throw new Error(`Runtime input changed during staging: ${source}`);
    }
  }
  const provenance = {
    ...snapshot.provenance,
    stagedAt: new Date().toISOString(),
  };
  await writeFile(
    join(stage, MARKER),
    `${JSON.stringify(provenance, null, 2)}\n`,
    { mode: 0o600 },
  );
  return provenance;
}

function cleanProbeEnvironment(workspace, pluginRoot) {
  const env = { ...process.env };
  for (const key of [
    "MCP_CONFIG_PATH",
    "CODEX_PROMPTS_CONFIG_PATH",
    "CLAUDE_PLUGIN_DATA",
    "PYTHONPATH",
  ])
    delete env[key];
  return {
    ...env,
    MCP_WORKSPACE: workspace,
    MCP_RUNTIME_ROOT: workspace,
    MCP_RESOURCES_PATH: join(pluginRoot, PACKAGE_PREFIX, "resources"),
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    PLUGIN_ROOT: pluginRoot,
    PYTHONDONTWRITEBYTECODE: "1",
  };
}

function verifyInitialize(pluginRoot, env, inspectRouting) {
  return new Promise((fulfill, reject) => {
    const child = spawn(
      process.execPath,
      ["bin/start-mcp.mjs", "--transport=stdio", "--client=codex"],
      {
        cwd: pluginRoot,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const lines = createInterface({ input: child.stdout });
    let stderr = "";
    let initialized;
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.destroy();
      const forceStop = setTimeout(() => child.kill("SIGKILL"), 2000);
      child.once("close", () => {
        clearTimeout(forceStop);
        if (error) reject(error);
        else fulfill(value);
      });
      child.kill("SIGTERM");
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error(`Staged MCP handshake timed out: ${stderr.slice(-1200)}`),
        ),
      30000,
    );
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on("error", (error) => finish(error));
    child.stdin.on("error", (error) => finish(error));
    child.on("exit", (code) =>
      finish(
        new Error(
          `Staged MCP exited (${code}) before verification: ${stderr.slice(-1200)}`,
        ),
      ),
    );
    lines.on("line", (line) => {
      let response;
      try {
        response = JSON.parse(line);
      } catch {
        return;
      }
      if (response.error)
        return finish(
          new Error(
            `Staged MCP request failed: ${JSON.stringify(response.error)}`,
          ),
        );
      if (response.id === 1) {
        initialized = response.result;
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
        );
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`,
        );
      }
      if (response.id === 2) {
        try {
          inspectRouting();
          finish(null, { initialized, tools: response.result?.tools });
        } catch (error) {
          finish(error);
        }
      }
    });
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "codex-dev-stage", version: "1" },
        },
      })}\n`,
    );
  });
}

function runPython(pluginRoot, env, args, input = "") {
  const result = spawnSync("python3", args, {
    cwd: pluginRoot,
    env,
    input,
    encoding: "utf8",
    timeout: 30000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Staged Python verification failed: ${result.error?.message ?? result.stderr.slice(-1200)}`,
    );
  }
  return result.stdout;
}

/** Runtime checks create writable state only in a private temporary workspace. */
export async function verifyDevPlugin({ pluginRoot }) {
  if (await optionalStat(join(pluginRoot, "hooks/lib")))
    throw new Error(
      "Root hooks/lib must be absent; use packaged upstream hooks.",
    );
  const workspace = await mkdtemp(join(tmpdir(), "codex-dev-probe-"));
  try {
    const env = cleanProbeEnvironment(workspace, pluginRoot);
    const resolved = runPython(pluginRoot, env, [
      "-c",
      'import sys,json; sys.path.insert(0,"hooks"); import _codex_bootstrap as b; print(json.dumps([str(b.LIB_DIR),str(b.UPSTREAM_HOOKS_DIR)]))',
    ]);
    const [lib, hooks] = JSON.parse(resolved);
    const packagedHooks = join(pluginRoot, PACKAGE_PREFIX, "hooks");
    if (lib !== join(packagedHooks, "lib") || hooks !== packagedHooks)
      throw new Error("Codex bootstrap resolved the wrong upstream hook tree.");
    const mcp = await verifyInitialize(pluginRoot, env, () => {
      const output = runPython(
        pluginRoot,
        env,
        ["hooks/prompt-suggest.py"],
        JSON.stringify({
          session_id: "codex-dev-stage",
          cwd: workspace,
          hook_event_name: "UserPromptSubmit",
          prompt: ">>strategic_implement",
        }),
      );
      const routed = output.trim() ? JSON.parse(output) : null;
      if (
        !routed?.hookSpecificOutput?.additionalContext?.includes(
          "prompt_engine",
        )
      ) {
        throw new Error(
          "Symbolic prompt routing did not produce a prompt_engine directive.",
        );
      }
    });
    const tools = mcp.tools?.map((tool) => tool.name).sort();
    if (
      !mcp.initialized?.protocolVersion ||
      !["prompt_engine", "resource_manager", "system_control"].every((name) =>
        tools?.includes(name),
      )
    ) {
      throw new Error(
        "Staged MCP did not advertise the complete tool surface.",
      );
    }
    return {
      protocolVersion: mcp.initialized.protocolVersion,
      tools,
      routing: true,
      upstreamHooks: hooks,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function privateBackupDirectory(destination) {
  const parent = join(
    dirname(destination),
    `.${destination.split(sep).at(-1)}-backups`,
  );
  const info = await optionalStat(parent);
  if (info && (!info.isDirectory() || info.isSymbolicLink()))
    throw new Error(`Invalid private backup directory: ${parent}`);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700);
  const directory = join(parent, randomUUID());
  await mkdir(directory, { mode: 0o700 });
  return directory;
}

/** Build is owned by the caller. A failed stage never replaces the previous source. */
export async function stageDevPlugin({
  upstreamRoot,
  wrapperRoot,
  destination,
}) {
  destination = resolve(destination);
  await mkdir(dirname(destination), { recursive: true });
  const lockPath = `${destination}.stage.lock`;
  const lock = await open(lockPath, "wx", 0o600);
  let stage;
  let backupPath = null;
  try {
    const exists = await assertDestinationOwnership(destination, wrapperRoot);
    const before = exists ? await lstat(destination) : null;
    const snapshot = await inventory({ upstreamRoot, wrapperRoot });
    stage = await mkdtemp(join(dirname(destination), ".codex-dev-stage-"));
    const provenance = await materialize(stage, snapshot);
    const verification = await verifyDevPlugin({ pluginRoot: stage });
    if (
      (await inventory({ upstreamRoot, wrapperRoot })).provenance.sourceHash !==
      provenance.sourceHash
    ) {
      throw new Error("Source changed during verification; retry staging.");
    }
    const after = await optionalStat(destination);
    if (before?.ino !== after?.ino || before?.dev !== after?.dev)
      throw new Error("Plugin destination changed during staging.");
    if (exists) {
      backupPath = join(await privateBackupDirectory(destination), "source");
      await rename(destination, backupPath);
    }
    try {
      await rename(stage, destination);
    } catch (error) {
      if (backupPath) await rename(backupPath, destination);
      throw error;
    }
    stage = null;
    return { destination, backupPath, provenance, verification };
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    await lock.close();
    await unlink(lockPath);
  }
}

/** Preserve the rejected staged source privately, then restore the previous source. */
export async function restoreDevPlugin({
  destination,
  backupPath,
  expectedArtifactHash,
}) {
  const current = await optionalManifest(destination);
  if (
    current?.artifactHash !== expectedArtifactHash ||
    !(await compareArtifact(destination, current)).matches
  ) {
    throw new Error(
      "Managed plugin changed before rollback; refusing to replace it.",
    );
  }
  const rejected = join(await privateBackupDirectory(destination), "rejected");
  await rename(destination, rejected);
  if (backupPath) {
    try {
      await rename(backupPath, destination);
    } catch (error) {
      await rename(rejected, destination);
      throw error;
    }
  }
  return {
    rejected,
    restored: backupPath !== null && backupPath !== undefined,
  };
}

/** Read-only comparison; cache metadata does not prove what a running session loaded. */
export async function readDevPluginStatus({
  upstreamRoot,
  wrapperRoot,
  destination,
  installedRoot,
}) {
  const status = {
    source: null,
    staged: null,
    installed: null,
    sourceDrift: null,
    stagedDrift: null,
    installedDrift: null,
    errors: [],
  };
  try {
    status.source = (await inventory({ upstreamRoot, wrapperRoot })).provenance;
  } catch (error) {
    status.errors.push(`Source: ${error.message}`);
  }
  try {
    status.staged = await optionalManifest(destination);
    if (status.staged) {
      status.sourceDrift = status.source
        ? status.source.sourceHash !== status.staged.sourceHash
        : null;
      status.stagedDrift = !(await compareArtifact(destination, status.staged))
        .matches;
    }
  } catch (error) {
    status.errors.push(`Staged: ${error.message}`);
  }
  if (installedRoot) {
    try {
      status.installed = await optionalManifest(installedRoot);
      const expected = status.staged ?? status.source;
      if (expected)
        status.installedDrift = !(
          await compareArtifact(installedRoot, expected)
        ).matches;
    } catch (error) {
      status.errors.push(`Installed: ${error.message}`);
    }
  }
  return status;
}

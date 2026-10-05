import assert from "node:assert/strict";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  readDevPluginStatus,
  restoreDevPlugin,
  stageDevPlugin,
  verifyDevPlugin,
} from "./codex-dev-plugin.mjs";

const upstreamRoot = resolve(import.meta.dirname, "../../claude-prompts-mcp");
const wrapperRoot = resolve(import.meta.dirname, "../../codex-prompts");
const enginePrefix = "node_modules/claude-prompts";
const excluded = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  "runtime-state",
  "logs",
  "tests",
  ".pytest_cache",
  ".ruff_cache",
]);

async function fixture(t, { copyUpstream = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "codex-dev-plugin-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let source = upstreamRoot;
  if (copyUpstream) {
    source = join(root, "upstream");
    await mkdir(join(source, "server"), { recursive: true });
    for (const path of [
      "dist",
      "resources",
      "config.json",
      "config.schema.json",
      "package.json",
    ]) {
      await cp(
        join(upstreamRoot, "server", path),
        join(source, "server", path),
        {
          recursive: true,
          filter: (path) => !excluded.has(path.split("/").at(-1)),
        },
      );
    }
    await cp(join(upstreamRoot, "hooks"), join(source, "hooks"), {
      recursive: true,
      filter: (path) => !excluded.has(path.split("/").at(-1)),
    });
  }
  const options = {
    upstreamRoot: source,
    wrapperRoot,
    destination: join(root, "plugin"),
  };
  return {
    root,
    options,
    stage: () => stageDevPlugin(options),
    status: (installedRoot) =>
      readDevPluginStatus({ ...options, installedRoot }),
  };
}

test("current real adapters plus current bundled engine/hooks initialize and route symbolic prompts without changing inputs", async (t) => {
  const f = await fixture(t);
  const before = (await f.status()).source;
  const result = await f.stage();
  assert.equal(result.backupPath, null);
  assert.equal(result.verification.routing, true);
  assert.deepEqual(result.verification.tools, [
    "prompt_engine",
    "resource_manager",
    "system_control",
  ]);
  assert.equal(
    result.provenance.engineVersion,
    JSON.parse(
      await readFile(join(upstreamRoot, "server/package.json"), "utf8"),
    ).version,
  );
  assert.equal(result.provenance.upstreamRoot, upstreamRoot);
  assert.equal(result.provenance.sourceHash, before.sourceHash);
  const status = await f.status();
  assert.equal(
    status.source.sourceHash,
    before.sourceHash,
    "source content remains unchanged",
  );
  assert.equal(status.sourceDrift, false);
  assert.equal(status.stagedDrift, false);
  assert.deepEqual(status.errors, []);
  const lib = join(f.options.destination, enginePrefix, "hooks/lib");
  assert.equal((await lstat(lib)).isSymbolicLink(), false);
  await assert.rejects(lstat(join(f.options.destination, "hooks/lib")), {
    code: "ENOENT",
  });
  for (const path of [
    "dist/index.js.map",
    "dist/cpm.js",
    "config.json",
    "config.schema.json",
    "package.json",
  ]) {
    assert.equal(
      (await stat(join(f.options.destination, enginePrefix, path))).isFile(),
      true,
      path,
    );
  }
  assert.deepEqual(
    JSON.parse(
      await readFile(join(f.options.destination, "package.json"), "utf8"),
    ),
    JSON.parse(await readFile(join(wrapperRoot, "package.json"), "utf8")),
    "wrapper identity/dependency range unchanged",
  );
  assert.equal(
    await readFile(
      join(f.options.destination, "bin/resource-config.mjs"),
      "utf8",
    ),
    await readFile(join(wrapperRoot, "bin/resource-config.mjs"), "utf8"),
    "canonical resource resolver preserved",
  );
});

test("fresh working tree shared-hook content is picked up, excluded state never ships, and source drift clears on refresh", async (t) => {
  const f = await fixture(t, { copyUpstream: true });
  const initial = await f.stage();
  const shared = join(f.options.upstreamRoot, "hooks/lib/workspace.py");
  const changed = `${await readFile(shared, "utf8")}\n# uncommitted development hook change\n`;
  await writeFile(shared, changed);
  for (const path of [
    "hooks/__pycache__/secret.pyc",
    "hooks/runtime-state/private.db",
    "server/resources/cache/private.txt",
  ]) {
    await mkdir(join(f.options.upstreamRoot, path, ".."), { recursive: true });
    await writeFile(join(f.options.upstreamRoot, path), "must never ship");
  }
  const stale = await f.status();
  assert.equal(stale.sourceDrift, true);
  assert.equal(stale.stagedDrift, false);
  const refreshed = await f.stage();
  assert.notEqual(
    refreshed.provenance.sharedHooksHash,
    initial.provenance.sharedHooksHash,
  );
  assert.equal(
    await readFile(
      join(f.options.destination, enginePrefix, "hooks/lib/workspace.py"),
      "utf8",
    ),
    changed,
  );
  for (const path of [
    "hooks/__pycache__",
    "hooks/runtime-state",
    "resources/cache",
  ]) {
    await assert.rejects(
      lstat(join(f.options.destination, enginePrefix, path)),
      { code: "ENOENT" },
    );
  }
  assert.equal((await f.status()).sourceDrift, false);
  assert.equal(
    (await stat(resolve(refreshed.backupPath, ".."))).mode & 0o777,
    0o700,
  );
});

test("staged and installed tampering are detected by file hashes, including unexpected root lib", async (t) => {
  const f = await fixture(t);
  await f.stage();
  const installed = join(f.root, "installed");
  await cp(f.options.destination, installed, { recursive: true });
  assert.equal((await f.status(installed)).installedDrift, false);
  await writeFile(
    join(installed, enginePrefix, "dist/index.js"),
    "stale installed engine",
  );
  assert.equal((await f.status(installed)).installedDrift, true);
  await mkdir(join(f.options.destination, "hooks/lib"));
  assert.equal((await f.status()).stagedDrift, true);
  await assert.rejects(
    verifyDevPlugin({ pluginRoot: f.options.destination }),
    /Root hooks\/lib must be absent/,
  );
});

test("exact wrapper symlink migrates by private rename; rollback restores the symlink and leaves its target unchanged", async (t) => {
  const f = await fixture(t);
  await symlink(wrapperRoot, f.options.destination);
  const wrapperIdentity = await readFile(
    join(wrapperRoot, "package.json"),
    "utf8",
  );
  const result = await f.stage();
  assert.equal((await lstat(f.options.destination)).isSymbolicLink(), false);
  assert.equal(await readlink(result.backupPath), wrapperRoot);
  await restoreDevPlugin({
    destination: result.destination,
    backupPath: result.backupPath,
    expectedArtifactHash: result.provenance.artifactHash,
  });
  assert.equal(await readlink(f.options.destination), wrapperRoot);
  assert.equal(
    await readFile(join(wrapperRoot, "package.json"), "utf8"),
    wrapperIdentity,
  );
});

test("unknown source directory and unknown symlink refuse ownership without touching either", async (t) => {
  const f = await fixture(t);
  await mkdir(f.options.destination);
  const sentinel = join(f.options.destination, "sentinel");
  await writeFile(sentinel, "operator-owned");
  await assert.rejects(f.stage(), /Refusing unmanaged/);
  assert.equal(await readFile(sentinel, "utf8"), "operator-owned");
  await rm(f.options.destination, { recursive: true });
  const target = join(f.root, "unknown");
  await mkdir(target);
  await symlink(target, f.options.destination);
  await assert.rejects(f.stage(), /Refusing unknown plugin source symlink/);
  assert.equal(await readlink(f.options.destination), target);
});

test("missing package metadata or shared hook library refuses refresh and preserves previous managed source", async (t) => {
  const f = await fixture(t, { copyUpstream: true });
  const initial = await f.stage();
  const configPath = join(f.options.upstreamRoot, "server/config.schema.json");
  const config = await readFile(configPath);
  await rm(configPath);
  await assert.rejects(f.stage(), /Missing regular runtime file/);
  assert.equal(
    (await f.status()).staged.artifactHash,
    initial.provenance.artifactHash,
  );
  await writeFile(configPath, config);
  await rm(join(f.options.upstreamRoot, "hooks/lib/workspace.py"));
  await assert.rejects(f.stage(), /Staged Python verification failed/);
  assert.equal(
    (await f.status()).staged.artifactHash,
    initial.provenance.artifactHash,
  );
});

test("broken engine verification refuses refresh before prior source is moved", async (t) => {
  const f = await fixture(t, { copyUpstream: true });
  const initial = await f.stage();
  await writeFile(
    join(f.options.upstreamRoot, "server/dist/index.js"),
    'throw new Error("fixture engine fails");',
  );
  await assert.rejects(f.stage(), /Staged MCP exited.*before verification/);
  const status = await f.status();
  assert.equal(status.staged.artifactHash, initial.provenance.artifactHash);
  assert.equal(status.stagedDrift, false);
  assert.equal(status.sourceDrift, true);
});

test("rollback with no prior source removes managed destination; later unexpected edits block rollback", async (t) => {
  const f = await fixture(t);
  const first = await f.stage();
  const rollback = await restoreDevPlugin({
    destination: first.destination,
    backupPath: null,
    expectedArtifactHash: first.provenance.artifactHash,
  });
  assert.equal(rollback.restored, false);
  await assert.rejects(lstat(first.destination), { code: "ENOENT" });
  const second = await f.stage();
  await writeFile(
    join(second.destination, "hooks/prompt-suggest.py"),
    "# concurrent operator change\n",
  );
  await assert.rejects(
    restoreDevPlugin({
      destination: second.destination,
      backupPath: null,
      expectedArtifactHash: second.provenance.artifactHash,
    }),
    /changed before rollback/,
  );
  assert.equal(
    await readFile(join(second.destination, "hooks/prompt-suggest.py"), "utf8"),
    "# concurrent operator change\n",
  );
});

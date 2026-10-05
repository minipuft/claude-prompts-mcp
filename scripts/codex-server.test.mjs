import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const original = `# Operator comments stay intact.
model = "example"
secret = "sentinel-do-not-print"
note = """A multiline value
with unrelated content."""

[mcp_servers.claude_prompts_mcp]
command = "node" # command comment
args = ["/old-checkout/server/dist/index.js", "--client=codex"]
enabled = false # local switch

[mcp_servers.claude_prompts_mcp.env]
PRIVATE_VALUE = "keep me"

[plugins."codex-prompts@minipuft"]
enabled = true # published switch

[plugins."codex-prompts@codex-prompts-dev"]
enabled = true

[plugins."unrelated@example"]
enabled = true
`;

const nativeCodexBinary = spawnSync("which", ["codex"], {
  encoding: "utf8",
}).stdout.trim();
function registration(f) {
  return `\n[marketplaces.codex-prompts-dev]\nsource_type = "local"\nsource = ${JSON.stringify(join(f.directory, "codex/dev-marketplace"))}\n`;
}

async function fixture(t, config = original) {
  const directory = await mkdtemp(join(tmpdir(), "codex-server-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const path of ["scripts", "server", "codex", "bin", "wrapper", "hooks"])
    await mkdir(join(directory, path));
  for (const name of ["codex-server.mjs", "codex-dev-plugin.mjs"])
    await copyFile(
      join(root, "scripts", name),
      join(directory, "scripts", name),
    );

  await writeFile(
    join(directory, "server/package.json"),
    '{"name":"claude-prompts","version":"9.9.9","type":"module"}',
  );
  await symlink(
    join(root, "server/node_modules"),
    join(directory, "server/node_modules"),
  );
  const files = {
    "server/dist/index.js": `import readline from 'node:readline';
readline.createInterface({input:process.stdin}).on('line',line=>{
const r=JSON.parse(line); if(!r.id)return;
const result=r.method==='initialize'?{protocolVersion:'2025-06-18'}:{tools:['prompt_engine','resource_manager','system_control'].map(name=>({name}))};
console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,result}));});`,
    "server/dist/index.js.map": "{}",
    "server/config.json": "{}",
    "server/config.schema.json": "{}",
    "server/resources/test.txt": "canonical resources",
    "hooks/lib/test.py": "# shared hooks",
    "wrapper/.mcp.json": "{}",
    "wrapper/.codex-plugin/plugin.json":
      '{"name":"codex-prompts","version":"1.2.3"}',
    "wrapper/package.json":
      '{"name":"codex-prompts","version":"1.2.3","type":"module"}',
    "wrapper/bin/start-mcp.mjs":
      "import '../node_modules/claude-prompts/dist/index.js';",
    "wrapper/bin/resource-config.mjs": "export const resources = true;",
    "wrapper/hooks/hooks.json": "{}",
    "wrapper/hooks/_codex_bootstrap.py": "# adapter",
    "wrapper/hooks/prompt-suggest.py": "# adapter",
  };
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(directory, name, ".."), { recursive: true });
    await writeFile(join(directory, name), content);
  }
  // Only external processes are substituted; staging, hashes, TOML and filesystem are real.
  const binaries = {
    git: `process.stdout.write(${JSON.stringify(
      Object.keys(files)
        .filter((name) => name.startsWith("wrapper/"))
        .map((name) => name.slice(8))
        .join("\0") + "\0",
    )});`,
    python3: `const path=require('node:path');
if(process.argv[2]==='-c') {const p=path.join(process.cwd(),'node_modules/claude-prompts/hooks'); console.log(JSON.stringify([path.join(p,'lib'),p]));}
else console.log(JSON.stringify({hookSpecificOutput:{additionalContext:'Use prompt_engine'}}));`,
    codex: `const fs=require('node:fs'),path=require('node:path');
const home=process.env.CODEX_HOME,config=path.join(home,'config.toml'),registry=path.join(home,'marketplaces.json');
const args=process.argv.slice(3),id='codex-prompts@codex-prompts-dev';
fs.appendFileSync(process.env.CODEX_LOG,args.join(' ')+'\\n');
const source=path.join(home,'dev-marketplace/plugins/codex-prompts');
const base=path.join(home,'plugins/cache/codex-prompts-dev/codex-prompts');
const table='[plugins."'+id+'"]';
function enabled(text) {const start=text.indexOf(table),end=text.indexOf('\\n[',start+table.length); const stop=end<0?text.length:end; return text.slice(0,start)+text.slice(start,stop).replace(/enabled = (true|false)/,'enabled = true')+text.slice(stop);}
function list() {let versions=[];try{versions=fs.readdirSync(base)}catch{}return {installed:versions.map(version=>({pluginId:id,version,installed:true}))};}
if(args[0]==='marketplace') {
 if(process.env.REAL_MARKETPLACE) {
 const result=require('node:child_process').spawnSync(process.env.NATIVE_CODEX_BINARY,['plugin',...args],{env:process.env,encoding:'utf8'});
 if(args[1]==='add'&&process.env.MARKETPLACE_CONFIG_EDIT) fs.appendFileSync(config,'\\n# Concurrent registration edit\\n');
 process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');process.exit(result.status??1);
 }

 if(args[1]==='list') console.log(JSON.stringify(fs.existsSync(registry)?JSON.parse(fs.readFileSync(registry)):{marketplaces:[]}));
 if(args[1]==='add') {const entry={marketplaces:[{name:'codex-prompts-dev',root:args[2],marketplaceSource:{sourceType:'local',source:args[2]}}]};fs.writeFileSync(registry,JSON.stringify(entry));fs.appendFileSync(config,'\\n[marketplaces.codex-prompts-dev]\\nsource_type = "local"\\nsource = '+JSON.stringify(args[2])+'\\n');if(process.env.MARKETPLACE_CONFIG_EDIT)fs.appendFileSync(config,'\\n# Concurrent registration edit\\n');console.log(JSON.stringify({marketplaceName:'codex-prompts-dev'}));}
} else if(args[0]==='list') console.log(JSON.stringify(list()));
else if(args[0]==='remove') {
 fs.rmSync(base,{recursive:true,force:true});
 let text=fs.readFileSync(config,'utf8'),start=text.indexOf(table),end=text.indexOf('\\n[',start+table.length);
 text=text.slice(0,start)+(end<0?'':text.slice(end));fs.writeFileSync(config,text);console.log(JSON.stringify({pluginId:id}));
} else if(args[0]==='add') {
 const failed=path.join(home,'failed-once'),shouldFail=process.env.FAIL_INSTALL&&!fs.existsSync(failed);
 if(shouldFail&&process.env.FAIL_INSTALL==='before'){fs.writeFileSync(failed,'1');process.exit(19);}
 const version=JSON.parse(fs.readFileSync(path.join(source,'.codex-plugin/plugin.json'))).version;
 const dest=path.join(base,version);fs.rmSync(dest,{recursive:true,force:true});fs.mkdirSync(path.dirname(dest),{recursive:true});fs.cpSync(source,dest,{recursive:true,dereference:true});
 fs.writeFileSync(config,enabled(fs.readFileSync(config,'utf8')));
 if(shouldFail&&process.env.FAIL_INSTALL==='after'){fs.writeFileSync(failed,'1');process.exit(19);}
 if(shouldFail&&process.env.FAIL_INSTALL==='mismatch'){fs.writeFileSync(failed,'1');fs.appendFileSync(path.join(dest,'node_modules/claude-prompts/dist/index.js'),'\\n// mismatch');}
 if(process.env.INSTALL_CONFIG_EDIT)fs.appendFileSync(config,'\\n# Concurrent native edit\\n');
 console.log(JSON.stringify({pluginId:id,installedPath:dest,version}));
}`,
  };
  for (const [name, content] of Object.entries(binaries))
    await writeFile(
      join(directory, "bin", name),
      `#!${process.execPath}\n${content}\n`,
      { mode: 0o755 },
    );
  const configPath = join(directory, "codex/config.toml");
  await writeFile(configPath, config, { mode: 0o640 });
  const npmLog = join(directory, "npm.log");
  await writeFile(
    join(directory, "bin/npm"),
    `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(process.env.NPM_LOG, process.argv.slice(2).join(' ') + '\\n');
if (process.env.CONFIG_EDIT) fs.appendFileSync(process.env.CONFIG_EDIT, '\\n# Concurrent edit\\n');
if (process.env.FAIL_SCRIPT === process.argv[3]) process.exit(17);
`,
    { mode: 0o755 },
  );
  const cache = join(
    directory,
    "codex/plugins/cache/minipuft/codex-prompts/1.2.3",
  );
  await mkdir(join(cache, ".codex-plugin"), { recursive: true });
  await writeFile(
    join(cache, ".codex-plugin/plugin.json"),
    '{"name":"codex-prompts","version":"1.2.3"}',
  );
  return {
    directory,
    configPath,
    cache,
    npmLog,
    run(mode, env = {}) {
      return spawnSync(
        process.execPath,
        [
          join(directory, "scripts/codex-server.mjs"),
          mode,
          "--config",
          configPath,
          "--wrapper",
          join(directory, "wrapper"),
        ],
        {
          encoding: "utf8",
          cwd: tmpdir(),
          env: {
            ...process.env,
            PATH: `${join(directory, "bin")}:${process.env.PATH}`,
            NPM_LOG: npmLog,
            CODEX_LOG: join(directory, "codex.log"),
            NATIVE_CODEX_BINARY: nativeCodexBinary,
            ...env,
          },
        },
      );
    },
  };
}

async function backups(f) {
  return (await readdir(join(f.directory, "codex"))).filter((name) =>
    name.startsWith("config.toml.bak."),
  );
}

test("engine-only builds then probes, rebinds checkout, disables both plugins, preserves comments and makes a private backup", async (t) => {
  const f = await fixture(t);
  const result = f.run("engine-only");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(f.npmLog, "utf8"), "run build\nrun verify:mcp\n");
  const expected = original
    .replace(
      "/old-checkout/server/dist/index.js",
      join(f.directory, "server/dist/index.js"),
    )
    .replace("enabled = false # local switch", "enabled = true # local switch")
    .replace(
      "enabled = true # published switch",
      "enabled = false # published switch",
    )
    .replace(
      '[plugins."codex-prompts@codex-prompts-dev"]\nenabled = true',
      '[plugins."codex-prompts@codex-prompts-dev"]\nenabled = false',
    );
  assert.equal(await readFile(f.configPath, "utf8"), expected);
  const names = await backups(f);
  assert.equal(names.length, 1);
  assert.equal(
    await readFile(join(f.directory, "codex", names[0]), "utf8"),
    original,
  );
  assert.equal(
    (await stat(join(f.directory, "codex", names[0]))).mode & 0o777,
    0o600,
  );
  assert.equal((await stat(f.configPath)).mode & 0o777, 0o640);
  assert.match(result.stdout, /Running session\/build: unknown/);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /sentinel-do-not-print|PRIVATE_VALUE/,
  );
});

test("prod switches only to published plugin, runs no build/install/update, and a repeated switch writes nothing", async (t) => {
  const f = await fixture(t);
  assert.equal(f.run("engine-only").status, 0);
  const logBefore = await readFile(f.npmLog, "utf8");
  const first = f.run("prod");
  assert.equal(first.status, 0, first.stderr);
  const config = await readFile(f.configPath, "utf8");
  assert.match(config, /enabled = false # local switch/);
  assert.match(config, /enabled = true # published switch/);
  assert.match(config, /codex-prompts-dev"\]\nenabled = false/);
  assert.equal(await readFile(f.npmLog, "utf8"), logBefore);
  const backupBefore = await backups(f);
  const second = f.run("prod");
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /Already configured/);
  assert.equal(await readFile(f.configPath, "utf8"), config);
  assert.deepEqual(await backups(f), backupBefore);
});

test("repeated dev still builds and verifies, but creates no redundant backup", async (t) => {
  const f = await fixture(t);
  const first = f.run("dev");
  assert.equal(first.status, 0, first.stderr);
  const second = f.run("dev");
  assert.equal(second.status, 0, second.stderr);
  assert.equal((await backups(f)).length, 1);
  assert.equal(
    await readFile(f.npmLog, "utf8"),
    "run build\nrun verify:mcp\nrun build\nrun verify:mcp\n",
  );
});

for (const failedScript of ["build", "verify:mcp"]) {
  test(`${failedScript} failure leaves configuration untouched and creates no backup`, async (t) => {
    const f = await fixture(t);
    const result = f.run("dev", { FAIL_SCRIPT: failedScript });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /configuration unchanged/);
    assert.equal(await readFile(f.configPath, "utf8"), original);
    assert.equal((await backups(f)).length, 0);
    if (failedScript === "build")
      assert.equal(await readFile(f.npmLog, "utf8"), "run build\n");
  });
}

test("status is read-only and distinguishes cached/source metadata from running build", async (t) => {
  const f = await fixture(t);
  const result = f.run("status");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /source package version: 9\.9\.9/);
  assert.match(result.stdout, /plugin 1\.2\.3; engine package unknown/);
  assert.match(result.stdout, /Running session\/build: unknown/);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /sentinel-do-not-print|PRIVATE_VALUE/,
  );
  assert.equal(await readFile(f.configPath, "utf8"), original);
  assert.equal((await backups(f)).length, 0);
  await assert.rejects(readFile(f.npmLog), { code: "ENOENT" });
});

for (const [label, content] of [
  [
    "missing entry",
    original.replace(
      '[plugins."codex-prompts@minipuft"]',
      '[plugins."absent"]',
    ),
  ],
  [
    "duplicate table",
    original + '\n[plugins."codex-prompts@minipuft"]\nenabled = true\n',
  ],
  ["malformed TOML", original + '\npassword = "sentinel-do-not-print'],
  [
    "unsupported inline table",
    original.replace(
      '[plugins."codex-prompts@codex-prompts-dev"]\nenabled = true',
      '[plugins."codex-prompts@codex-prompts-dev"]\nother = { enabled = true }',
    ),
  ],
  [
    "multiline fake header",
    'trick = """\n[plugins."codex-prompts@minipuft"]\nenabled = true\n"""\n' +
      original,
  ],
]) {
  test(`${label} fails closed without exposing source`, async (t) => {
    const f = await fixture(t, content);
    const result = f.run("dev");
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /sentinel-do-not-print/);
    assert.equal(await readFile(f.configPath, "utf8"), content);
    assert.equal((await backups(f)).length, 0);
    await assert.rejects(readFile(f.npmLog), { code: "ENOENT" });
  });
}

test("prod refuses missing cached plugin", async (t) => {
  const f = await fixture(t);
  await rm(f.cache, { recursive: true });
  const result = f.run("prod");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not cached/);
  assert.equal(await readFile(f.configPath, "utf8"), original);
});

test("concurrent edit during build is not overwritten", async (t) => {
  const f = await fixture(t);
  const result = f.run("dev", { CONFIG_EDIT: f.configPath });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /changed during validation/);
  assert.equal(
    await readFile(f.configPath, "utf8"),
    original + "\n# Concurrent edit\n\n# Concurrent edit\n",
  );
  assert.equal((await backups(f)).length, 0);
});

test("existing switch lock and symlink configs are refused", async (t) => {
  const f = await fixture(t);
  await writeFile(`${f.configPath}.codex-server.lock`, "");
  assert.match(f.run("dev").stderr, /lock already exists/);
  await rm(`${f.configPath}.codex-server.lock`);
  const target = join(f.directory, "other.toml");
  await copyFile(f.configPath, target);
  await rm(f.configPath);
  await symlink(target, f.configPath);
  assert.match(f.run("dev").stderr, /no symlinks/);
  assert.equal(await readFile(target, "utf8"), original);
});

for (const features of [
  "",
  "\n[features]\nhooks = false # hook setting\n",
  "\n[features]\nother = true\n",
]) {
  test(`dev enables only current plugin and hooks with features ${features || "missing"}`, async (t) => {
    const f = await fixture(t, original + features);
    const result = f.run("dev");
    assert.equal(result.status, 0, result.stderr);
    const config = await readFile(f.configPath, "utf8");
    assert.match(config, /enabled = false # local switch/);
    assert.match(config, /enabled = false # published switch/);
    assert.match(config, /codex-prompts-dev"\]\nenabled = true/);
    assert.match(config, /\[features\]\n(?:other = true\n)?hooks = true/);
    assert.match(config, /sentinel-do-not-print/);
    assert.match(config, /PRIVATE_VALUE = "keep me"/);
    assert.match(config, /enabled = true #.*|enabled = true/);
    const source = join(
      f.directory,
      "codex/dev-marketplace/plugins/codex-prompts",
    );
    const installed = join(
      f.directory,
      "codex/plugins/cache/codex-prompts-dev/codex-prompts/1.2.3",
    );
    const marker = await readFile(
      join(source, ".codex-dev-plugin.json"),
      "utf8",
    );
    assert.equal(
      await readFile(join(installed, ".codex-dev-plugin.json"), "utf8"),
      marker,
    );
    const provenance = JSON.parse(marker);
    assert.equal(provenance.engineVersion, "9.9.9");
    assert.equal(
      await readFile(
        join(installed, "node_modules/claude-prompts/hooks/lib/test.py"),
        "utf8",
      ),
      "# shared hooks",
    );
    assert.match(
      await readFile(join(f.directory, "codex.log"), "utf8"),
      /add codex-prompts@codex-prompts-dev --json/,
    );
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /sentinel-do-not-print|PRIVATE_VALUE/,
    );
    assert.match(result.stdout, /trust remains subject to Codex review/);
  });
}

for (const failure of ["before", "after", "mismatch"]) {
  test(`installer ${failure} failure restores previous installed and staged artifact plus settings`, async (t) => {
    const f = await fixture(t);
    const ready = f.run("dev");
    assert.equal(ready.status, 0, ready.stderr);
    const source = join(
      f.directory,
      "codex/dev-marketplace/plugins/codex-prompts",
    );
    const installed = join(
      f.directory,
      "codex/plugins/cache/codex-prompts-dev/codex-prompts/1.2.3",
    );
    const previousConfig = await readFile(f.configPath, "utf8");
    const previousMarker = await readFile(
      join(source, ".codex-dev-plugin.json"),
      "utf8",
    );
    const previousBundle = await readFile(
      join(installed, "node_modules/claude-prompts/dist/index.js"),
      "utf8",
    );
    await writeFile(
      join(f.directory, "server/dist/index.js"),
      previousBundle + "\n// latest source\n",
    );
    const result = f.run("dev", { FAIL_INSTALL: failure });
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Previous managed plugin and settings restored/,
    );
    assert.equal(await readFile(f.configPath, "utf8"), previousConfig);
    assert.equal(
      await readFile(join(source, ".codex-dev-plugin.json"), "utf8"),
      previousMarker,
    );
    assert.equal(
      await readFile(join(installed, ".codex-dev-plugin.json"), "utf8"),
      previousMarker,
    );
    assert.equal(
      await readFile(
        join(installed, "node_modules/claude-prompts/dist/index.js"),
        "utf8",
      ),
      previousBundle,
    );
    assert.equal((await backups(f)).length, 1);
  });
}

test("first installer failure removes partial install and restores original configuration and absent stage", async (t) => {
  const f = await fixture(t);
  const result = f.run("dev", { FAIL_INSTALL: "after" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Previous managed plugin and settings restored/);
  assert.equal(
    await readFile(f.configPath, "utf8"),
    original + registration(f),
  );
  await assert.rejects(
    stat(join(f.directory, "codex/dev-marketplace/plugins/codex-prompts")),
    { code: "ENOENT" },
  );
  await assert.rejects(
    stat(
      join(f.directory, "codex/plugins/cache/codex-prompts-dev/codex-prompts"),
    ),
    { code: "ENOENT" },
  );
});

test("dev refresh installs changed shared hooks and status reports source drift read-only", async (t) => {
  const f = await fixture(t);
  const result = f.run("dev");
  assert.equal(result.status, 0, result.stderr);
  const installed = join(
    f.directory,
    "codex/plugins/cache/codex-prompts-dev/codex-prompts/1.2.3",
  );
  const first = JSON.parse(
    await readFile(join(installed, ".codex-dev-plugin.json"), "utf8"),
  );
  await writeFile(
    join(f.directory, "hooks/lib/test.py"),
    "# current shared hooks",
  );
  const before = await readFile(f.configPath, "utf8");
  const status = f.run("status");
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /sourceDrift: true/);
  assert.match(status.stdout, /stagedDrift: false/);
  assert.match(status.stdout, /installedDrift: false/);
  assert.equal(await readFile(f.configPath, "utf8"), before);
  const refresh = f.run("dev");
  assert.equal(refresh.status, 0, refresh.stderr);
  const second = JSON.parse(
    await readFile(join(installed, ".codex-dev-plugin.json"), "utf8"),
  );
  assert.notEqual(first.sharedHooksHash, second.sharedHooksHash);
  assert.equal(
    await readFile(
      join(installed, "node_modules/claude-prompts/hooks/lib/test.py"),
      "utf8",
    ),
    "# current shared hooks",
  );
  assert.equal((await backups(f)).length, 1);
});

test("conflicting marketplace source refuses installation and restores stage without changing config", async (t) => {
  const f = await fixture(t);
  const path = join(
    f.directory,
    "codex/dev-marketplace/.claude-plugin/marketplace.json",
  );
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({
      name: "codex-prompts-dev",
      plugins: [{ name: "codex-prompts", source: "./unmanaged" }],
    }),
  );
  const result = f.run("dev");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /name\/source conflicts/);
  assert.equal(await readFile(f.configPath, "utf8"), original);
  await assert.rejects(
    stat(join(f.directory, "codex/dev-marketplace/plugins/codex-prompts")),
    { code: "ENOENT" },
  );
  await assert.rejects(readFile(join(f.directory, "codex.log")), {
    code: "ENOENT",
  });
});

test("installer concurrent configuration edit is preserved and reported instead of silently rolled back", async (t) => {
  const f = await fixture(t);
  const result = f.run("dev", { INSTALL_CONFIG_EDIT: "1" });
  // A comment edit is still concurrent state and must not disappear during formatting restoration.
  assert.equal(result.status, 1);
  assert.match(result.stderr, /concurrent|changed/);
  assert.match(await readFile(f.configPath, "utf8"), /Concurrent native edit/);
});

test("cold registration succeeds through the actual native Codex marketplace installer", async (t) => {
  assert.ok(
    nativeCodexBinary,
    "Native Codex binary is required for registration integration",
  );
  const f = await fixture(t);
  const result = f.run("dev", { REAL_MARKETPLACE: "1" });
  assert.equal(result.status, 0, result.stderr);
  const config = await readFile(f.configPath, "utf8");
  assert.ok(config.includes(registration(f)));
  assert.match(config, /enabled = false # local switch/);
  assert.match(config, /enabled = false # published switch/);
  assert.match(config, /codex-prompts-dev"\]\nenabled = true/);
  assert.match(config, /hooks = true/);
  const names = await backups(f);
  assert.equal(names.length, 1);
  assert.equal(
    await readFile(join(f.directory, "codex", names[0]), "utf8"),
    original,
  );
  assert.equal(
    (await stat(join(f.directory, "codex", names[0]))).mode & 0o777,
    0o600,
  );
  const again = f.run("dev", { REAL_MARKETPLACE: "1" });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(await readFile(f.configPath, "utf8"), config);
  assert.equal((await backups(f)).length, 1);
});

test("cold native registration remains while failed installation restores original enablement and unrelated bytes", async (t) => {
  const f = await fixture(t);
  const result = f.run("dev", { REAL_MARKETPLACE: "1", FAIL_INSTALL: "after" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Previous managed plugin and settings restored/);
  assert.equal(
    await readFile(f.configPath, "utf8"),
    original + registration(f),
  );
  assert.equal((await backups(f)).length, 1);
  await assert.rejects(
    stat(join(f.directory, "codex/dev-marketplace/plugins/codex-prompts")),
    { code: "ENOENT" },
  );
});

test("concurrent comment during real native registration survives an aborted switch", async (t) => {
  const f = await fixture(t);
  const result = f.run("dev", {
    REAL_MARKETPLACE: "1",
    MARKETPLACE_CONFIG_EDIT: "1",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /concurrent edits preserved/);
  assert.equal(
    await readFile(f.configPath, "utf8"),
    original + registration(f) + "\n# Concurrent registration edit\n",
  );
  const names = await backups(f);
  assert.equal(names.length, 1);
  assert.equal(
    await readFile(join(f.directory, "codex", names[0]), "utf8"),
    original,
  );
  assert.doesNotMatch(
    await readFile(join(f.directory, "codex.log"), "utf8"),
    /^add codex-prompts@/m,
  );
  await assert.rejects(
    stat(join(f.directory, "codex/dev-marketplace/plugins/codex-prompts")),
    { code: "ENOENT" },
  );
});

test("help documents all modes and the explicit wrapper input without subprocess work", async (t) => {
  const f = await fixture(t);
  const result = f.run("--help");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dev\|engine-only\|prod\|status/);
  assert.match(result.stdout, /--wrapper \/path\/to\/codex-prompts/);
  await assert.rejects(readFile(f.npmLog), { code: "ENOENT" });
  await assert.rejects(readFile(join(f.directory, "codex.log")), {
    code: "ENOENT",
  });
});

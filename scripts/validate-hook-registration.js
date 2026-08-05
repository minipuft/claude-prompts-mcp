#!/usr/bin/env node
/**
 * Every hook this plugin ships must be reachable, and every hook it registers must exist.
 *
 * Both directions failed silently before this gate (2026-08-05):
 *
 *   unregistered -> `session-skills.py` and `subagent-gate-enforce.py` sat in `hooks/` wired
 *                   into no `hooks.json`, here or downstream. They looked like live hooks in
 *                   every listing, shipped in the npm tarball, and ran nowhere. A downstream
 *                   adapter then imported one of them as if it were a supported module.
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

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const HOOKS_DIR = path.join(REPO_ROOT, 'hooks');
const HOOKS_JSON = path.join(HOOKS_DIR, 'hooks.json');

/** Modules, not hooks: imported by hooks rather than invoked by an event. */
const MODULE_PREFIXES = ['_'];

const UNREGISTERED_EXCEPTIONS = {
  'subagent-gate-enforce.py': {
    reason:
      'SubagentStop verdict enforcement, written during the codex port. Never wired into this ' +
      "plugin's hooks.json, and codex registers no SubagentStop event either, so it runs nowhere.",
    closedBy:
      'Register it on SubagentStop after confirming the transcript shape it parses is still ' +
      'what the harness writes, or delete it.',
  },
};

/** Script basenames referenced by any command in hooks.json. */
function registeredScripts(config) {
  const names = new Set();
  for (const matchers of Object.values(config.hooks || {})) {
    for (const matcher of matchers) {
      for (const hook of matcher.hooks || []) {
        const command = hook.command || '';
        for (const match of command.matchAll(/([\w.-]+\.py)/g)) names.add(match[1]);
      }
    }
  }
  return names;
}

function shippedHooks(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.py'))
    .filter((f) => !MODULE_PREFIXES.some((p) => f.startsWith(p)))
    .sort();
}

function collect(hooksDir, hooksJsonPath) {
  const config = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
  const registered = registeredScripts(config);
  const shipped = shippedHooks(hooksDir);

  const unregistered = shipped.filter(
    (f) => !registered.has(f) && !UNREGISTERED_EXCEPTIONS[f]
  );
  const dangling = [...registered].filter((f) => !fs.existsSync(path.join(hooksDir, f))).sort();
  const staleExceptions = Object.keys(UNREGISTERED_EXCEPTIONS).filter(
    (f) => !shipped.includes(f) || registered.has(f)
  );

  return { registered, shipped, unregistered, dangling, staleExceptions };
}

function selfTest() {
  const os = require('node:os');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-registration-'));
  const write = (name, body) => fs.writeFileSync(path.join(sandbox, name), body);
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  try {
    write('alpha.py', '');
    write('_module.py', '');
    write(
      'hooks.json',
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: '*', hooks: [{ command: 'python3 ${CLAUDE_PLUGIN_ROOT}/hooks/alpha.py' }] },
          ],
        },
      })
    );
    let result = collect(sandbox, path.join(sandbox, 'hooks.json'));
    assert(result.unregistered.length === 0, 'registered hook wrongly flagged');
    assert(result.dangling.length === 0, 'existing hook wrongly flagged as dangling');
    assert(!result.shipped.includes('_module.py'), 'underscore module treated as a hook');

    // An unregistered hook with no exception is the motivating failure — it must fail.
    write('orphan.py', '');
    result = collect(sandbox, path.join(sandbox, 'hooks.json'));
    assert(
      result.unregistered.includes('orphan.py'),
      'unregistered hook NOT detected — the gate is vacuous'
    );

    // A hooks.json entry naming a missing file must fail too.
    fs.unlinkSync(path.join(sandbox, 'alpha.py'));
    result = collect(sandbox, path.join(sandbox, 'hooks.json'));
    assert(result.dangling.includes('alpha.py'), 'dangling registration NOT detected');

    console.log(
      'validate-hook-registration self-test OK — detects an unregistered hook, a dangling ' +
        'registration, and ignores underscore-prefixed modules.'
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const { shipped, unregistered, dangling, staleExceptions } = collect(HOOKS_DIR, HOOKS_JSON);
  let failed = false;

  if (dangling.length > 0) {
    console.error('[validate-hook-registration] hooks.json names files that do not exist:\n');
    for (const name of dangling) console.error(`  ${name}`);
    console.error(
      '\nA hook command that cannot launch is read as a BLOCK decision on that event by Codex.\n' +
        'Ship the file or remove the registration.'
    );
    failed = true;
  }

  if (unregistered.length > 0) {
    if (failed) console.error('');
    console.error('[validate-hook-registration] shipped hooks that no hooks.json registers:\n');
    for (const name of unregistered) console.error(`  hooks/${name}`);
    console.error(
      '\nThese ship in the npm tarball and run nowhere, which reads as a live hook to anyone\n' +
        'listing the directory. Register it, delete it, move it to a `_`-prefixed module, or add\n' +
        'an UNREGISTERED_EXCEPTIONS entry naming what closes it.'
    );
    failed = true;
  }

  if (staleExceptions.length > 0) {
    if (failed) console.error('');
    console.error('[validate-hook-registration] exceptions that no longer apply:\n');
    for (const name of staleExceptions) console.error(`  ${name} — now registered or deleted`);
    console.error('\nRemove the entry; a bypass outliving its cause is how they become permanent.');
    failed = true;
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }

  const exempt = Object.keys(UNREGISTERED_EXCEPTIONS).length;
  console.log(
    `validate-hook-registration OK — ${shipped.length - exempt}/${shipped.length} shipped hooks ` +
      `registered, ${exempt} declared exception(s), no dangling registrations.`
  );
}

main();

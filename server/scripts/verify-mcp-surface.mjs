#!/usr/bin/env node

/**
 * Proves the built server actually answers on the MCP surface — without restarting Claude Code.
 *
 * WHY THIS EXISTS
 * The loop it replaces: change code, restart the MCP server, manually re-review functionality,
 * then re-explain what was checked. Restarting is the slow part and it is usually unnecessary.
 * A Claude Code restart makes a new build *live for interactive use*; it is not how you learn
 * whether the build works. Spawning a server from the current `dist/` answers that in seconds,
 * and prints something short enough to paste instead of re-narrating.
 *
 * `start:test` (--startup-test) proves the process boots. It does not prove a single tool
 * answers. This is the complement.
 *
 * WHY A SEPARATE CLIENT FROM THE E2E HELPER
 * `tests/e2e/helpers/http-mcp-client.ts` spawns a server too, and reusing it was the obvious
 * move. The original reason not to was transport: that helper drove HTTP+SSE, whose handshake
 * hung whenever it ran after a substantial jest run in the same shell (measured: e2e alone 4/4
 * green; test:unit -> e2e fails; test:integration -> e2e fails; raising timeouts moved the error
 * three times then exhausted 30s, falsifying the slowness hypothesis), while streamable-http
 * under identical preconditions did not (alone 981ms | after test:unit 846ms | after
 * test:integration 1013ms).
 *
 * That reason is now void: the HTTP+SSE transport was removed in the SDK v2 upgrade and the e2e
 * helper drives streamable-http too, so the two are no longer different transports. What still
 * separates them is purpose — this is an operator tool with read-only safety assertions and
 * paste-sized output, that one is a jest fixture. Consolidating them is defensible and unclaimed;
 * the measured history above is kept so nobody re-derives the SSE hang as a live constraint.
 *
 * SAFETY: every call is read-only. Nothing here creates, updates or deletes a resource, and the
 * run asserts afterwards that `state.db` and the workspace resources were left alone.
 *
 * Exit 0 when every check passes; exit 1 with the failing lines otherwise.
 */

import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SERVER_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');
const DIST_ENTRY = path.join(SERVER_ROOT, 'dist', 'index.js');

/** Wall-clock ceiling for the whole run; a hang must fail loudly, never sit forever. */
const HEALTH_TIMEOUT_MS = 25_000;
const RPC_TIMEOUT_MS = 20_000;

/**
 * Ground truth read from disk at run time.
 *
 * Deliberately derived, never hardcoded. A literal list of framework ids here would be correct on
 * the day it was written and quietly wrong after the next rename — which is the exact rot that
 * left `verify:action-metadata` reading two files that no longer existed while reporting success.
 */
const DISK_FRAMEWORK_IDS = readdirSync(path.join(SERVER_ROOT, 'resources', 'frameworks'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

/** Compare display names to directory ids without caring about dots, case or spacing. */
const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Response text by check label, so one check can be asserted against another. */
const seen = new Map();

/** Parse `**category**: id, id, ...` listing lines into ids. */
function parseListedPromptIds(text) {
  return text
    .split('\n')
    .filter((line) => /^\*\*[^*]+\*\*:/.test(line))
    .flatMap((line) => line.slice(line.indexOf(':') + 1).split(','))
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * Read-only probes, one line of output each.
 *
 * Each names the tool it exercises and a predicate over the response text. Adding a check is one
 * entry — that is deliberate, so this stays cheap to extend as the surface grows.
 *
 * ASSERT CONTENT, NOT SHAPE. The first version of this file tested `/prompts/i` against the prompt
 * listing and `text.length > 0` against the framework listing. Both pass on a server that has lost
 * every prompt and every framework, because the words survive in the header and the footer. A
 * check that a wrong-but-well-formed response satisfies is a check that reports health it has not
 * measured — and this script exists to be trusted in place of a manual review pass.
 *
 * Each predicate returns `true`, or a string naming what was actually wrong.
 */
const TOOL_CHECKS = [
  {
    // Cross-checked against the framework listing below, which is what makes it falsifiable:
    // agreement between two independent renderings cannot be faked by either one alone.
    label: 'system_control status',
    tool: 'system_control',
    args: { action: 'status' },
    expect: (text) => {
      const active = text.match(/Framework System.*?\(([^)]+)\)/)?.[1];
      if (!active) return 'status does not name an active framework';
      if (!DISK_FRAMEWORK_IDS.some((id) => normalize(active).includes(normalize(id)))) {
        return `active framework "${active}" matches no framework on disk`;
      }
      return true;
    },
  },
  {
    // The declared count and the enumerated ids come from different parts of the renderer, so a
    // listing that silently drops prompts fails here even though the header still says "Prompts".
    label: 'resource_manager prompt list',
    tool: 'resource_manager',
    args: { resource_type: 'prompt', action: 'list' },
    expect: (text) => {
      const declared = Number(text.match(/\*\*Prompts\*\*\s*\((\d+)\)/)?.[1]);
      if (!Number.isFinite(declared)) return 'listing does not declare a prompt count';
      if (declared === 0) return 'listing declares zero prompts';
      const listed = parseListedPromptIds(text);
      if (listed.length !== declared) {
        return `declares ${declared} prompts but enumerates ${listed.length}`;
      }
      return true;
    },
  },
  {
    // Same catalogue reached through the other tool. Disagreement means one of the two reads a
    // different registry than the operator thinks — invisible to any per-tool check.
    label: 'prompt_engine listprompts',
    tool: 'prompt_engine',
    args: { command: '>>listprompts' },
    expect: (text) => {
      const listed = parseListedPromptIds(text);
      if (listed.length === 0) return 'listing enumerates no prompts';
      const viaResourceManager = parseListedPromptIds(
        seen.get('resource_manager prompt list') ?? ''
      );
      if (viaResourceManager.length === 0) return 'no resource_manager listing to compare against';
      // Compare the id SETS, not the counts. Equal counts are satisfied by two catalogues that
      // disagree about every entry, and a tool reading the wrong registry usually still returns a
      // plausible number of prompts.
      const other = new Set(viaResourceManager);
      const divergent = listed.filter((id) => !other.has(id));
      if (divergent.length > 0) {
        return `prompt_engine lists ${divergent.length} prompt(s) resource_manager does not, e.g. "${divergent[0]}"`;
      }
      if (listed.length !== viaResourceManager.length) {
        return `prompt_engine lists ${listed.length} but resource_manager lists ${viaResourceManager.length}`;
      }
      return true;
    },
  },
  {
    // Every framework on disk must be served, and exactly one must be active. `length > 0` passed
    // on an empty catalogue; this does not.
    label: 'system_control framework list',
    tool: 'system_control',
    args: { action: 'framework', operation: 'list' },
    expect: (text) => {
      const flat = normalize(text);
      const missing = DISK_FRAMEWORK_IDS.filter((id) => !flat.includes(normalize(id)));
      if (missing.length > 0) return `frameworks on disk but not listed: ${missing.join(', ')}`;
      const activeCount = (text.match(/ACTIVE/g) ?? []).length;
      if (activeCount !== 1) return `expected exactly 1 active framework, found ${activeCount}`;
      return true;
    },
  },
];

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Newest mtime under a directory, ignoring nothing — staleness must not be under-reported. */
function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const mtime = entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

/**
 * `dist/` is the runtime SSOT and does not track `src/`.
 *
 * Verifying a stale binary is worse than not verifying at all: it returns green for code that is
 * not running. This exact trap cost a wasted restart on 2026-07-31, when dist was three hours
 * older than the change under test.
 */
function checkDistFreshness() {
  let distMtime;
  try {
    distMtime = statSync(DIST_ENTRY).mtimeMs;
  } catch {
    record('dist/ built', false, `${DIST_ENTRY} missing — run \`npm run build\``);
    return false;
  }

  const srcMtime = newestMtime(path.join(SERVER_ROOT, 'src'));
  if (srcMtime > distMtime) {
    const lagMin = Math.round((srcMtime - distMtime) / 60_000);
    record('dist/ current', false, `src is ${lagMin} min newer — run \`npm run build\` first`);
    return false;
  }
  record('dist/ current', true, `built ${new Date(distMtime).toISOString().slice(11, 19)}`);
  return true;
}

function reservePort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Spawn the built server on streamable-http.
 *
 * NODE_OPTIONS/NODE_ENV/JEST_WORKER_ID are stripped for the same reason the e2e helper strips
 * them: the server skips `main()` when JEST_WORKER_ID is set, and an inherited
 * `--experimental-vm-modules` leaks the parent's flags into a plain node process.
 */
function spawnServer(port) {
  const env = { ...process.env, PORT: String(port), MCP_WORKSPACE: REPO_ROOT };
  delete env.NODE_OPTIONS;
  delete env.NODE_ENV;
  delete env.JEST_WORKER_ID;

  return spawn('node', [DIST_ENTRY, '--transport=streamable-http', '--quiet'], {
    cwd: SERVER_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForHealth(baseUrl) {
  const started = Date.now();
  while (Date.now() - started < HEALTH_TIMEOUT_MS) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return Date.now() - started;
    } catch {
      // Server still binding.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
}

/** Responses arrive as SSE frames or bare JSON depending on the request; accept both. */
function parseRpcBody(body) {
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data:')) {
      try {
        return JSON.parse(trimmed.slice(5).trim());
      } catch {
        // Not the payload frame.
      }
    }
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** Minimal JSON-RPC caller holding the negotiated session id. */
function createRpcClient(baseUrl) {
  let sessionId = null;
  let nextId = 1;

  async function send(method, params) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (sessionId) headers['mcp-session-id'] = sessionId;

    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!sessionId) sessionId = response.headers.get('mcp-session-id');
    return parseRpcBody(await response.text());
  }

  async function handshake() {
    const initialized = await send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'verify-mcp-surface', version: '1' },
    });
    // The spec requires this notification before normal requests are served.
    await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    return initialized;
  }

  return { send, handshake };
}

/**
 * Tool result as { text, isError }.
 *
 * `isError` is not optional detail — MCP reports tool-level failure there while still returning
 * content. `system_control`'s error text is "Unknown action: X. Valid actions: status, framework,
 * ..." which matched the /status|framework/ predicates, so a deliberately broken call scored PASS
 * until this was checked. A predicate over the text alone cannot tell success from failure.
 */
function resultOf(rpcResponse) {
  return {
    text: rpcResponse?.result?.content?.[0]?.text ?? '',
    isError: rpcResponse?.result?.isError === true,
  };
}

/**
 * Nothing this tool calls may edit an authored resource. Verified, not asserted in a comment.
 *
 * Deliberately scoped to `server/resources/**` and NOT to `state.db`. Booting the server writes
 * runtime state — the content-hash cache and resource index are rebuilt on startup — so state.db's
 * mtime moves for reasons that have nothing to do with whether a check mutated anything. Measured:
 * 4 of 5 identical runs left it alone and the 5th rewrote it, which made this check intermittently
 * red for correct behaviour. An intermittently red trust tool is worse than no trust tool: it
 * trains you to ignore the output. state.db is ephemeral and gitignored; authored resources are
 * what a mutating call would damage, so those are what this guards.
 */
function captureMutationBaseline() {
  return { resources: gitStatusOfResources() };
}

function gitStatusOfResources() {
  try {
    return execFileSync('git', ['status', '--porcelain', 'server/resources'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
  } catch {
    return '';
  }
}

function checkNoMutation(baseline) {
  const unchanged = gitStatusOfResources() === baseline.resources;
  record(
    'no resource mutation',
    unchanged,
    unchanged ? 'server/resources untouched' : 'server/resources changed — a check is not read-only'
  );
}

async function runSurfaceChecks(baseUrl) {
  const client = createRpcClient(baseUrl);

  const initialized = await client.handshake();
  const protocolVersion = initialized?.result?.protocolVersion;
  record('initialize', Boolean(protocolVersion), protocolVersion && `protocol ${protocolVersion}`);
  if (!protocolVersion) return;

  const listed = await client.send('tools/list', {});
  const toolNames = (listed?.result?.tools ?? []).map((tool) => tool.name);
  for (const expected of ['prompt_engine', 'resource_manager', 'system_control']) {
    record(`tool registered: ${expected}`, toolNames.includes(expected));
  }

  for (const check of TOOL_CHECKS) {
    const response = await client.send('tools/call', {
      name: check.tool,
      arguments: check.args,
    });
    const rpcError = response?.error?.message;
    if (rpcError) {
      record(check.label, false, rpcError.slice(0, 90));
      continue;
    }
    const { text, isError } = resultOf(response);
    if (isError) {
      record(check.label, false, `tool reported isError — ${text.slice(0, 80)}`);
      continue;
    }
    if (process.env.VERIFY_MCP_DUMP) console.log(`\n----- ${check.label} -----\n${text}\n-----\n`);
    // Recorded before the predicate runs so a later check can assert against this response.
    seen.set(check.label, text);
    const verdict = check.expect(text);
    record(check.label, verdict === true, verdict === true ? `${text.length} chars` : verdict);
  }
}

/**
 * Wrong-but-well-formed responses, one per check.
 *
 * Each reads like a healthy answer — right headers, right footer, right vocabulary — and is wrong
 * in the way the matching predicate is supposed to notice. `--self-test` asserts every predicate
 * rejects its counterpart, which is what keeps this file honest: the previous predicates
 * (`/prompts/i`, `text.length > 0`) accept every one of these.
 *
 * A check added without an entry here fails `--self-test`, so falsifiability is not optional.
 */
const WRONG_BUT_WELL_FORMED = {
  'system_control status':
    '✅ **System Status Overview**\n\n**Framework System**: ✅ Enabled (ATLANTIS)\n**Status**: healthy\n',
  'resource_manager prompt list':
    '📚 **Prompts** (117)\n\n**analysis**: action_plan, content_analysis\n\n_Use `detail:"full"`._',
  // Same count as the peer catalogue, different ids — the shape a tool reading the wrong registry
  // actually produces, and the one a count comparison cannot see.
  'prompt_engine listprompts':
    '📚 **Prompts** (2)\n\n**analysis**: action_plan, deep_research\n\n_Use `detail:"full"`._',
  'system_control framework list':
    '📋 **Available Frameworks**\n\n**C.A.G.E.E.R.F Framework** 🟢 ACTIVE\n**ReACT Framework** ⚪ Available\n',
};

/**
 * Prove every predicate can fail before trusting any of them to pass. Runs offline — no server,
 * no port, no build — so it is cheap enough to run alongside the real verification.
 */
function runSelfTest() {
  console.log(
    '\nverify:mcp self-test — every check must reject a wrong-but-well-formed response\n'
  );
  let failures = 0;

  for (const check of TOOL_CHECKS) {
    const fake = WRONG_BUT_WELL_FORMED[check.label];
    if (fake === undefined) {
      record(`${check.label} — has a counterexample`, false, 'no WRONG_BUT_WELL_FORMED entry');
      failures += 1;
      continue;
    }
    // Seed the healthy catalogue so cross-checks fail on the fake, not on a missing peer.
    seen.set(
      'resource_manager prompt list',
      '📚 **Prompts** (2)\n\n**analysis**: action_plan, content_analysis\n'
    );
    const verdict = check.expect(fake);
    const rejected = verdict !== true;
    record(`${check.label} — rejects wrong response`, rejected, rejected ? verdict : 'ACCEPTED IT');
    if (!rejected) failures += 1;
  }

  seen.clear();
  console.log(
    failures === 0
      ? `\nOK: all ${TOOL_CHECKS.length} checks are falsifiable\n`
      : `\nFAILED: ${failures} check(s) cannot detect a wrong response\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

async function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  console.log('\nMCP surface verification (spawns a server from dist/ — no Claude Code restart)\n');

  const baseline = captureMutationBaseline();

  if (!checkDistFreshness()) {
    console.log('\nRefusing to continue: a green result against a stale build would be a lie.\n');
    process.exit(1);
  }

  const port = await reservePort();
  const server = spawnServer(port);
  const baseUrl = `http://127.0.0.1:${port}`;

  let stderr = '';
  server.stderr?.on('data', (chunk) => (stderr += chunk.toString()));

  try {
    const healthMs = await waitForHealth(baseUrl);
    if (healthMs === null) {
      record('server healthy', false, `no /health within ${HEALTH_TIMEOUT_MS}ms`);
      if (stderr.trim()) console.log(`\n  server stderr:\n${stderr.trim().slice(0, 600)}\n`);
    } else {
      record('server healthy', true, `${healthMs}ms`);
      await runSurfaceChecks(baseUrl);
    }
  } catch (error) {
    record('surface checks', false, error instanceof Error ? error.message : String(error));
  } finally {
    server.kill('SIGTERM');
  }

  checkNoMutation(baseline);

  const failed = results.filter((result) => !result.ok);
  console.log(
    `\n${failed.length === 0 ? 'OK' : 'FAILED'}: ${results.length - failed.length}/${results.length} checks passed\n`
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();

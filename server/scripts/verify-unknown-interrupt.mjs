#!/usr/bin/env node
/**
 * Live drive for the mid-chain blocking-unknown interrupt (plan row 4.5).
 *
 * WHY A DRIVE AND NOT ONLY TESTS. This whole feature's parameters are dead on the wire until
 * three separate hops carry them, and `tsc` sees none of the three: the explicit argument
 * allowlist in `src/mcp/tools/index.ts`, `PromptExecutor`'s pipeline-request build, and
 * `McpToolRequest`. `remainder` was measured dead at TWO of them in one tier (plan rows 0.4 and
 * 2.3, DEV-T2-4) while the suite was green and every layer typechecked. A dropped argument looks
 * exactly like an ordinary resume, so only a real `tools/call` can tell them apart.
 *
 *   npm run build && node scripts/verify-unknown-interrupt.mjs
 *
 * What it drives, in one run of one chain:
 *   1. start `>>quick_decision` (a bundled 3-step chain)
 *   2. declare a BLOCKING unknown → `structuredContent.chain_interrupt` must come back
 *   3. submit a structured `remainder: {mode:'append'}` → the interrupt's own `remaining_nodes`
 *      must grow, which is the observable proof the parameter reached stage 16
 *   4. negative control: a remainder naming an unregistered prompt must come back as the NAMED
 *      IR refusal — an answer only stage 16 can produce (a dropped argument resumes silently)
 *   5. the row A.3 STRING spelling: `chain_id` + `--> >>investigate_unknown` must append too
 *   6. negative control: `chain_id` + `>>investigate_unknown` (no leading arrow) must still be
 *      rejected as two command sources
 *
 * Exits 0 when every check passes, 1 otherwise, and refuses to run at all against a `dist/`
 * older than `src/` — verifying a stale binary returns green for code that is not running.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, openSync, readdirSync, statSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(SERVER_ROOT, 'dist', 'index.js');
const WS = mkdtempSync(path.join(tmpdir(), 'unknown-interrupt-drive-'));

/** Newest mtime under a directory. Staleness must never be under-reported. */
function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const mtime = entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

function refuseStaleDist() {
  let distMtime;
  try {
    distMtime = statSync(DIST).mtimeMs;
  } catch {
    console.error(`✗ ${DIST} missing — run \`npm run build\` first`);
    process.exit(1);
  }
  const srcMtime = newestMtime(path.join(SERVER_ROOT, 'src'));
  if (srcMtime > distMtime) {
    const lagMin = Math.round((srcMtime - distMtime) / 60_000);
    console.error(`✗ dist/ is stale — src is ${lagMin} min newer. Run \`npm run build\` first.`);
    process.exit(1);
  }
  console.log(`✓ dist/ current — built ${new Date(distMtime).toISOString().slice(11, 19)}`);
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

function spawnServer(port) {
  const log = openSync(path.join(WS, `server-${port}.log`), 'w');
  const env = { ...process.env, PORT: String(port), MCP_WORKSPACE: SERVER_ROOT };
  // The server skips main() under JEST_WORKER_ID, and an inherited --experimental-vm-modules
  // leaks the parent's flags into a plain node process.
  delete env.NODE_OPTIONS;
  delete env.NODE_ENV;
  delete env.JEST_WORKER_ID;
  return spawn('node', [DIST, '--transport=streamable-http', '--quiet'], {
    env,
    stdio: ['ignore', log, log],
  });
}

async function waitHealth(base) {
  for (let i = 0; i < 800; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`no health at ${base}`);
}

function parseRpcBody(body) {
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data:')) {
      try {
        return JSON.parse(trimmed.slice(5));
      } catch {
        // keep scanning
      }
    }
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function client(base) {
  let sessionId = null;
  let nextId = 1;
  async function send(method, params) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (sessionId) headers['mcp-session-id'] = sessionId;
    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    });
    if (!sessionId) sessionId = response.headers.get('mcp-session-id');
    return parseRpcBody(await response.text());
  }
  async function init() {
    await send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'verify-unknown-interrupt', version: '1' },
    });
    await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
  }
  async function call(args) {
    const r = await send('tools/call', { name: 'prompt_engine', arguments: args });
    return {
      text: r?.result?.content?.[0]?.text ?? JSON.stringify(r),
      structured: r?.result?.structuredContent ?? null,
      isError: r?.result?.isError === true,
      // A schema refusal never reaches the tool, so it arrives as a JSON-RPC error, not a result.
      rpcError: r?.error?.message ?? null,
    };
  }
  return { init, call };
}

const failures = [];
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
}

const UNKNOWN_ONE = 'live-drive-ttl';
const UNKNOWN_TWO = 'live-drive-shape';

refuseStaleDist();

const port = await reservePort();
const server = spawnServer(port);
try {
  const base = `http://127.0.0.1:${port}`;
  await waitHealth(base);
  const mcp = client(base);
  await mcp.init();

  const start = await mcp.call({ command: '>>quick_decision topic="cache invalidation"' });
  const chainId = (start.text.match(/chain_id="(chain-[^"]+)"/) || [])[1];
  check(
    'a chain run starts',
    Boolean(chainId) && !start.isError,
    chainId ?? start.text.slice(0, 120)
  );
  if (!chainId) throw new Error('no chain id — later checks would be vacuous');

  // ---- the interrupt reaches the caller ---------------------------------------------------
  const blocked = await mcp.call({
    chain_id: chainId,
    observations: [
      {
        type: 'unknown_discovered',
        id: UNKNOWN_ONE,
        statement: 'the cache TTL is undecided',
        blocking: true,
      },
    ],
  });
  const interrupt = blocked.structured?.chain_interrupt;
  check(
    'a blocking unknown returns structuredContent.chain_interrupt',
    interrupt?.kind === 'chain_interrupt' &&
      interrupt?.reason === 'blocking_unknown' &&
      interrupt?.unknown?.id === UNKNOWN_ONE,
    interrupt ? `remaining=${interrupt.remaining_nodes?.length}` : blocked.text.slice(0, 140)
  );
  check(
    'the interrupt names the exits a soft-interrupted run accepts',
    Array.isArray(interrupt?.resume?.verbs) && interrupt.resume.verbs.includes('remainder'),
    JSON.stringify(interrupt?.resume?.verbs)
  );
  const remainingBefore = interrupt?.remaining_nodes?.length ?? 0;

  // ---- the structured spelling of an append ------------------------------------------------
  const appended = await mcp.call({
    chain_id: chainId,
    remainder: { mode: 'append', nodes: [{ id: 'verify-fix', promptId: 'investigate_unknown' }] },
  });
  const afterAppend = appended.structured?.chain_interrupt;
  check(
    'a structured remainder is APPLIED, not silently dropped',
    !appended.isError && (afterAppend?.remaining_nodes?.length ?? 0) === remainingBefore + 1,
    `remaining ${remainingBefore} → ${afterAppend?.remaining_nodes?.length}`
  );

  // ---- negative control: only stage 16 can produce this answer ------------------------------
  const bogus = await mcp.call({
    chain_id: chainId,
    remainder: { mode: 'append', nodes: [{ id: 'nope', promptId: 'no_such_prompt_at_all' }] },
  });
  check(
    'a remainder naming an unregistered prompt is refused BY NAME',
    bogus.isError && /unknown-prompt/.test(bogus.text),
    bogus.text.slice(0, 120).replace(/\n/g, ' ')
  );

  // ---- row A.3: the string spelling ---------------------------------------------------------
  // A second unknown, because one accepted remainder per unknown id is the declared cap — the
  // string append must be held to it, so it needs its own.
  const blockedAgain = await mcp.call({
    chain_id: chainId,
    observations: [
      {
        type: 'unknown_discovered',
        id: UNKNOWN_TWO,
        statement: 'the rest of the plan may be the wrong shape',
        blocking: true,
      },
    ],
  });
  const beforeStringAppend = blockedAgain.structured?.chain_interrupt?.remaining_nodes?.length ?? 0;

  const stringAppend = await mcp.call({
    chain_id: chainId,
    command: '--> >>investigate_unknown',
  });
  const afterStringAppend = stringAppend.structured?.chain_interrupt;
  check(
    'a leading `-->` command with chain_id appends through the SAME path (row A.3)',
    !stringAppend.isError &&
      (afterStringAppend?.remaining_nodes?.length ?? 0) === beforeStringAppend + 1,
    `remaining ${beforeStringAppend} → ${afterStringAppend?.remaining_nodes?.length}`
  );

  // ---- negative control: the exclusivity lift is scoped to the leading arrow -----------------
  const notAnAppend = await mcp.call({
    chain_id: chainId,
    command: '>>investigate_unknown',
  });
  check(
    'chain_id + a non-append command is still rejected as two command sources',
    notAnAppend.isError || notAnAppend.rpcError !== null,
    (notAnAppend.rpcError ?? notAnAppend.text).slice(0, 120).replace(/\n/g, ' ')
  );
} finally {
  server.kill();
}

if (failures.length > 0) {
  console.error(
    `\n${failures.length} unknown-interrupt check(s) failed: ${failures.join(', ')}\nserver log: ${WS}`
  );
  process.exit(1);
}
console.log('\nunknown-interrupt live drive: all checks passed');

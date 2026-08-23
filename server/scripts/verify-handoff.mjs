#!/usr/bin/env node
/**
 * Live drive for cross-client chain handoff (plan 2A): two servers from dist/, one shared
 * workspace, mint in A → claim in B → spent/bogus/chain-less refusals.
 *
 * WHY A DRIVE AND NOT ONLY A UNIT TEST: the first implementation typechecked at every layer,
 * passed 2727 unit tests, and was dead on the wire — `handoff`/`claim_token` were missing from
 * the explicit argument allowlist in `src/mcp/tools/index.ts`. Only a real tools/call showed it
 * (fourth instance of that allowlist failure shape). Run after `npm run build`:
 *
 *   node scripts/verify-handoff.mjs
 *
 * Servers start SEQUENTIALLY on purpose: two fresh processes initializing the same empty
 * state.db at the same instant fail with "database is locked" (measured 2026-08-21; separate
 * finding, plan 2A notes). Exit 1 when any step fails, so it can gate.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');
const WS = mkdtempSync(path.join(tmpdir(), 'handoff-drive-'));
const PORT_A = 47311;
const PORT_B = 47312;

function spawnServer(port) {
  const log = openSync(path.join(WS, `server-${port}.log`), 'w');
  const env = { ...process.env, PORT: String(port), MCP_WORKSPACE: WS };
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
      clientInfo: { name: 'verify-handoff', version: '1' },
    });
    await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    });
  }
  async function call(args) {
    const r = await send('tools/call', {
      name: 'prompt_engine',
      arguments: args,
    });
    return {
      text: r?.result?.content?.[0]?.text ?? JSON.stringify(r),
      isError: r?.result?.isError === true,
    };
  }
  return { init, call };
}

const failures = [];
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
}

const serverA = spawnServer(PORT_A);
let serverB;
try {
  await waitHealth(`http://127.0.0.1:${PORT_A}`);
  serverB = spawnServer(PORT_B);
  await waitHealth(`http://127.0.0.1:${PORT_B}`);
  const a = client(`http://127.0.0.1:${PORT_A}`);
  const b = client(`http://127.0.0.1:${PORT_B}`);
  await a.init();
  await b.init();

  const start = await a.call({
    command: '>>strategicImplement task:"handoff live drive"',
  });
  const chainId = (start.text.match(/chain_id="(chain-[^"]+)"/) || [])[1];
  check('A starts a run', Boolean(chainId) && !start.isError, chainId);

  const mint = await a.call({ chain_id: chainId, handoff: true });
  const token = (mint.text.match(/hnd_[A-Za-z0-9_-]+/) || [])[0];
  check(
    'A mints a token',
    Boolean(token) && !mint.isError,
    token ? `${token.slice(0, 12)}…` : mint.text.slice(0, 120)
  );

  const claim = await b.call({ claim_token: token });
  check(
    'B claims and receives the current step',
    !claim.isError && claim.text.length > 0,
    claim.text.slice(0, 80).replace(/\n/g, ' ')
  );

  const again = await b.call({ claim_token: token });
  check('a spent token is refused', again.isError && /Claim Refused/.test(again.text));

  const bogus = await b.call({ claim_token: 'hnd_never-minted' });
  check('an unknown token is refused', bogus.isError && /Claim Refused/.test(bogus.text));

  const noId = await a.call({ handoff: true });
  check(
    'handoff without chain_id is refused',
    noId.isError && /requires `chain_id`/.test(noId.text)
  );
} finally {
  serverA.kill();
  serverB?.kill();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} handoff check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nhandoff live drive: all checks passed');

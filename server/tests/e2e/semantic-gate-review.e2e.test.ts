// @lifecycle test - Source SDK-registered STDIO/HTTP metadata roundtrips while semantic criteria stay off.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from '@jest/globals';

import { buildServerEnv } from '../../scripts/lib/hermetic-server-env.js';
import { parseYamlOrThrow } from '../../src/shared/utils/yaml/yaml-parser.js';
import { createHermeticRoots } from './helpers/child-env.js';
import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  MODERN_META_KEYS,
  MODERN_PROTOCOL_VERSION,
  parseJsonOrSse,
  startServerWithHttp,
  waitForHealth,
} from './helpers/http-mcp-client.js';

const SERVER_ROOT = fileURLToPath(new URL('../../', import.meta.url));
interface RpcReply {
  result?: unknown;
  error?: unknown;
}
interface ToolReply {
  content: Array<{ text?: string }>;
  isError?: boolean;
}
type Request = (method: string, params: Record<string, unknown>) => Promise<RpcReply>;
type Cleanup = Array<() => void | Promise<void>>;

// Real protocol/wire fixtures, not official SDK clients. The server uses actual SDK registration.
// The STDIO framing follows delegated-review-client-parity's pinned-connection sibling pattern.
function sourceStdio(env: Record<string, string>, cleanup: Cleanup): Request {
  const proc = spawn(
    'node',
    [
      '--import',
      'tsx',
      path.join(SERVER_ROOT, 'src/index.ts'),
      `--server-root=${SERVER_ROOT}`,
      '--transport=stdio',
      '--quiet',
    ],
    { cwd: SERVER_ROOT, env: buildServerEnv(env), stdio: ['pipe', 'pipe', 'pipe'] }
  );
  cleanup.push(() => killServer(proc));
  let id = 0;
  let buffer = '';
  let stderr = '';
  const pending = new Map<
    number,
    {
      resolve: (reply: RpcReply) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  proc.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-8192);
  });
  proc.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      let message: RpcReply & { id?: number };
      try {
        message = JSON.parse(line) as RpcReply & { id?: number };
      } catch {
        continue;
      }
      if (message.id === undefined) continue;
      const waiting = pending.get(message.id);
      if (waiting === undefined) continue;
      clearTimeout(waiting.timer);
      pending.delete(message.id);
      waiting.resolve(message);
    }
  });
  const rejectPending = (error: Error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };
  proc.on('error', rejectPending);
  proc.on('exit', (code) => rejectPending(new Error(`STDIO exited ${code}: ${stderr}`)));
  return async (method, params) => {
    const requestId = ++id;
    return await new Promise<RpcReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`STDIO request ${requestId} timed out: ${stderr}`));
      }, 30000);
      pending.set(requestId, { resolve, reject, timer });
      proc.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: requestId,
          method,
          params: {
            ...params,
            _meta: {
              [MODERN_META_KEYS.clientInfo]: { name: 'opaque-gate-wire-fixture', version: '1.0.0' },
              [MODERN_META_KEYS.clientCapabilities]: {},
              [MODERN_META_KEYS.protocolVersion]: MODERN_PROTOCOL_VERSION,
            },
          },
        }) + '\n'
      );
    });
  };
}

async function sourceHttp(env: Record<string, string>, cleanup: Cleanup): Promise<Request> {
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const proc = startServerWithHttp(port, { source: true, env });
  cleanup.push(() => killServer(proc));
  await waitForHealth(baseUrl, { timeout: 30000 });
  const client = new ModernMcpClient(baseUrl, 'opaque-gate-wire-fixture');
  let id = 0;
  return async (method, params) => {
    const requestId = ++id;
    const response = await client.send(method, params, requestId, {
      ...(typeof params['name'] === 'string' ? { toolName: params['name'] } : {}),
    });
    expect(response.status).toBe(200);
    return parseJsonOrSse(response.body, requestId);
  };
}

const textOf = (reply: ToolReply): string =>
  reply.content.map((part) => part.text ?? '').join('\n');

// Create/update validation is canonical; no standalone gate validate API is invented here.
describe('registered source STDIO/HTTP: opaque metadata and staged semantic refusal', () => {
  const cleanup: Cleanup = [];
  afterEach(async () => {
    for (const dispose of cleanup.splice(0).reverse()) await dispose();
  });

  test.each(['stdio', 'http'] as const)(
    '%s publishes and roundtrips opaque metadata while semantic_evaluation remains refused',
    async (transport) => {
      const roots = createHermeticRoots(`opaque-gate-${transport}`);
      const workspace = path.join(roots.root, 'workspace');
      mkdirSync(workspace);
      cleanup.push(roots.cleanup);
      const env = { ...roots.env, MCP_WORKSPACE: workspace };
      const request =
        transport === 'stdio' ? sourceStdio(env, cleanup) : await sourceHttp(env, cleanup);
      const listing = await request('tools/list', {});
      expect(listing.error).toBeUndefined();
      const tools = listing.result as {
        tools: Array<{
          name: string;
          inputSchema: { properties?: Record<string, { type?: string }>; required?: string[] };
        }>;
      };
      const resourceSchema = tools.tools.find(
        (tool) => tool.name === 'resource_manager'
      )?.inputSchema;
      expect(resourceSchema?.properties?.['calibration_suite_id']?.type).toBe('string');
      expect(resourceSchema?.required ?? []).not.toContain('calibration_suite_id');

      const call = async (args: Record<string, unknown>): Promise<ToolReply> => {
        const envelope = await request('tools/call', { name: 'resource_manager', arguments: args });
        expect(envelope.error).toBeUndefined();
        const reply = envelope.result as ToolReply;
        expect(reply.isError).not.toBe(true);
        return reply;
      };
      const base = {
        resource_type: 'gate',
        action: 'create',
        name: 'Opaque metadata control',
        description: 'Registration capability control',
        guidance: 'Review output.',
        pass_criteria: [{ type: 'inline_guidance' }],
      };
      const id = 'opaque-metadata-control';
      const gateFile = path.join(workspace, 'resources/gates', id, 'gate.yaml');
      const disk = () => parseYamlOrThrow<Record<string, unknown>>(readFileSync(gateFile, 'utf8'));
      const inspect = async (value: string) => {
        const response = await call({ resource_type: 'gate', action: 'inspect', id });
        const line = textOf(response)
          .split('\n')
          .find((entry) => entry.startsWith('  - Calibration Suite ID: '));
        expect(line).toBe(`  - Calibration Suite ID: ${JSON.stringify(value)}`);
        expect(JSON.parse(line!.slice('  - Calibration Suite ID: '.length))).toBe(value);
        expect(disk()['calibration_suite_id']).toBe(value);
        expect(disk()['pass_criteria']).toEqual(base.pass_criteria);
      };
      const original = '  suite:opaque/../unresolved.json #association  ';
      await call({ ...base, id, calibration_suite_id: original });
      await inspect(original);
      const replacement = '  Ω\nidentifier\t  ';
      await call({
        resource_type: 'gate',
        action: 'update',
        id,
        calibration_suite_id: replacement,
      });
      await inspect(replacement);
      await call({
        resource_type: 'gate',
        action: 'update',
        id,
        description: 'Changed ordinary metadata',
      });
      await inspect(replacement);
      expect(disk()['description']).toBe('Changed ordinary metadata');

      // Ordinary absent-field positive control, independent of the association-bearing gate.
      await call({ ...base, id: 'ordinary-control' });
      const ordinary = await call({
        resource_type: 'gate',
        action: 'inspect',
        id: 'ordinary-control',
      });
      expect(textOf(ordinary)).toContain('ID: ordinary-control');
      expect(textOf(ordinary)).not.toContain('Calibration Suite ID:');
      const ordinaryFile = path.join(workspace, 'resources/gates/ordinary-control/gate.yaml');
      expect(
        parseYamlOrThrow<Record<string, unknown>>(readFileSync(ordinaryFile, 'utf8'))
      ).not.toHaveProperty('calibration_suite_id');

      const refused = await request('tools/call', {
        name: 'resource_manager',
        arguments: {
          ...base,
          id: 'unsupported-semantic-gate',
          calibration_suite_id: replacement,
          pass_criteria: [
            {
              type: 'semantic_evaluation',
              id: 'criterion',
              target: { kind: 'step_output' },
              question: 'Is the contract preserved?',
              evidence_requirements: { min_items: 1 },
              result: { kind: 'boolean' },
              acceptance: { kind: 'equals', value: true },
              allow_not_applicable: false,
            },
          ],
        },
      });
      expect(
        refused.error !== undefined || (refused.result as ToolReply | undefined)?.isError === true
      ).toBe(true);
      expect(JSON.stringify(refused)).toMatch(/pass_criteria|inline_guidance|Invalid option/);
      expect(existsSync(path.join(workspace, 'resources/gates/unsupported-semantic-gate'))).toBe(
        false
      );
      await inspect(replacement);
    },
    90000
  );
});

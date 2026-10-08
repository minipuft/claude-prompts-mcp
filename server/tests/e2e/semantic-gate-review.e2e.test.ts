// @lifecycle test - Built registered STDIO/HTTP semantic authoring and opaque metadata roundtrips.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from '@jest/globals';

import { parseYamlOrThrow } from '../../src/shared/utils/yaml/yaml-parser.js';
import { buildServerEnv, createHermeticRoots } from './helpers/child-env.js';
import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
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
async function builtStdio(env: Record<string, string>, cleanup: Cleanup): Promise<Request> {
  const proc = spawn(
    'node',
    [
      path.join(SERVER_ROOT, 'dist/index.js'),
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
  const request: Request = async (method, params) => {
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
          params,
        }) + '\n'
      );
    });
  };
  const initialized = await request('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'semantic-built-stdio', version: '1' },
  });
  expect(initialized.error).toBeUndefined();
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  return request;
}

async function builtHttp(env: Record<string, string>, cleanup: Cleanup): Promise<Request> {
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const proc = startServerWithHttp(port, { env });
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
describe('registered built STDIO/HTTP: opaque metadata and canonical semantic authoring', () => {
  const cleanup: Cleanup = [];
  afterEach(async () => {
    for (const dispose of cleanup.splice(0).reverse()) await dispose();
  });

  test.each(['stdio', 'http'] as const)(
    '%s publishes and roundtrips canonical semantic definitions with malformed negatives',
    async (transport) => {
      const roots = createHermeticRoots(`opaque-gate-${transport}`);
      const workspace = path.join(roots.root, 'workspace');
      mkdirSync(workspace);
      cleanup.push(roots.cleanup);
      const env = { ...roots.env, MCP_WORKSPACE: workspace };
      const request =
        transport === 'stdio' ? await builtStdio(env, cleanup) : await builtHttp(env, cleanup);
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

      const accepted = await request('tools/call', {
        name: 'resource_manager',
        arguments: {
          ...base,
          id: 'supported-semantic-gate',
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
      expect(accepted.error).toBeUndefined();
      expect((accepted.result as ToolReply).isError).not.toBe(true);
      const semantic = await call({
        resource_type: 'gate',
        action: 'inspect',
        id: 'supported-semantic-gate',
      });
      expect(textOf(semantic)).toContain('semantic_evaluation');
      expect(textOf(semantic)).toContain('Is the contract preserved?');
      const semanticFile = path.join(
        workspace,
        'resources/gates/supported-semantic-gate/gate.yaml'
      );
      const definition = parseYamlOrThrow<Record<string, unknown>>(
        readFileSync(semanticFile, 'utf8')
      );
      const criterion = (definition['pass_criteria'] as Array<Record<string, unknown>>)[0]!;
      expect(criterion['target']).toEqual({ kind: 'step_output' });
      expect(definition['calibration_suite_id']).toBe(replacement);
      for (const target of [{ kind: 'unknown' }, { kind: 'artifact', id: '' }]) {
        const refused = await request('tools/call', {
          name: 'resource_manager',
          arguments: {
            ...base,
            id: 'malformed-semantic-gate',
            pass_criteria: [{ ...criterion, target }],
          },
        });
        expect(
          refused.error !== undefined || (refused.result as ToolReply | undefined)?.isError === true
        ).toBe(true);
        expect(JSON.stringify(refused)).toContain('target');
        expect(existsSync(path.join(workspace, 'resources/gates/malformed-semantic-gate'))).toBe(
          false
        );
      }
      await call({
        ...base,
        id: 'artifact-declaration',
        pass_criteria: [{ ...criterion, target: { kind: 'artifact', id: '../opaque-reference' } }],
      });
      expect(
        textOf(await call({ resource_type: 'gate', action: 'inspect', id: 'artifact-declaration' }))
      ).toContain('../opaque-reference');
      expect(existsSync(path.join(workspace, 'opaque-reference'))).toBe(false);
      await inspect(replacement);
    },
    90000
  );
});

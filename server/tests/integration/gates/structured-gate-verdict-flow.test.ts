// @lifecycle test - Registered STDIO/HTTP custody of ordinary verdicts and staged report carriers.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, test } from '@jest/globals';

import { buildServerEnv, createHermeticRoots } from '../../../scripts/lib/hermetic-server-env.js';
import { hashBytes } from '../../../src/shared/utils/hash.js';
import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  PROJECT_ROOT,
  startServerWithHttp,
  waitForHealth,
} from '../../e2e/helpers/http-mcp-client.js';

import type { GateVerdictSummary } from '../../../src/shared/types/chain-execution.js';
import type { SemanticEvaluationReport } from '../../../src/shared/types/gate-evaluation.js';

const SERVER_ROOT = path.join(PROJECT_ROOT, 'server');
const GATE = 'registered-custody-check';
const OUTPUT = 'A😀e\u0301 Z';

interface ToolReply {
  text: string;
  isError: boolean;
}
class RpcRefusal extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
  }
}
function toolReply(value: unknown): ToolReply {
  if (typeof value !== 'object' || value === null) throw new Error('No MCP tool result');
  const result = value as { content?: Array<{ text?: string }>; isError?: boolean };
  return {
    text: (result.content ?? []).map((part) => part.text ?? '').join('\n'),
    isError: result.isError === true,
  };
}

/** Real newline-delimited JSON-RPC, including the initialize/initialized exchange. */
class SourceStdioClient {
  private readonly proc: ChildProcess;
  private nextId = 1;
  private buffered = '';
  private stderr = '';
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(env: NodeJS.ProcessEnv) {
    this.proc = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        path.join(SERVER_ROOT, 'src/index.ts'),
        `--server-root=${SERVER_ROOT}`,
        '--transport=stdio',
        '--quiet',
      ],
      { cwd: SERVER_ROOT, env, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    this.proc.stderr?.on('data', (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-4000);
    });
    this.proc.stdout?.on('data', (chunk: Buffer) => {
      this.buffered += chunk.toString();
      let boundary: number;
      while ((boundary = this.buffered.indexOf('\n')) >= 0) {
        const line = this.buffered.slice(0, boundary);
        this.buffered = this.buffered.slice(boundary + 1);
        let message: { id?: number; result?: unknown; error?: { code: number; message: string } };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === undefined) continue;
        const waiter = this.pending.get(message.id);
        if (waiter === undefined) continue;
        this.pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error !== undefined)
          waiter.reject(new RpcRefusal(message.error.code, message.error.message));
        else waiter.resolve(message.result);
      }
    });
    this.proc.on('error', (error) => this.rejectPending(error));
    this.proc.on('exit', () =>
      this.rejectPending(new Error(`Source STDIO exited: ${this.stderr}`))
    );
  }
  private rejectPending(error: Error): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
  }
  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`STDIO ${method} timed out: ${this.stderr}`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'registered-custody-stdio', version: '1' },
    });
    this.proc.stdin?.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
    );
  }
  close(): Promise<void> {
    return killServer(this.proc);
  }
}

type Call = (name: string, args: Record<string, unknown>) => Promise<ToolReply>;
describe.each(['stdio', 'http'] as const)(
  'registered %s source host: staged report custody',
  (transport) => {
    const cleanup: Array<() => void | Promise<void>> = [];
    afterEach(async () => {
      for (const dispose of cleanup.splice(0).reverse()) await dispose();
    });

    async function fixture(): Promise<{ call: Call; chainId: string; runtimeRoot: string }> {
      const roots = createHermeticRoots(`registered-custody-${transport}`);
      const workspace = path.join(roots.root, 'workspace');
      mkdirSync(workspace);
      cleanup.push(roots.cleanup);
      const overrides = {
        ...roots.env,
        MCP_WORKSPACE: workspace,
        MCP_SHELL_VERIFY_ALLOWLIST: `${process.execPath} *`,
      };
      let call: Call;
      if (transport === 'stdio') {
        const client = new SourceStdioClient(buildServerEnv(overrides));
        cleanup.push(() => client.close());
        await client.initialize();
        call = async (name, args) => {
          try {
            return toolReply(await client.request('tools/call', { name, arguments: args }));
          } catch (error) {
            if (error instanceof RpcRefusal)
              return { text: `RPC ${error.code}: ${error.message}`, isError: true };
            throw error;
          }
        };
      } else {
        const port = await getAvailablePort();
        const baseUrl = `http://127.0.0.1:${port}`;
        const proc = startServerWithHttp(port, { source: true, env: overrides });
        cleanup.push(() => killServer(proc));
        await waitForHealth(baseUrl, { timeout: 30000 });
        const client = new ModernMcpClient(baseUrl, 'registered-custody-http');
        let id = 1;
        call = async (name, args) =>
          toolReply(
            await client.request('tools/call', { name, arguments: args }, id++, { toolName: name })
          );
      }
      expect(
        (await call('system_control', { action: 'framework', operation: 'disable' })).isError
      ).toBe(false);
      const gate = await call('resource_manager', {
        resource_type: 'gate',
        action: 'create',
        id: GATE,
        name: GATE,
        description: 'Ordinary failing tool check used only as a report carrier',
        guidance: 'Review the captured output.',
        enforcement_mode: 'blocking',
        pass_criteria: [
          { type: 'shell_verify', shell_command: [process.execPath, '-e', 'process.exit(1)'] },
        ],
      });
      expect(gate.isError).toBe(false);
      const prompt = await call('resource_manager', {
        resource_type: 'prompt',
        action: 'create',
        id: 'registered_custody',
        name: 'Registered custody',
        category: 'general',
        description: 'Hermetic ordinary review',
        user_message_template: 'REGISTERED-CUSTODY-OUTPUT',
        gate_configuration: { exclude: ['content-structure'], framework_gates: false },
      });
      expect(prompt.isError).toBe(false);
      const started = await call('prompt_engine', {
        command: '>>registered_custody',
        gates: [GATE],
      });
      expect(started.isError).toBe(false);
      const chainId = /chain_id="(chain-[A-Za-z0-9_#-]+)"/.exec(started.text)?.[1];
      if (chainId === undefined) throw new Error(`No registered chain id: ${started.text}`);
      return { call, chainId, runtimeRoot: roots.runtimeRoot };
    }
    function captured(runtimeRoot: string, chainId: string): GateVerdictSummary[] {
      const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state/state.db'), {
        readOnly: true,
      });
      try {
        const rows = db
          .prepare(
            'SELECT gate_verdicts_json FROM execution_records WHERE chain_id = ? ORDER BY started_at'
          )
          .all(chainId) as unknown as Array<{ gate_verdicts_json: string }>;
        return rows.flatMap((row) => JSON.parse(row.gate_verdicts_json) as GateVerdictSummary[]);
      } finally {
        db.close();
      }
    }

    test('rich carrier survives actual registration, capture and persisted history', async () => {
      const { call, chainId, runtimeRoot } = await fixture();
      expect(captured(runtimeRoot, chainId)).toEqual([]);
      const targetDigest = hashBytes(OUTPUT);
      // Client claims for a staged carrier, not server-issued authority or semantic acceptance.
      const evaluation: SemanticEvaluationReport = {
        binding: {
          gate_id: GATE,
          node_id: 'fixture-node',
          attempt_id: 'fixture-attempt',
          definition_digest: hashBytes('ordinary carrier definition'),
          target_digest: targetDigest,
        },
        observations: [
          {
            criterion_id: 'carrier-observation',
            state: 'unmet',
            value: false,
            evidence: [{ target_digest: targetDigest, start: 1, end: 5, quote: '😀e\u0301' }],
            rationale: 'Unicode citation retained.\nMultiline report rationale.',
          },
        ],
        reviewer: {
          provenance: 'client_reported',
          provider: ' claimed-provider ',
          model: 'claimed-model',
          revision: 'claimed-revision',
          context: 'isolated_judge',
        },
      };
      const reply = await call('prompt_engine', {
        chain_id: chainId,
        user_response: OUTPUT,
        gate_verdict: {
          overall: 'FAIL',
          rationale: 'Carrier review failed',
          per_gate: [{ index: 1, passed: false, rationale: 'Carrier criterion unmet', evaluation }],
        },
      });
      expect(reply.isError).toBe(false);
      const entries = captured(runtimeRoot, chainId);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        gateId: GATE,
        verdict: 'FAIL',
        rationale: 'Carrier criterion unmet',
      });
      expect(entries[0]?.evaluation).toEqual(evaluation);
      const history = await call('system_control', {
        action: 'execution_history',
        operation: 'steps',
        session_id: chainId,
      });
      expect(history.isError).toBe(false);
      expect(history.text).toContain(GATE);
      expect(history.text).toContain('Carrier criterion unmet');
      // Public rich history rendering is later; exact JSON above observes actual persistence.
    }, 90000);

    test('legacy string control reaches the same registered capture path', async () => {
      const { call, chainId, runtimeRoot } = await fixture();
      const reply = await call('prompt_engine', {
        chain_id: chainId,
        user_response: OUTPUT,
        gate_verdict:
          'GATE_REVIEW: FAIL - Legacy carrier\n\nGATE_VERDICTS:\n[1] FAIL - Legacy criterion',
      });
      expect(reply.isError).toBe(false);
      const entries = captured(runtimeRoot, chainId);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        gateId: GATE,
        verdict: 'FAIL',
        rationale: 'Legacy criterion',
      });
      expect(entries[0]).not.toHaveProperty('evaluation');
    }, 90000);
  }
);

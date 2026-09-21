/**
 * A failure while building ONE request's server must fail that request, say why,
 * and leave later requests able to succeed.
 *
 * Streamable HTTP builds a fresh `McpServer` per request from the factory, and the
 * SDK answers a request whose factory threw with `-32603 Internal server error`,
 * reporting the cause through the handler's `onerror` and nowhere else. No
 * `onerror` was passed, so the cause was reported by nothing unless the failing
 * stage happened to log for itself: measured against a built server, three
 * consecutive requests failed with that opaque body and no log line named the
 * cause.
 *
 * The isolation half is asserted alongside it because the fix must not buy
 * reporting with a degraded surface — the tempting shape here is to catch the
 * build failure and return a server missing the tools that failed to bind, which
 * every client reads as success.
 */

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/server';
import express from 'express';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';

import { createTransportRouter } from '../../../src/infra/http/transport/index.js';

import type { Logger } from '../../../src/shared/types/index.js';
import type { McpServerFactory } from '@modelcontextprotocol/server';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

/** A server shell with one tool, standing in for a fully bound serving unit. */
function buildServingUnit(): McpServer {
  const server = new McpServer(
    { name: 'isolation-test', version: '1.0.0' },
    { capabilities: { tools: { listChanged: true } } }
  );
  server.registerTool(
    'prompt_engine',
    { title: 'Prompt Engine', description: 'test', inputSchema: { command: z.string() } },
    async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })
  );
  return server;
}

function post(port: number, body: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let out = '';
        res.on('data', (c) => (out += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: out }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'isolation-test', version: '1.0.0' },
  },
};

const toolsList = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };

let listening: http.Server | undefined;

async function serve(factory: McpServerFactory, logger: Logger): Promise<number> {
  const app = express();
  app.use(express.json());
  const router = createTransportRouter(logger, factory, factory, 'streamable-http');
  router.setupStreamableHttpTransport(app);
  listening = app.listen(0);
  await new Promise((resolve) => listening!.once('listening', resolve));
  return (listening!.address() as AddressInfo).port;
}

afterEach(async () => {
  if (listening) {
    await new Promise((resolve) => listening!.close(() => resolve(undefined)));
    listening = undefined;
  }
});

describe('Streamable HTTP per-request server build failures', () => {
  test('a build failure is reported with the cause, not swallowed', async () => {
    const logger = createLogger();
    const factory: McpServerFactory = async () => {
      throw new Error('gate state unavailable');
    };

    const port = await serve(factory, logger);
    const response = await post(port, initialize);

    // The request fails. A degraded-but-answering surface would be worse.
    expect(response.status).toBe(500);

    // The cause reaches the operator. Without the handler's `onerror` this was
    // reported by nothing at all, which is the defect.
    const reported = (logger.error as jest.Mock).mock.calls
      .map((args) => args.map((a) => String(a)).join(' '))
      .join('\n');
    expect(reported).toContain('gate state unavailable');
  });

  test('a later request succeeds after an earlier request failed to build', async () => {
    const logger = createLogger();
    let calls = 0;
    const factory: McpServerFactory = async () => {
      calls += 1;
      if (calls === 1) throw new Error('gate state unavailable');
      return buildServingUnit();
    };

    const port = await serve(factory, logger);

    const first = await post(port, initialize);
    expect(first.status).toBe(500);

    // Positive control: the same server, the next request, built from a factory
    // that now succeeds. Without this the first assertion alone would pass
    // against a transport that fails every request.
    const second = await post(port, toolsList);
    expect(second.status).toBe(200);
    expect(second.body).toContain('prompt_engine');
  });
});

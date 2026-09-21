// @lifecycle test - P4.95: the shared HTTP test client can observe a notification.
/**
 * The stream reader in `helpers/http-mcp-client.ts`, driven against a planted response.
 *
 * The subject here is the CLIENT, not the server, so the notifications are planted: a local HTTP
 * server returns a canned `text/event-stream` body carrying a notification before the answer and
 * another after it. A real MCP server cannot be asked to emit a chosen event on demand, and this
 * file's claim is not "the server emits" — `http-notification-delivery.e2e.test.ts` owns that.
 * The claim is that a client built on these helpers does not silently drop what arrives.
 *
 * That silent drop is the measured defect (P4.88 findings): `parseJsonOrSse` returns the first
 * message whose id matches and discards the rest of the stream, so every client method built on
 * it — `StreamableHttpMcpClient.request`, `ModernMcpClient.request` — could not see a
 * notification even when one was delivered on the very response it read.
 */

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import http from 'node:http';

import {
  allStreamMessages,
  notificationsOf,
  parseJsonOrSse,
  StreamableHttpMcpClient,
} from './helpers/http-mcp-client.js';

/** An SSE body shaped like this server's: notification, answer, notification. */
const PLANTED_BODY = [
  'event: message',
  `data: ${JSON.stringify({
    jsonrpc: '2.0',
    method: 'notifications/gate/response_blocked',
    params: { gateIds: ['planted-gate'], chainId: 'planted-chain' },
  })}`,
  '',
  'event: message',
  `data: ${JSON.stringify({
    jsonrpc: '2.0',
    id: 7,
    result: { content: [{ type: 'text', text: 'PLANTED ANSWER' }], isError: false },
  })}`,
  '',
  'event: message',
  `data: ${JSON.stringify({
    jsonrpc: '2.0',
    method: 'notifications/chain/complete',
    params: { chainId: 'planted-chain' },
  })}`,
  '',
].join('\n');

describe('the shared HTTP client keeps every message on a response stream', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(PLANTED_BODY);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('planted server has no port');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('requestWithNotifications returns the answer AND both notifications', async () => {
    const client = new StreamableHttpMcpClient(baseUrl);
    const outcome = await client.requestWithNotifications(
      'tools/call',
      { name: 'prompt_engine', arguments: {} },
      7
    );

    // The answer is still the answer — the additive method did not cost the old return.
    expect((outcome.result as { content: Array<{ text: string }> }).content[0]?.text).toBe(
      'PLANTED ANSWER'
    );
    expect(outcome.notifications.map((n) => n.method)).toEqual([
      'notifications/gate/response_blocked',
      'notifications/chain/complete',
    ]);
    // Names WHICH gate, so a params field dropped from the reader is a failure here.
    expect(outcome.notifications[0]?.params['gateIds']).toEqual(['planted-gate']);
  });

  test('the reader keeps stream order and separates answers from notifications', () => {
    expect(allStreamMessages(PLANTED_BODY).map((m) => m.id ?? m.method)).toEqual([
      'notifications/gate/response_blocked',
      7,
      'notifications/chain/complete',
    ]);
    expect(notificationsOf(PLANTED_BODY)).toHaveLength(2);
  });

  test('the first-match reader beside it still drops them — the control for why both exist', () => {
    // NOT an aspiration: this is the shape every existing caller still gets, asserted so that a
    // future change to `parseJsonOrSse` cannot quietly make the two readers the same function.
    const parsed = parseJsonOrSse(PLANTED_BODY, 7) as { result?: unknown };
    expect(parsed.result).toBeDefined();
    expect(Object.keys(parsed)).not.toContain('method');
  });
});

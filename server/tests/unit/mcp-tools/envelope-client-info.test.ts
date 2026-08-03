import { describe, expect, test } from '@jest/globals';

import { readEnvelopeClientInfo } from '../../../src/mcp/tools/index.js';

/**
 * Protocol revision 2026-07-28 removed the `initialize` handshake and moved
 * client identity into a per-request `_meta` envelope. The SDK lifts the
 * reserved `io.modelcontextprotocol/*` keys onto `ctx.mcpReq.envelope` but
 * types the envelope as an empty shape, so this reader narrows by hand — which
 * is exactly why it is worth testing against malformed input directly.
 *
 * The key is spelled out here rather than imported so the test states the wire
 * contract a third-party client would satisfy.
 */
const CLIENT_INFO_KEY = 'io.modelcontextprotocol/clientInfo';

function extraWith(clientInfo: unknown): unknown {
  return { mcpReq: { method: 'tools/call', envelope: { [CLIENT_INFO_KEY]: clientInfo } } };
}

describe('readEnvelopeClientInfo', () => {
  test('reads name and version from the envelope', () => {
    const result = readEnvelopeClientInfo(extraWith({ name: 'claude-code', version: '2.1.0' }));

    expect(result).toEqual({ name: 'claude-code', version: '2.1.0' });
  });

  test('reads name when version is absent', () => {
    const result = readEnvelopeClientInfo(extraWith({ name: 'claude-code' }));

    expect(result).toEqual({ name: 'claude-code' });
  });

  test('drops a non-string version rather than passing it through', () => {
    // The envelope arrives from the client and is not validated by the SDK, so
    // a wrong-typed field must not reach identity resolution.
    const result = readEnvelopeClientInfo(extraWith({ name: 'claude-code', version: 2 }));

    expect(result).toEqual({ name: 'claude-code' });
  });

  test.each([
    ['a non-string name', { name: 42 }],
    ['a missing name', { version: '1.0.0' }],
    ['a non-object clientInfo', 'claude-code'],
    ['a null clientInfo', null],
  ])('returns undefined for %s', (_label, clientInfo) => {
    expect(readEnvelopeClientInfo(extraWith(clientInfo))).toBeUndefined();
  });

  test.each([
    ['no envelope', { mcpReq: { method: 'tools/call' } }],
    ['a non-object envelope', { mcpReq: { envelope: 'nope' } }],
    ['no mcpReq', { sessionId: 'x' }],
    ['a non-object extra', 'extra'],
    ['undefined', undefined],
    ['null', null],
  ])('returns undefined when the extra carries %s', (_label, extra) => {
    expect(readEnvelopeClientInfo(extra)).toBeUndefined();
  });

  test('a 2025-era extra yields nothing, leaving the handshake fallback to answer', () => {
    // A legacy request carries no envelope at all. The caller falls back to the
    // handshake value on the connected instance; this reader must not invent one.
    expect(readEnvelopeClientInfo({ mcpReq: { id: 1, method: 'tools/list' } })).toBeUndefined();
  });
});

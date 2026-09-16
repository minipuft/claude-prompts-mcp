import { describe, expect, jest, test } from '@jest/globals';

import { TransportRouter } from '../../../src/infra/http/transport/index.js';

import type { ConfigLoader } from '../../../src/infra/config/index.js';
/**
 * The HTTP+SSE transport was removed with the MCP SDK v2 upgrade. A removed
 * option has to fail rather than resolve to something else: for a while
 * `--transport=sse` warned and then fell back to the configured default, so the
 * server started on a transport nobody asked for and reported success. These
 * tests pin the loud behavior, from both places a transport value can arrive.
 */

function stubConfig(mode: string): ConfigLoader {
  return { getTransportMode: jest.fn().mockReturnValue(mode) } as unknown as ConfigLoader;
}

describe('TransportRouter.determineTransport', () => {
  test.each(['stdio', 'streamable-http', 'both'])('accepts --transport=%s', (mode) => {
    expect(TransportRouter.determineTransport([`--transport=${mode}`], stubConfig('stdio'))).toBe(
      mode
    );
  });

  test('rejects --transport=sse instead of falling back to the config default', () => {
    // The config says stdio. Substituting it here is exactly the bug: the
    // operator asked for a transport that no longer exists and would have been
    // told nothing.
    expect(() =>
      TransportRouter.determineTransport(['--transport=sse'], stubConfig('stdio'))
    ).toThrow(/--transport=sse is no longer supported/);
  });

  test('rejects a configured sse transport, not just the CLI flag', () => {
    // config.json is the second way a removed transport reaches the runtime.
    expect(() => TransportRouter.determineTransport([], stubConfig('sse'))).toThrow(
      /config\.transport=sse is no longer supported/
    );
  });

  test('names streamable-http in the failure so the message is actionable', () => {
    expect(() =>
      TransportRouter.determineTransport(['--transport=sse'], stubConfig('stdio'))
    ).toThrow(/streamable-http/);
  });

  test('falls back to config when the flag is unrecognized but not removed', () => {
    // An unknown value is a typo, not a decommissioned feature — the existing
    // lenient behavior is deliberate and stays.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const resolved = TransportRouter.determineTransport(
      ['--transport=nonsense'],
      stubConfig('streamable-http')
    );

    expect(resolved).toBe('streamable-http');
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test('uses the config value when no flag is supplied', () => {
    expect(TransportRouter.determineTransport([], stubConfig('both'))).toBe('both');
  });
});

/**
 * Row 4.12: `determineTransport` used to recognize only the `--transport=value` form here —
 * `parseServerCliArgs` (`runtime/cli.ts`, built on node:util `parseArgs`) has always accepted the
 * space form `--transport value` too, so `resolveRuntimeLaunchOptions`'s auto-quiet decision (fed
 * by that parser) and this method could disagree: `--transport streamable-http` quieted the
 * logger for HTTP while the server that actually started served STDIO. These tests pin the space
 * form now resolving the SAME way the `=` form does, with the `=` form and the argv-absent
 * default as controls — the space form would fail here before `extractTransportArg` was taught
 * to recognize it.
 */
describe('TransportRouter.determineTransport recognizes the space form', () => {
  test('space form --transport streamable-http selects HTTP', () => {
    expect(
      TransportRouter.determineTransport(['--transport', 'streamable-http'], stubConfig('stdio'))
    ).toBe('streamable-http');
  });

  // CONTROL — the `=` form, already covered above, repeated here for a same-file comparison.
  test('CONTROL — = form --transport=streamable-http selects HTTP', () => {
    expect(
      TransportRouter.determineTransport(['--transport=streamable-http'], stubConfig('stdio'))
    ).toBe('streamable-http');
  });

  // CONTROL — no flag at all falls through to the config default, not HTTP.
  test('CONTROL — no --transport flag does not select HTTP', () => {
    expect(TransportRouter.determineTransport([], stubConfig('stdio'))).toBe('stdio');
  });

  test('space form is case-sensitive to the exact flag: a trailing value-bearing flag is not mistaken for it', () => {
    // '--transporter' must not be treated as '--transport' with a truncated match.
    expect(
      TransportRouter.determineTransport(['--transporter', 'streamable-http'], stubConfig('stdio'))
    ).toBe('stdio');
  });
});

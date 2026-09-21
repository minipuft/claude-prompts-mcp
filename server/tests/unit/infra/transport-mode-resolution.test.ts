import { describe, expect, jest, test } from '@jest/globals';

import { TransportRouter } from '../../../src/infra/http/transport/index.js';

/**
 * The HTTP+SSE transport was removed with the MCP SDK v2 upgrade. A removed
 * option has to fail rather than resolve to something else: for a while
 * `--transport=sse` warned and then fell back to a configured default, so the
 * server started on a transport nobody asked for and reported success. These
 * tests pin the loud behavior.
 *
 * Row 4.13: `determineTransport` no longer parses `args`/`process.argv` or falls back to a
 * `configManager` parameter — both callers (`runtime/context.ts`, `runtime/startup-server.ts`)
 * now hand it `RuntimeLaunchOptions.transport`, the value `resolveRuntimeLaunchOptions` already
 * resolved from `--transport` (defaulting to `'stdio'` when the flag is absent). The space-form
 * vs `=`-form parsing tests live at the parser instead — `RuntimeLaunchOptions.transport` in
 * `tests/unit/runtime/options.identity.test.ts` — since `parseServerCliArgs` is the only place
 * `--transport` is parsed now; this file only tests what `determineTransport` does with an
 * already-resolved string.
 */
describe('TransportRouter.determineTransport', () => {
  test.each(['stdio', 'streamable-http', 'both'])('accepts %s', (mode) => {
    expect(TransportRouter.determineTransport(mode)).toBe(mode);
  });

  test('rejects sse instead of falling back to a default', () => {
    // The operator asked for a transport that no longer exists and would have been
    // told nothing if this fell back silently.
    expect(() => TransportRouter.determineTransport('sse')).toThrow(
      /--transport=sse is no longer supported/
    );
  });

  test('names streamable-http in the failure so the message is actionable', () => {
    expect(() => TransportRouter.determineTransport('sse')).toThrow(/streamable-http/);
  });

  test('falls back to stdio when the value is unrecognized but not removed', () => {
    // An unknown value is a typo, not a decommissioned feature — the existing
    // lenient behavior is deliberate and stays.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const resolved = TransportRouter.determineTransport('nonsense');

    expect(resolved).toBe('stdio');
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  // POSITIVE CONTROL — without this, "falls back to stdio" above could pass equally well
  // against a determineTransport that always returns 'stdio' regardless of the recognized value.
  test('CONTROL — a recognized value is not overridden by the stdio fallback', () => {
    expect(TransportRouter.determineTransport('streamable-http')).toBe('streamable-http');
  });
});

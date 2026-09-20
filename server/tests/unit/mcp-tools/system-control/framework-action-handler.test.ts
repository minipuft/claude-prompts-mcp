/**
 * Pins the framework `inspect` action's response label and its input parameter (plan rows 5.4, 5.5).
 *
 * 5.4: `methodology_id` was read here but declared in neither `tooling/contracts/system-control.json`
 * nor `system-control.schema.ts`. The schema is a plain `z.object()`, and Zod strips unknown keys
 * at the MCP boundary, so the read was unreachable — `|| args.framework` had been doing all the
 * work. These tests assert the surviving parameter is the declared one.
 *
 * 5.5: `inspect_methodology` was the label emitted into `structuredContent.action` and the
 * execution id, so it was user-visible.
 *
 * Classification: Unit (one handler, stubbed context; the runtime loader reads real resources).
 */

import { describe, expect, test, jest } from '@jest/globals';

import type { SystemControlContext } from '../../../../src/mcp/tools/system-control/core/types.js';
import type { ToolResponse } from '../../../../src/shared/types/index.js';

import { FrameworkActionHandler } from '../../../../src/mcp/tools/system-control/handlers/framework-action-handler.js';

/** Records the `action` label each response was built with. */
function makeContext(): { context: SystemControlContext; labels: string[] } {
  const labels: string[] = [];
  const context = {
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    startTime: 0,
    createMinimalSystemResponse: (text: string, action: string): ToolResponse => {
      labels.push(action);
      return { content: [{ type: 'text', text }], isError: false };
    },
  } as unknown as SystemControlContext;

  return { context, labels };
}

function textOf(response: ToolResponse): string {
  return (response.content[0] as { text: string }).text;
}

describe('FrameworkActionHandler inspect', () => {
  test('labels the response inspect_framework, not inspect_methodology', async () => {
    const { context, labels } = makeContext();

    await new FrameworkActionHandler(context).execute({ operation: 'inspect' });

    expect(labels).toContain('inspect_framework');
    expect(labels).not.toContain('inspect_methodology');
  });

  test('resolves the target framework from the declared `framework` parameter', async () => {
    const { context } = makeContext();

    const response = await new FrameworkActionHandler(context).execute({
      operation: 'inspect',
      framework: 'cageerf',
    });

    // Either the framework was found and rendered, or it was reported missing by that id —
    // both prove `framework` reached the loader rather than being ignored.
    expect(textOf(response)).toMatch(/cageerf/i);
  });

  test('ignores the removed methodology_id parameter', async () => {
    const { context } = makeContext();

    const response = await new FrameworkActionHandler(context).execute({
      operation: 'inspect',
      methodology_id: 'cageerf',
    });

    // With no `framework`, inspect falls back to the "available frameworks" listing. If
    // methodology_id were still honoured this would render a single framework's detail instead.
    expect(textOf(response)).toContain('Available Frameworks');
  });

  test('advertises only parameters the input schema declares', async () => {
    const { context } = makeContext();

    const response = await new FrameworkActionHandler(context).execute({ operation: 'inspect' });

    expect(textOf(response)).toContain('framework:"<id>"');
    expect(textOf(response)).not.toContain('methodology_id');
  });
});

/**
 * Row B.53: the enable/disable actions read the caller's scope to decide whether the toggle
 * was a no-op, then wrote with no scope at all — the launch workspace's row. Over HTTP one
 * process serves several workspaces, so a toggle left the caller's own scope untouched and
 * flipped an unrelated project's.
 */
describe('FrameworkActionHandler framework system toggle', () => {
  /** A store whose state is keyed by scope, as the real one is. */
  function makeScopedStore(initial: Record<string, boolean>) {
    const enabled = { ...initial };
    const writes: Array<{ enabled: boolean; scope: unknown }> = [];
    const keyOf = (scope?: { workspaceId?: string }) => scope?.workspaceId ?? 'launch';
    const store = {
      getCurrentState: (scope?: { workspaceId?: string }) => ({
        frameworkSystemEnabled: enabled[keyOf(scope)] ?? false,
        activeFramework: 'cageerf',
      }),
      enableFrameworkSystem: async (_reason?: string, scope?: { workspaceId?: string }) => {
        enabled[keyOf(scope)] = true;
        writes.push({ enabled: true, scope });
      },
      disableFrameworkSystem: async (_reason?: string, scope?: { workspaceId?: string }) => {
        enabled[keyOf(scope)] = false;
        writes.push({ enabled: false, scope });
      },
    };
    return { store, enabled, writes };
  }

  function makeToggleContext(store: unknown, requestScope: { workspaceId: string }) {
    const { context } = makeContext();
    return {
      ...context,
      frameworkStateStore: store,
      requestScope,
      persistFrameworkConfig: async () => undefined,
    } as unknown as SystemControlContext;
  }

  const caller = { workspaceId: 'caller-workspace' };

  test('enable writes the calling workspace and leaves the launch workspace alone', async () => {
    const { store, enabled, writes } = makeScopedStore({ launch: false });

    await new FrameworkActionHandler(makeToggleContext(store, caller)).execute({
      operation: 'enable',
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]!.scope).toBe(caller);
    expect(enabled['caller-workspace']).toBe(true);
    expect(enabled.launch).toBe(false);
  });

  test('disable writes the calling workspace and leaves the launch workspace alone', async () => {
    const { store, enabled, writes } = makeScopedStore({
      launch: true,
      'caller-workspace': true,
    });

    await new FrameworkActionHandler(makeToggleContext(store, caller)).execute({
      operation: 'disable',
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]!.scope).toBe(caller);
    expect(enabled['caller-workspace']).toBe(false);
    expect(enabled.launch).toBe(true);
  });

  test('a toggle that is already in the requested state writes nothing', async () => {
    // Positive control for the two assertions above: the writes they count are real, not
    // an artefact of a handler that never writes.
    const { store, writes } = makeScopedStore({ 'caller-workspace': true });

    await new FrameworkActionHandler(makeToggleContext(store, caller)).execute({
      operation: 'enable',
    });

    expect(writes).toHaveLength(0);
  });
});

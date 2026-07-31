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

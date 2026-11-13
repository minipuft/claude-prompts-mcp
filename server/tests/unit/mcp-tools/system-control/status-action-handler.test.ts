/**
 * `status` carries a **Resource locations** section rendered from the view the composition root
 * wires (rows 1.5 and 1.8). The report itself is built and pinned against real folders in
 * `tests/unit/runtime/resource-location-report.test.ts`; this file pins that the handler renders
 * it into the status reply and refuses to answer without it.
 *
 * Classification: Unit (one handler, stubbed context — the same stand-in shape as
 * config-action-handler.test.ts's `makeContext`).
 */

import { describe, expect, jest, test } from '@jest/globals';

import { StatusActionHandler } from '../../../../src/mcp/tools/system-control/handlers/status-action-handler.js';

import type { SystemControlContext } from '../../../../src/mcp/tools/system-control/core/types.js';
import type { ToolResponse } from '../../../../src/shared/types/index.js';
import type {
  ResourceLocationReport,
  ResourceLocationsView,
} from '../../../../src/shared/types/resource-location-report.js';

const REPORT: ResourceLocationReport = {
  locations: [
    {
      path: '/ws/custom',
      kind: 'listed',
      counts: { prompt: 12, gate: 3, framework: 0, style: 2 },
    },
    {
      path: '/ws/custom2',
      kind: 'listed',
      counts: { prompt: 1, gate: 0, framework: 0, style: 0 },
    },
  ],
  bundled: 'absent',
  profile: { state: 'labelled', label: 'dev', siblings: ['shared', 'team'], registryPath: '/p' },
  shadowed: [
    {
      type: 'prompt',
      id: 'review',
      servedFrom: '/ws/custom/prompts/x/review/prompt.yaml',
      hiddenIn: '/ws/custom2/prompts/x/review/prompt.yaml',
    },
  ],
};

function makeContext(resourceLocations: ResourceLocationsView | undefined): SystemControlContext {
  return {
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    startTime: Date.now(),
    frameworkStateStore: {
      getSystemHealth: () => ({
        status: 'healthy',
        frameworkSystemEnabled: true,
        activeFramework: 'CAGEERF',
      }),
    },
    resourceLocations,
    createMinimalSystemResponse: (text: string, _action: string): ToolResponse => ({
      content: [{ type: 'text', text }],
      isError: false,
    }),
  } as unknown as SystemControlContext;
}

function textOf(response: ToolResponse): string {
  return (response.content[0] as { text: string }).text;
}

describe('status: Resource locations section', () => {
  test('renders each location in order with counts, the bundle, the profile and the shadowed', async () => {
    const view: ResourceLocationsView = { configuredEntries: () => [], report: () => REPORT };

    const text = textOf(
      await new StatusActionHandler(makeContext(view)).execute({ include_metrics: false })
    );

    expect(text).toContain(
      [
        '**Resource locations**',
        '1. /ws/custom (listed) — 12 prompts, 3 gates, 0 frameworks, 2 styles',
        '2. /ws/custom2 (listed) — 1 prompts, 0 gates, 0 frameworks, 0 styles',
        'bundled (absent)',
        'profile: dev (siblings: shared, team)',
        'Shadowed:',
        '- review (prompt): served from /ws/custom/prompts/x/review/prompt.yaml, ' +
          'hidden copy in /ws/custom2/prompts/x/review/prompt.yaml',
      ].join('\n')
    );
  });

  test('refuses rather than omitting the section when the view was never wired', async () => {
    await expect(
      new StatusActionHandler(makeContext(undefined)).execute({ include_metrics: false })
    ).rejects.toThrow('Resource locations view not wired');
  });
});

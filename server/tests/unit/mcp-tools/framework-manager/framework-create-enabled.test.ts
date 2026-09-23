/**
 * `framework create` reads `enabled` rather than hardcoding it (P4.134).
 *
 * The router forwarded `enabled` on create and the handler wrote `enabled: true` regardless, so
 * `enabled:false` created an ENABLED framework and answered success. Once ownership became
 * per-action, the contract had to say whether create reads it: the bundled `framework_builder`
 * tool sends it on create, so create now reads it, as the repair path already did.
 *
 * Observed at the validator, which receives the exact data the writer would persist.
 */
import { describe, expect, it, jest } from '@jest/globals';

import { FrameworkLifecycleProcessor } from '../../../../src/mcp/tools/framework-manager/services/framework-lifecycle-processor.js';

import type { FrameworkResourceContext } from '../../../../src/mcp/tools/framework-manager/core/context.js';
import type { FrameworkManagerInput } from '../../../../src/mcp/tools/framework-manager/core/types.js';
import type { FrameworkDraftValidator } from '../../../../src/mcp/tools/framework-manager/services/framework-draft-validator.js';

async function createdData(enabled: boolean | undefined): Promise<Record<string, unknown>> {
  const validate = jest.fn((_data: Record<string, unknown>) => ({ valid: false }));
  const validator = {
    validate,
    createErrorResponse: () => ({ content: [{ type: 'text', text: 'stopped' }], isError: true }),
  } as unknown as FrameworkDraftValidator;
  const ctx = {
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    frameworkManager: {
      getFrameworkRegistry: () => ({ hasGuide: () => false }),
      getFramework: () => undefined,
      getQuarantine: () => ({ byId: () => [] }),
    },
    fileService: { frameworkExists: () => false },
    configManager: { getFrameworksDirectory: () => '/nowhere' },
  } as unknown as FrameworkResourceContext;

  await new FrameworkLifecycleProcessor(ctx, validator).handleCreate({
    action: 'create',
    id: 'probe-fw',
    name: 'Probe',
    ...(enabled === undefined ? {} : { enabled }),
  } as FrameworkManagerInput);
  return validate.mock.calls[0]?.[0] ?? {};
}

describe('framework create honours enabled', () => {
  it('enabled:false creates a DISABLED framework', async () => {
    expect((await createdData(false))['enabled']).toBe(false);
  });

  it('CONTROL: omitting enabled still creates an enabled framework', async () => {
    expect((await createdData(undefined))['enabled']).toBe(true);
  });
});

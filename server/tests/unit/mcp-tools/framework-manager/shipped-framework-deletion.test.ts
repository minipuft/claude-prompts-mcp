import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SHIPPED_FRAMEWORK_IDS,
  isShippedFrameworkId,
} from '../../../../src/engine/frameworks/definitions/shipped-frameworks.js';
import { FrameworkLifecycleProcessor } from '../../../../src/mcp/tools/framework-manager/services/framework-lifecycle-processor.js';

import type { FrameworkResourceContext } from '../../../../src/mcp/tools/framework-manager/core/context.js';
import type { FrameworkManagerInput } from '../../../../src/mcp/tools/framework-manager/core/types.js';
import type { FrameworkDraftValidator } from '../../../../src/mcp/tools/framework-manager/services/framework-draft-validator.js';

/** The delete path never reaches validation, so this only has to satisfy the constructor. */
const validator = {} as unknown as FrameworkDraftValidator;

/**
 * A framework that ships with the server must not be deletable, and one the operator created must
 * still be deletable.
 *
 * WHY BOTH HALVES. The defect this covers was a guard that named four of the eight shipped
 * frameworks, so `focus`, `liquescent`, `radiant` and `verify` fell through to `fs.rm` and were
 * removed FROM THE BUNDLED TREE. The obvious fix — refuse anything present under the resources
 * root — would have passed the first half and broken the second, because in a default install the
 * bundled directory and the configured frameworks directory are the SAME path. A test that only
 * asserted the refusal would have called that fix correct.
 *
 * The assertions are on the DIRECTORY, not only the message. A refusal that returns an error
 * string after `fs.rm` has already run reads identically to one that returns before it.
 */
describe('framework deletion refuses what the server ships', () => {
  let workspaceDir: string;
  let frameworksDir: string;
  let ctx: FrameworkResourceContext;

  const makeFrameworkDir = (id: string): string => {
    const dir = join(frameworksDir, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'framework.yaml'), `id: ${id}\nname: ${id}\n`);
    return dir;
  };

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-shipped-fw-'));
    frameworksDir = join(workspaceDir, 'resources', 'frameworks');
    mkdirSync(frameworksDir, { recursive: true });

    ctx = {
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      // Only the question the guard asks is stubbed, and it delegates to the real predicate — a
      // stub returning a hardcoded answer would test the mock rather than the shipped set.
      frameworkManager: {
        isShippedFramework: (id: string) => isShippedFrameworkId(id),
        unregister: jest.fn(() => true),
      },
      configManager: {
        getServerRoot: () => workspaceDir,
        getFrameworksDirectory: () => frameworksDir,
        // A default install: no distinct bundled tree. This is the configuration in which the old
        // bundled-tree branch was unreachable.
        getBundledResourceDirectory: () => undefined,
      },
      fileService: { deleteFramework: jest.fn(async () => true) },
      textDiffService: {},
      versionHistoryService: {},
    } as unknown as FrameworkResourceContext;
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  const del = (id: string): FrameworkManagerInput =>
    ({ action: 'delete', id, confirm: true }) as unknown as FrameworkManagerInput;

  it.each(SHIPPED_FRAMEWORK_IDS.map((id) => [id]))(
    'refuses to delete shipped framework %s, and leaves it on disk',
    async (id) => {
      const dir = makeFrameworkDir(id);
      const processor = new FrameworkLifecycleProcessor(ctx, validator);

      const result = await processor.handleDelete(del(id));

      expect(JSON.stringify(result)).toMatch(/ships with the server/i);
      expect(existsSync(dir)).toBe(true);
    }
  );

  it('still deletes a framework the operator created', async () => {
    const dir = makeFrameworkDir('my-own-framework');
    const processor = new FrameworkLifecycleProcessor(ctx, validator);

    const result = await processor.handleDelete(del('my-own-framework'));

    expect(JSON.stringify(result)).not.toMatch(/ships with the server/i);
    expect(existsSync(dir)).toBe(false);
  });

  it('refuses a shipped id whatever case it arrives in', async () => {
    const dir = makeFrameworkDir('focus');
    const processor = new FrameworkLifecycleProcessor(ctx, validator);

    const result = await processor.handleDelete(del('FOCUS'));

    expect(JSON.stringify(result)).toMatch(/ships with the server/i);
    expect(existsSync(dir)).toBe(true);
  });
});

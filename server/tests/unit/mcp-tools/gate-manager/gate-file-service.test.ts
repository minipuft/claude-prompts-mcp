import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GateFileWriter } from '../../../../src/mcp/tools/gate-manager/services/index.js';

import type { ConfigManager, Logger } from '../../../../src/shared/types/index.js';

describe('GateFileWriter', () => {
  let workspaceDir: string;
  let gatesDir: string;
  let logger: Logger;
  let configManager: ConfigManager;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-gate-file-'));
    gatesDir = join(workspaceDir, 'gates');
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
    configManager = {
      getGatesDirectory: () => gatesDir,
      // No bundled tree in this fixture: the stub answers "no distinct bundled source".
      getBundledResourceDirectory: () => undefined,
    } as unknown as ConfigManager;
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('returns normalized verification failure and rolls back invalid gate writes', async () => {
    const service = new GateFileWriter({ logger, configManager });
    const result = await service.writeGateFiles({
      id: 'bad-gate',
      name: 'Bad Gate',
      type: 'validation',
      description: '',
      guidance: 'Guidance text',
    });

    expect(result.success).toBe(false);
    expect(result.verificationFailure).toBeDefined();
    expect(result.verificationFailure?.resourceType).toBe('gates');
    expect(result.verificationFailure?.resourceId).toBe('bad-gate');
    expect(result.verificationFailure?.rolledBack).toBe(true);
    expect(existsSync(join(gatesDir, 'bad-gate'))).toBe(false);
  });
});

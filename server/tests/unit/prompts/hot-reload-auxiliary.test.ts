import { describe, expect, jest, test } from '@jest/globals';

import { createSimpleLogger } from '../../../src/logging/index.js';
import { FileChangeEvent } from '../../../src/prompts/file-observer.js';
import {
  HotReloadManager,
  type AuxiliaryReloadConfig,
} from '../../../src/prompts/hot-reload-manager.js';

describe('HotReloadManager auxiliary reloads', () => {
  test('invokes auxiliary handler when file path matches', async () => {
    const logger = createSimpleLogger('stdio');
    const manager = new HotReloadManager(logger);

    const handler = jest.fn().mockResolvedValue(undefined);
    const auxiliary: AuxiliaryReloadConfig = {
      id: 'aux-test',
      directories: ['/tmp/aux'],
      handler,
    };

    manager.setAuxiliaryReloads([auxiliary]);

    const event: FileChangeEvent = {
      filePath: '/tmp/aux/config.yaml',
      filename: 'config.yaml',
      type: 'changed',
      isPromptFile: false,
      isConfigFile: false,
      isMethodologyFile: false,
      timestamp: Date.now(),
    };

    await (manager as any).triggerAuxiliaryReloads(event);

    expect(handler).toHaveBeenCalledTimes(1);
    const callArg = handler.mock.calls[0][0];
    expect(callArg.affectedFiles).toContain('/tmp/aux/config.yaml');
    expect(callArg.reason).toContain('aux-test');
  });
});

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { FrameworkOperatorExecutor } from '../../src/execution/operators/framework-operator-executor.js';
import type { FrameworkStateManager } from '../../src/frameworks/framework-state-manager.js';
import type { Logger } from '../../src/logging/index.js';
import type { FrameworkOperator } from '../../src/execution/parsers/types/operator-types.js';

describe('FrameworkOperatorExecutor', () => {
  const frameworkOperator: FrameworkOperator = {
    type: 'framework',
    frameworkId: 'react',
    normalizedId: 'REACT',
    temporary: true,
    scopeType: 'execution'
  };

  let switchFrameworkMock: jest.Mock<Promise<boolean>, [any]>;
  let getActiveFrameworkMock: jest.Mock<any, []>;
  let isFrameworkSystemEnabledMock: jest.Mock<boolean, []>;
  let frameworkStateManager: FrameworkStateManager;
  let logger: Logger;
  let executor: FrameworkOperatorExecutor;

  beforeEach(() => {
    switchFrameworkMock = jest.fn(() => Promise.resolve(true));
    getActiveFrameworkMock = jest.fn(() => ({ id: 'CAGEERF' }));
    isFrameworkSystemEnabledMock = jest.fn(() => true);

    frameworkStateManager = {
      switchFramework: switchFrameworkMock,
      getActiveFramework: getActiveFrameworkMock,
      isFrameworkSystemEnabled: isFrameworkSystemEnabledMock,
    } as unknown as FrameworkStateManager;

    logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;

    executor = new FrameworkOperatorExecutor(frameworkStateManager, logger);
  });

  test('applies framework override and restores after successful execution', async () => {
    const result = await executor.executeWithFramework(frameworkOperator, async () => 'ok');

    expect(result).toBe('ok');
    expect(isFrameworkSystemEnabledMock).toHaveBeenCalledTimes(1);
    expect(getActiveFrameworkMock).toHaveBeenCalledTimes(1);

    expect(switchFrameworkMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      targetFramework: 'REACT',
      reason: expect.stringContaining('framework override'),
    }));

    expect(switchFrameworkMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      targetFramework: 'CAGEERF',
      reason: expect.stringContaining('Restoring framework'),
    }));
  });

  test('throws when framework system is disabled', async () => {
    isFrameworkSystemEnabledMock.mockReturnValueOnce(false);

    await expect(
      executor.executeWithFramework(frameworkOperator, async () => 'should-not-run'),
    ).rejects.toThrow('Framework overrides are disabled');

    expect(switchFrameworkMock).not.toHaveBeenCalled();
  });

  test('throws when framework switch fails during apply', async () => {
    switchFrameworkMock.mockResolvedValueOnce(false);
    const executionSpy = jest.fn();

    await expect(
      executor.executeWithFramework(frameworkOperator, executionSpy),
    ).rejects.toThrow("Unable to apply '@react' framework override");

    expect(executionSpy).not.toHaveBeenCalled();
    expect(switchFrameworkMock).toHaveBeenCalledTimes(1);
  });

  test('restores original framework even when execution throws', async () => {
    const error = new Error('execution failed');

    await expect(
      executor.executeWithFramework(frameworkOperator, async () => {
        throw error;
      }),
    ).rejects.toThrow(error);

    expect(switchFrameworkMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ targetFramework: 'REACT' }));
    expect(switchFrameworkMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ targetFramework: 'CAGEERF' }));
  });

  test('surfaces restoration failure when execution succeeds', async () => {
    switchFrameworkMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(
      executor.executeWithFramework(frameworkOperator, async () => 'ok'),
    ).rejects.toThrow("Unable to restore framework 'CAGEERF'");

    expect((logger.error as jest.Mock).mock.calls.some(([message]) =>
      typeof message === 'string' && message.includes('Failed to restore framework after override'),
    )).toBe(true);
  });

  test('logs restoration failure but preserves original execution error', async () => {
    switchFrameworkMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(
      executor.executeWithFramework(frameworkOperator, async () => {
        throw new Error('downstream failure');
      }),
    ).rejects.toThrow('downstream failure');

    const errorCalls = (logger.error as jest.Mock).mock.calls.map(([message]) => String(message));
    expect(errorCalls).toContain('[SymbolicFramework] Failed to restore framework after override');
    expect(errorCalls).toContain('[SymbolicFramework] Failed to restore framework after symbolic execution');
  });
});

import { describe, expect, jest, test } from '@jest/globals';

import { createConsolidatedPromptManager } from '../../../../src/mcp-tools/prompt-manager/index.js';

import type { Logger } from '../../../../src/logging/index.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createPromptManager = () => {
  const logger = createLogger();
  const mockMcpServer = { sendNotification: jest.fn() };
  const configManager = {
    getPromptsFilePath: () => '/tmp/prompts.json',
    getServerRoot: () => process.cwd(),
    getPromptsDirectory: () => '/tmp/prompts',
    getVersioningConfig: () => ({
      enabled: true,
      max_versions: 50,
      auto_version: true,
    }),
  } as any;
  const semanticAnalyzer = {
    analyzePrompt: jest.fn(),
    analyzePromptIntelligence: jest.fn().mockResolvedValue({
      feedback: '',
      suggestions: [],
      classification: { executionType: 'prompt', requiresFramework: false, confidence: 0.5 },
    }),
    isLLMEnabled: jest.fn().mockReturnValue(false),
  } as any;

  const manager = createConsolidatedPromptManager(
    logger as any,
    mockMcpServer as any,
    configManager,
    semanticAnalyzer,
    undefined,
    undefined,
    () => Promise.resolve(),
    () => Promise.resolve()
  );

  manager.updateData([], [], []);
  return manager;
};

describe('Prompt Manager guide action', () => {
  test('returns metadata-driven summary', async () => {
    const manager = createPromptManager();
    const response = await manager.handleAction({ action: 'guide' } as any, {});
    const text = response.content?.[0]?.text ?? '';
    expect(text).toContain('Prompt Manager Guide');
    expect(text).toContain('`create`');
    expect(text).toContain('Recommended Actions');
  });

  test('highlights gate workflows when goal references gates', async () => {
    const manager = createPromptManager();
    const response = await manager.handleAction(
      { action: 'guide', goal: 'gate config' } as any,
      {}
    );
    const text = response.content?.[0]?.text ?? '';
    expect(text).toContain('`analyze_gates`');
    expect(text).toContain('Recommended Actions');
  });
});

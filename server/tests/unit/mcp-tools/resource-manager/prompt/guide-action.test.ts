import { describe, expect, jest, test } from '@jest/globals';

import { createPromptResourceService } from '../../../../../src/mcp-tools/resource-manager/prompt/index.js';

import type { Logger } from '../../../../../src/logging/index.js';

const createMockLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

function createTestService() {
  const logger = createMockLogger();
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

  const service = createPromptResourceService(
    logger as any,
    configManager,
    semanticAnalyzer,
    undefined,
    undefined,
    () => Promise.resolve(),
    () => Promise.resolve()
  );

  service.updateData([], [], []);
  return service;
}

describe('Prompt resource guide action', () => {
  test('returns metadata-driven summary', async () => {
    const service = createTestService();
    const response = await service.handleAction({ action: 'guide' } as any, {});
    const text = response.content?.[0]?.text ?? '';
    expect(text).toContain('Prompt Resource Guide');
    expect(text).toContain('`create`');
    expect(text).toContain('Recommended Actions');
  });

  test('highlights gate workflows when goal references gates', async () => {
    const service = createTestService();
    const response = await service.handleAction(
      { action: 'guide', goal: 'gate config' } as any,
      {}
    );
    const text = response.content?.[0]?.text ?? '';
    expect(text).toContain('`analyze_gates`');
    expect(text).toContain('Recommended Actions');
  });
});

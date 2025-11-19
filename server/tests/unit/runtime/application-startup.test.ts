import { describe, expect, test, jest } from '@jest/globals';

import { createSimpleLogger } from '../../../src/logging/index.js';
import { PromptAssetManager } from '../../../src/prompts/index.js';
import { Application } from '../../../src/runtime/application.js';

describe('Application startup (prompt loading)', () => {
  test('loads configuration and prompts when loadAndConvertPrompts is stubbed', async () => {
    const promptStub = {
      id: 'demo',
      name: 'Demo Prompt',
      description: 'Test prompt',
      category: 'general',
      file: 'demo.md',
      arguments: [],
    };

    const convertedStub = {
      id: 'demo',
      name: 'Demo Prompt',
      description: 'Test prompt',
      category: 'general',
      userMessageTemplate: 'Hello {{name}}',
      systemMessage: '',
      requiresExecution: false,
      arguments: [],
    };

    const categoryStub = {
      id: 'general',
      name: 'General',
      description: 'General prompts',
    };

    const loadSpy = jest
      .spyOn(PromptAssetManager.prototype as any, 'loadAndConvertPrompts')
      .mockResolvedValue({
        promptsData: [promptStub],
        categories: [categoryStub],
        convertedPrompts: [convertedStub],
      });

    const app = new Application(createSimpleLogger('stdio'));

    try {
      await app.loadConfiguration();
      await app.loadPromptsData();

      const diagnostics = await app.getDiagnosticInfo();
      expect(diagnostics.errors).not.toContain('No prompts loaded');
      expect(diagnostics.errors).not.toContain('No categories loaded');
      expect(loadSpy).toHaveBeenCalled();
    } finally {
      loadSpy.mockRestore();
      await app.shutdown();
    }
  });
});

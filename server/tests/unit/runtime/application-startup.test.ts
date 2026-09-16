import { describe, expect, test, jest } from '@jest/globals';
import * as path from 'node:path';
import { fileURLToPath } from 'url';

import { createSimpleLogger } from '../../../src/infra/logging/index.js';
import { PromptAssetManager } from '../../../src/modules/prompts/index.js';
import { Application } from '../../../src/runtime/application.js';
import type { RuntimeLaunchOptions } from '../../../src/runtime/options.js';

// Resolve the actual server root for test context (Jest's import.meta.url differs from dist/)
const __filename = fileURLToPath(import.meta.url);
const SERVER_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..');

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

    const runtimeOptions: Partial<RuntimeLaunchOptions> = {
      serverRoot: SERVER_ROOT,
      args: [],
      verbose: false,
      quiet: true,
      startupTest: false,
      testEnvironment: true,
      transport: 'stdio',
      paths: {},
    };
    const app = new Application(
      createSimpleLogger('stdio'),
      runtimeOptions as RuntimeLaunchOptions
    );

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

import { describe, expect, test, jest } from '@jest/globals';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'url';

import { createSimpleLogger } from '../../../src/infra/logging/index.js';
import { PromptAssetManager } from '../../../src/modules/prompts/index.js';
import { Application } from '../../../src/runtime/application.js';
import type { RuntimeLaunchOptions } from '../../../src/runtime/options.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

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

    // `serverRoot` is the package and `paths` names no workspace, so the runtime root falls back
    // to the package directory, and startup's `mkdir` of the log directory left an empty
    // `server/logs/` behind on every run (found by the tree-state guard, 2026-09-16). The env
    // variable is the one knob that moves ONLY the writable root; resource resolution is untouched.
    const previousRuntimeRoot = process.env['MCP_RUNTIME_ROOT'];
    process.env['MCP_RUNTIME_ROOT'] = testScratchPath('application-startup-runtime');

    const runtimeOptions: Partial<RuntimeLaunchOptions> = {
      serverRoot: SERVER_ROOT,
      args: [],
      verbose: false,
      quiet: true,
      startupTest: false,
      testEnvironment: true,
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
      const runtimeRoot = process.env['MCP_RUNTIME_ROOT'];
      if (previousRuntimeRoot === undefined) delete process.env['MCP_RUNTIME_ROOT'];
      else process.env['MCP_RUNTIME_ROOT'] = previousRuntimeRoot;
      await fs.rm(runtimeRoot, { recursive: true, force: true });
    }
  });
});

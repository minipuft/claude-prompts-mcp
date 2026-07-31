import { EventEmitter, once } from 'events';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { describe, expect, it, beforeEach, jest } from '@jest/globals';

import { createToolDescriptionLoader } from '../src/mcp/tools/tool-description-loader.js';
import { resetDefaultRuntimeLoader } from '../src/engine/frameworks/definitions/index.js';

import type { ConfigManager } from '../src/infra/config/index.js';
import type { FrameworkStateStore } from '../src/engine/frameworks/framework-state-store.js';
import type { Logger } from '../src/infra/logging/index.js';
import type { ResolvedFrameworkConfig, ToolDescriptionsConfig } from '../src/shared/types/index.js';

class FakeConfigManager extends EventEmitter {
  private root: string;
  private frameworks: ResolvedFrameworkConfig;

  constructor(root: string, frameworks: ResolvedFrameworkConfig) {
    super();
    this.root = root;
    this.frameworks = frameworks;
  }

  getServerRoot(): string {
    return this.root;
  }

  getFrameworksConfig(): ResolvedFrameworkConfig {
    return this.frameworks;
  }

  getConfig() {
    return { frameworks: this.frameworks };
  }
}

class FakeFrameworkStateStore extends EventEmitter {
  private activeFramework = 'CAGEERF';
  private enabled = true;

  getCurrentState() {
    return {
      activeFramework: this.activeFramework,
      previousFramework: null,
      switchedAt: new Date(),
      switchReason: 'test',
      isHealthy: true,
      frameworkSystemEnabled: this.enabled,
      switchingMetrics: { switchCount: 0, averageResponseTime: 0, errorCount: 0 },
    };
  }

  getActiveFramework() {
    return {
      id: this.activeFramework,
      type: this.activeFramework,
      name: this.activeFramework,
      enabled: true,
    } as any;
  }

  switchFramework(target: string, reason = 'switch'): void {
    const previous = this.activeFramework;
    this.activeFramework = target;
    this.emit('framework-switched', previous, target, reason);
  }
}

const makeLogger = (): Logger =>
  ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }) as unknown as Logger;

const baseFrameworksConfig: ResolvedFrameworkConfig = {
  dynamicToolDescriptions: true,
};

async function setupTempConfigRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tool-desc-'));
  const generatedDir = path.join(root, 'src', 'tooling', 'contracts', '_generated');
  await fs.mkdir(generatedDir, { recursive: true });

  const contractsConfig: ToolDescriptionsConfig = {
    version: '2.0.0',
    tools: {
      prompt_engine: {
        description: 'BASE PROMPT ENGINE DESCRIPTION',
      },
      resource_manager: {
        description: 'BASE RESOURCE MANAGER DESCRIPTION',
      },
      system_control: {
        description: 'BASE SYSTEM CONTROL DESCRIPTION',
      },
    },
  };

  await fs.writeFile(
    path.join(generatedDir, 'tool-descriptions.contracts.json'),
    JSON.stringify(contractsConfig, null, 2),
    'utf-8'
  );

  return root;
}

describe('ToolDescriptionLoader (framework-aware active config)', () => {
  beforeEach(() => {
    // Ensure runtime framework loader singleton does not leak state between tests.
    resetDefaultRuntimeLoader();
  });

  it('loads descriptions from generated contracts and applies methodology overlays', async () => {
    const root = await setupTempConfigRoot();
    const configManager = new FakeConfigManager(
      root,
      baseFrameworksConfig
    ) as unknown as ConfigManager;
    const frameworkStateStore = new FakeFrameworkStateStore() as unknown as FrameworkStateStore;
    const manager = createToolDescriptionLoader(makeLogger(), configManager);
    manager.setFrameworkStateStore(frameworkStateStore);

    await manager.initialize();

    const stats = manager.getStats();
    expect(stats.source).toBe('contracts');
    expect(manager.getAvailableTools()).toEqual(
      expect.arrayContaining(['prompt_engine', 'resource_manager', 'system_control'])
    );
    expect(manager.getDescription('prompt_engine', true, 'CAGEERF')).toContain('[CAGEERF]');
  });

  it('updates in-memory descriptions when framework switch events fire', async () => {
    const root = await setupTempConfigRoot();
    const configManager = new FakeConfigManager(
      root,
      baseFrameworksConfig
    ) as unknown as ConfigManager;
    const frameworkStateStore = new FakeFrameworkStateStore() as unknown as FrameworkStateStore;
    const manager = createToolDescriptionLoader(makeLogger(), configManager);
    manager.setFrameworkStateStore(frameworkStateStore);
    await manager.initialize();

    const cageerfDescription = manager.getDescription('prompt_engine', true, 'CAGEERF');
    const changePromise = once(manager, 'descriptions-changed');
    (frameworkStateStore as any).switchFramework('ReACT', 'test switch');
    await changePromise;
    const reactDescription = manager.getDescription('prompt_engine', true, 'ReACT');

    expect(cageerfDescription).toContain('[CAGEERF]');
    expect(reactDescription).toContain('[ReACT]');
    expect(reactDescription).not.toBe(cageerfDescription);
  });
});

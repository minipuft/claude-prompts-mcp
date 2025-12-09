import { EventEmitter, once } from 'events';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { describe, expect, it, jest } from '@jest/globals';

import { createToolDescriptionManager } from '../src/mcp-tools/tool-description-manager.js';

import type { ConfigManager } from '../src/config/index.js';
import type { FrameworkStateManager } from '../src/frameworks/framework-state-manager.js';
import type { Logger } from '../src/logging/index.js';
import type { FrameworksConfig, ToolDescriptionsConfig } from '../src/types/index.js';

class FakeConfigManager extends EventEmitter {
  private root: string;
  private frameworks: FrameworksConfig;

  constructor(root: string, frameworks: FrameworksConfig) {
    super();
    this.root = root;
    this.frameworks = frameworks;
  }

  getServerRoot(): string {
    return this.root;
  }

  getFrameworksConfig(): FrameworksConfig {
    return this.frameworks;
  }

  // minimal stub for compatibility with ConfigManager signature
  getConfig() {
    return { frameworks: this.frameworks };
  }
}

class FakeFrameworkStateManager extends EventEmitter {
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
      methodology: this.activeFramework,
      name: this.activeFramework,
      enabled: true,
    } as any;
  }

  toggle(enabled: boolean, reason = 'toggle') {
    this.enabled = enabled;
    this.emit('framework-system-toggled', enabled, reason);
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

const baseFrameworksConfig: FrameworksConfig = {
  enableSystemPromptInjection: true,
  enableMethodologyGates: true,
  enableDynamicToolDescriptions: true,
};

async function setupTempConfigRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tool-desc-'));
  await fs.mkdir(path.join(root, 'config'), { recursive: true });
  const fallbackPath = path.resolve(process.cwd(), 'config', 'tool-descriptions.fallback.json');
  const fallbackContent = await fs.readFile(fallbackPath, 'utf-8');
  await fs.writeFile(path.join(root, 'config', 'tool-descriptions.fallback.json'), fallbackContent);
  return root;
}

describe('ToolDescriptionManager (framework-aware active config)', () => {
  it('writes an active config aligned to the current methodology', async () => {
    const root = await setupTempConfigRoot();
    const configManager = new FakeConfigManager(
      root,
      baseFrameworksConfig
    ) as unknown as ConfigManager;
    const frameworkStateManager =
      new FakeFrameworkStateManager() as unknown as FrameworkStateManager;
    const manager = createToolDescriptionManager(makeLogger(), configManager);
    manager.setFrameworkStateManager(frameworkStateManager);

    await manager.initialize();

    const activeConfigRaw = await fs.readFile(
      path.join(root, 'config', 'tool-descriptions.json'),
      'utf-8'
    );
    const activeConfig = JSON.parse(activeConfigRaw) as ToolDescriptionsConfig;

    expect(activeConfig.activeFramework).toBe('CAGEERF');
    expect(activeConfig.activeMethodology).toBe('CAGEERF');
    expect(activeConfig.tools.prompt_engine.description).toContain('[CAGEERF]');
    expect(manager.getDescription('prompt_engine', true, 'CAGEERF')).toContain('[CAGEERF]');
  });

  it('regenerates the active config on framework switch events', async () => {
    const root = await setupTempConfigRoot();
    const configManager = new FakeConfigManager(
      root,
      baseFrameworksConfig
    ) as unknown as ConfigManager;
    const frameworkStateManager =
      new FakeFrameworkStateManager() as unknown as FrameworkStateManager;
    const manager = createToolDescriptionManager(makeLogger(), configManager);
    manager.setFrameworkStateManager(frameworkStateManager);
    await manager.initialize();

    const changePromise = once(manager, 'descriptions-changed');
    (frameworkStateManager as any).switchFramework('ReACT', 'test switch');
    await changePromise;

    const activeConfigRaw = await fs.readFile(
      path.join(root, 'config', 'tool-descriptions.json'),
      'utf-8'
    );
    const activeConfig = JSON.parse(activeConfigRaw) as ToolDescriptionsConfig;

    expect(activeConfig.activeFramework).toBe('ReACT');
    expect(activeConfig.tools.prompt_engine.description).toContain('[ReACT]');
  });
});

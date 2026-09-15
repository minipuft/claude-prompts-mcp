import { EventEmitter, once } from 'events';

import { describe, expect, it, beforeEach, jest } from '@jest/globals';

import { createToolDescriptionLoader } from '../../../src/mcp/tools/tool-description-loader.js';
import { resetDefaultRuntimeLoader } from '../../../src/engine/frameworks/definitions/index.js';

import type { FrameworkStateStore } from '../../../src/engine/frameworks/framework-state-store.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type { ConfigManager, ResolvedFrameworkConfig } from '../../../src/shared/types/index.js';

// The same generated contract ToolDescriptionLoader statically imports (esbuild inlines it into
// dist/index.js — see tool-description-loader.ts). Importing it here too lets this suite assert
// against the real content instead of a fake file the loader no longer reads from disk.
import toolDescriptionsContract from '../../../src/mcp/contracts/schemas/_generated/tool-descriptions.contracts.json' with { type: 'json' };

class FakeConfigManager extends EventEmitter {
  private frameworks: ResolvedFrameworkConfig;

  constructor(frameworks: ResolvedFrameworkConfig) {
    super();
    this.frameworks = frameworks;
  }

  getServerRoot(): string {
    // ToolDescriptionLoader no longer reads base descriptions from disk (static JSON import),
    // so this value is unused by production code. Kept only because ConfigManager declares it.
    return '/unused-server-root';
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
  // Matches DEFAULT_FRAMEWORK_ID (src/shared/utils/constants.ts) and the 'CAGEERF' active
  // framework FakeFrameworkStateStore below defaults to — not an arbitrary filler value.
  defaultFramework: 'CAGEERF',
};

describe('ToolDescriptionLoader (framework-aware active config)', () => {
  beforeEach(() => {
    // Ensure runtime framework loader singleton does not leak state between tests.
    resetDefaultRuntimeLoader();
  });

  it('loads base descriptions from the generated contracts file, not in-memory defaults', async () => {
    // No FrameworkStateStore attached: getActiveFrameworkContext() returns {}, so
    // buildActiveConfig applies no framework overlay and the served description is the base
    // contract text verbatim — this is the assertion this row exists to make (measured
    // 2026-09-15: before the static-import fix, this always fell back to
    // createDefaultToolDescriptionMap() and source reported 'defaults').
    const configManager = new FakeConfigManager(baseFrameworksConfig) as unknown as ConfigManager;
    const manager = createToolDescriptionLoader(makeLogger(), configManager);

    await manager.initialize();

    const stats = manager.getStats();
    expect(stats.source).toBe('contracts');
    expect(manager.getAvailableTools()).toEqual(
      expect.arrayContaining(['prompt_engine', 'resource_manager', 'system_control', 'skills_sync'])
    );
    expect(manager.getDescription('prompt_engine')).toBe(
      toolDescriptionsContract.tools.prompt_engine.description
    );
  });

  it('applies framework overlays on top of the loaded base descriptions', async () => {
    const configManager = new FakeConfigManager(baseFrameworksConfig) as unknown as ConfigManager;
    const frameworkStateStore = new FakeFrameworkStateStore() as unknown as FrameworkStateStore;
    const manager = createToolDescriptionLoader(makeLogger(), configManager);
    manager.setFrameworkStateStore(frameworkStateStore);

    await manager.initialize();

    const stats = manager.getStats();
    expect(stats.source).toBe('contracts');
    expect(manager.getDescription('prompt_engine', true, 'CAGEERF')).toContain('[CAGEERF]');
  });

  it('updates in-memory descriptions when framework switch events fire', async () => {
    const configManager = new FakeConfigManager(baseFrameworksConfig) as unknown as ConfigManager;
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

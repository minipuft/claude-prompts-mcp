import { EventEmitter, once } from 'events';

import { describe, expect, it, beforeEach, jest } from '@jest/globals';

import { createToolDescriptionLoader } from '../../../src/mcp/tools/tool-description-loader.js';
import {
  getDefaultRuntimeLoader,
  resetDefaultRuntimeLoader,
} from '../../../src/engine/frameworks/definitions/index.js';

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

type ContractToolName = keyof typeof toolDescriptionsContract.tools;
const CONTRACT_TOOLS = Object.keys(toolDescriptionsContract.tools) as ContractToolName[];

const contractParameterText = (tool: ContractToolName, parameter: string): string => {
  const entry = (toolDescriptionsContract.tools[tool].parameters as Record<string, unknown>)[
    parameter
  ];
  return typeof entry === 'string' ? entry : (entry as { description: string }).description;
};

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
    // Derived from the same contract file, not hardcoded: the loader's tool set must track
    // whatever the contract lists, so this fails if the two ever diverge in either direction.
    const contractToolNames = Object.keys(toolDescriptionsContract.tools);
    expect(contractToolNames.length).toBeGreaterThan(0);
    expect(manager.getAvailableTools().slice().sort()).toEqual(contractToolNames.slice().sort());
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

  // B.64: a framework's `toolDescriptions` entry used to REPLACE the contract text, and the
  // contract's own `frameworkAware` variants replaced it for every other framework. Measured
  // 2026-09-16 on a live server: resource_manager named 8 of its 15 actions under CAGEERF and 0
  // under FOCUS, while its input schema accepted all 15. These pin the composition instead.
  describe('composition keeps the contract text', () => {
    const loadManager = async (frameworks = baseFrameworksConfig) => {
      const configManager = new FakeConfigManager(frameworks) as unknown as ConfigManager;
      const manager = createToolDescriptionLoader(makeLogger(), configManager);
      manager.setFrameworkStateStore(
        new FakeFrameworkStateStore() as unknown as FrameworkStateStore
      );
      await manager.initialize();
      return manager;
    };

    const bundledFrameworks = (): string[] => getDefaultRuntimeLoader().discoverFrameworks();

    it('finds bundled frameworks to compose', () => {
      // Guards the derivation below: an empty list would pass every assertion over it vacuously.
      expect(bundledFrameworks().length).toBeGreaterThan(0);
    });

    it('serves every tool under every bundled framework starting with its contract text', async () => {
      const manager = await loadManager();
      for (const framework of bundledFrameworks()) {
        for (const tool of CONTRACT_TOOLS) {
          const served = manager.getDescription(tool, true, framework);
          expect({
            framework,
            tool,
            startsWithContract: served.startsWith(
              toolDescriptionsContract.tools[tool].description.trimEnd()
            ),
          }).toEqual({ framework, tool, startsWithContract: true });
        }
      }
    });

    it('appends the active framework guidance after the contract text', async () => {
      const manager = await loadManager();
      const contract = toolDescriptionsContract.tools.resource_manager.description.trimEnd();
      const served = manager.getDescription('resource_manager', true, 'CAGEERF');

      expect(served.startsWith(`${contract}\n\nACTIVE FRAMEWORK [CAGEERF]: `)).toBe(true);
      expect(served.length).toBeGreaterThan(contract.length);
    });

    it('serves the contract text alone when the framework system is disabled', async () => {
      const manager = await loadManager();
      for (const tool of CONTRACT_TOOLS) {
        expect(manager.getDescription(tool, false, 'CAGEERF')).toBe(
          toolDescriptionsContract.tools[tool].description
        );
      }
    });

    it('serves the contract text alone when dynamic descriptions are off', async () => {
      const manager = await loadManager({
        ...baseFrameworksConfig,
        dynamicToolDescriptions: false,
      });
      expect(manager.getDescription('resource_manager', true, 'CAGEERF')).toBe(
        toolDescriptionsContract.tools.resource_manager.description
      );
      expect(manager.getParameterDescription('system_control', 'action', true, 'CAGEERF')).toBe(
        contractParameterText('system_control', 'action')
      );
    });

    it('appends parameter guidance after the contract parameter text', async () => {
      const manager = await loadManager();
      const contract = contractParameterText('system_control', 'action');
      const served = manager.getParameterDescription('system_control', 'action', true, 'CAGEERF');

      expect(served?.startsWith(`${contract}\n\nACTIVE FRAMEWORK [CAGEERF]: `)).toBe(true);
      expect(manager.getParameterDescription('system_control', 'action', false, 'CAGEERF')).toBe(
        contract
      );
    });

    it('composes the active config once, so a switch does not stack guidance', async () => {
      const configManager = new FakeConfigManager(baseFrameworksConfig) as unknown as ConfigManager;
      const store = new FakeFrameworkStateStore();
      const manager = createToolDescriptionLoader(makeLogger(), configManager);
      manager.setFrameworkStateStore(store as unknown as FrameworkStateStore);
      await manager.initialize();

      const changed = once(manager, 'descriptions-changed');
      store.switchFramework('ReACT', 'test switch');
      await changed;

      const active = manager.getDescription('resource_manager');
      expect(active.startsWith(toolDescriptionsContract.tools.resource_manager.description)).toBe(
        true
      );
      expect(active.match(/ACTIVE FRAMEWORK \[/g)).toHaveLength(1);
      expect(active).toContain('ACTIVE FRAMEWORK [ReACT]');
    });
  });
});

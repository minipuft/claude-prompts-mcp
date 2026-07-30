// @lifecycle canonical - Manages MCP tool descriptions and discovery metadata.
/**
 * Tool Description Loader
 *
 * Manages externalized tool descriptions with methodology-aware overlays.
 * Base descriptions loaded from generated contracts (tool-descriptions.contracts.json).
 * Overlay resolution delegated to tool-description-overlays.ts.
 *
 * No file persistence — the in-memory descriptions Map is the runtime source of truth.
 */

import { EventEmitter } from 'events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  cloneToolDescription,
  normalizeMethodologyKey,
  preloadMethodologyDescriptions,
  preloadStyleDescriptions,
  buildActiveConfig,
} from './tool-description-overlays.js';
import { FrameworkStateStore } from '../../engine/frameworks/framework-state-store.js';

import type { FrameworkToolDescriptions } from '../../engine/frameworks/types/index.js';
import type { StyleToolDescriptionYaml } from '../../modules/formatting/core/style-schema.js';
import type {
  ConfigManager,
  Logger,
  ToolDescription,
  ToolDescriptionsConfig,
  ResolvedFrameworkConfig,
} from '../../shared/types/index.js';

/**
 * @deprecated Emergency fallback only - do not edit.
 * Primary source of truth is tool-descriptions.contracts.json generated from mcp-contracts/schemas/*.json.
 * Run `npm run generate:contracts` to regenerate from contracts.
 */
const DEFAULT_TOOL_DESCRIPTION_ENTRIES: Array<[string, ToolDescription]> = [
  [
    'prompt_engine',
    {
      description:
        '🚀 PROMPT ENGINE: Executes prompts/chains with % modifiers and unified gates. Start with real prompt ids (no invented labels); list/inspect via resource_manager(resource_type:"prompt", action:"list") when unsure. Inline gates via `::`;  frameworks via `@`; `%clean`/`%lean` disable framework injection. Use `>>guide <topic>` only when you need help.',
      shortDescription: 'Execute prompts and chains',
      category: 'execution',
    },
  ],
  [
    'system_control',
    {
      description:
        '⚙️ SYSTEM CONTROL: Framework switching, gate management, analytics. Actions: status|framework|gates|analytics|config|maintenance|guide. Use `>>help` for system-wide guidance.',
      shortDescription: 'Framework, gates, analytics controls',
      category: 'system',
    },
  ],
  [
    'resource_manager',
    {
      description:
        '📦 RESOURCE MANAGER: Unified CRUD for prompts, gates, and methodologies. resource_type: prompt|gate|methodology. Actions: create|update|delete|list|inspect|reload + analyze_type|analyze_gates|guide (prompt only) + switch (methodology only).',
      shortDescription: 'Manage prompts, gates, methodologies',
      category: 'management',
    },
  ],
];

function createDefaultToolDescriptionMap(): Map<string, ToolDescription> {
  return new Map(
    DEFAULT_TOOL_DESCRIPTION_ENTRIES.map(([name, description]) => [
      name,
      cloneToolDescription(description),
    ])
  );
}

export function getDefaultToolDescription(toolName: string): ToolDescription | undefined {
  const entry = DEFAULT_TOOL_DESCRIPTION_ENTRIES.find(([name]) => name === toolName);
  return entry ? cloneToolDescription(entry[1]) : undefined;
}

/**
 * Manages tool descriptions loaded from generated contracts with methodology overlays.
 *
 * Load flow:
 *   contracts JSON → in-memory Map → methodology overlays applied → getDescription() serves result
 */
export class ToolDescriptionLoader extends EventEmitter {
  private logger: Logger;
  private configPath: string;
  private descriptions: Map<string, ToolDescription>;
  private defaults: Map<string, ToolDescription>;
  private frameworkDescriptions: Map<string, FrameworkToolDescriptions>;
  private styleDescriptions: Map<string, Record<string, StyleToolDescriptionYaml>>;
  private isInitialized: boolean = false;
  private configManager: ConfigManager;
  private frameworksConfig: ResolvedFrameworkConfig;
  private frameworksConfigListener: (
    newConfig: ResolvedFrameworkConfig,
    previousConfig: ResolvedFrameworkConfig
  ) => void;
  private frameworkStateStore?: FrameworkStateStore;
  private lastLoadSource: 'contracts' | 'defaults' = 'defaults';
  private frameworkSwitchedListener?: (
    previousFramework: string,
    newFramework: string,
    reason: string
  ) => void;
  private frameworkToggledListener?: (enabled: boolean, reason: string) => void;

  constructor(logger: Logger, configManager: ConfigManager) {
    super();
    this.logger = logger;
    this.configManager = configManager;
    const serverRoot = configManager.getServerRoot();
    this.configPath = path.join(
      serverRoot,
      'src',
      'tooling',
      'contracts',
      '_generated',
      'tool-descriptions.contracts.json'
    );
    this.descriptions = new Map();
    this.defaults = createDefaultToolDescriptionMap();
    this.frameworkDescriptions = new Map();
    this.styleDescriptions = new Map();
    this.frameworksConfig = this.configManager.getFrameworksConfig();

    this.frameworksConfigListener = (newConfig: ResolvedFrameworkConfig) => {
      this.frameworksConfig = { ...newConfig };
      this.logger.info(
        `Tool description manager feature toggle updated (dynamicDescriptions: ${this.frameworksConfig.dynamicToolDescriptions})`
      );
      if (this.isInitialized) {
        void this.synchronize(
          'Framework feature config changed (dynamic tool descriptions toggle)'
        );
      }
    };

    this.configManager.on('frameworksConfigChanged', this.frameworksConfigListener);
  }

  private warnOnMethodologyConfigLeak(toolName: string, description: ToolDescription): void {
    const hasMethodologyDesc = Boolean(description.frameworkAware?.methodologies);
    const hasMethodologyParams = Boolean(description.frameworkAware?.frameworkParameters);
    if (hasMethodologyDesc || hasMethodologyParams) {
      this.logger.warn(
        `[ToolDescriptionLoader] Config contains methodology-specific entries for ${toolName}; YAML overlays are the sole source of truth. Config methodology entries are ignored.`
      );
    }
  }

  private async readToolDescriptionsConfig(
    filePath: string
  ): Promise<ToolDescriptionsConfig | undefined> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const config: ToolDescriptionsConfig = JSON.parse(content);

      if (!config.tools || typeof config.tools !== 'object') {
        throw new Error('Invalid tool descriptions config: missing or invalid tools section');
      }

      return config;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        this.logger.warn(
          `[ToolDescriptionLoader] Unable to read tool descriptions from ${filePath}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      return undefined;
    }
  }

  private async loadBaseConfig(): Promise<{
    config: ToolDescriptionsConfig;
    source: 'contracts' | 'defaults';
  }> {
    const generated = await this.readToolDescriptionsConfig(this.configPath);
    if (generated) {
      return { config: generated, source: 'contracts' };
    }

    this.logger.warn(
      `[ToolDescriptionLoader] Generated tool-descriptions.contracts.json not found at ${this.configPath}. ` +
        `Run 'npm run generate:contracts' to generate from contracts. Using in-memory defaults.`
    );
    return {
      config: {
        version: '2.0.0',
        lastUpdated: new Date().toISOString(),
        generatedFrom: 'defaults',
        tools: Object.fromEntries(
          Array.from(this.defaults.entries()).map(([name, description]) => [
            name,
            cloneToolDescription(description),
          ])
        ),
      },
      source: 'defaults',
    };
  }

  private setDescriptionsFromConfig(config: ToolDescriptionsConfig): void {
    this.descriptions.clear();
    for (const [name, description] of Object.entries(config.tools)) {
      this.warnOnMethodologyConfigLeak(name, description);
      this.descriptions.set(name, cloneToolDescription(description));
    }
  }

  private getActiveFrameworkContext(): {
    activeFramework?: string;
    activeMethodology?: string;
    frameworkSystemEnabled?: boolean;
  } {
    if (!this.frameworkStateStore) {
      return {};
    }

    try {
      const state = this.frameworkStateStore.getCurrentState();
      const activeFramework = this.frameworkStateStore.getActiveFramework();

      return {
        activeFramework: activeFramework?.id,
        activeMethodology: activeFramework?.type ?? activeFramework?.id,
        frameworkSystemEnabled: state?.frameworkSystemEnabled,
      };
    } catch (error) {
      this.logger.warn(
        `[ToolDescriptionLoader] Unable to read framework state for tool descriptions: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return {};
    }
  }

  getStyleResponseFormat(toolName: string, styleId: string): string | undefined {
    const styleDescs = this.styleDescriptions.get(styleId.toLowerCase());
    return styleDescs?.[toolName]?.responseFormat;
  }

  hasMethodologyResponseFormat(toolName: string): boolean {
    const context = this.getActiveFrameworkContext();
    const methodologyKey = normalizeMethodologyKey(
      context.activeMethodology ?? context.activeFramework
    );
    if (!methodologyKey) return false;

    const frameworkDescs = this.frameworkDescriptions.get(methodologyKey);
    const tool = frameworkDescs?.[toolName as keyof FrameworkToolDescriptions];
    return Boolean(tool?.responseFormat);
  }

  private async synchronize(reason: string, options?: { emitChange?: boolean }): Promise<void> {
    try {
      const base = await this.loadBaseConfig();
      this.lastLoadSource = base.source;
      this.frameworkDescriptions = preloadMethodologyDescriptions(this.logger);
      this.styleDescriptions = preloadStyleDescriptions(this.logger);
      const activeContext = this.getActiveFrameworkContext();
      const dynamicEnabled =
        this.frameworksConfig.dynamicToolDescriptions &&
        (activeContext.frameworkSystemEnabled ?? true);
      const activeConfig = buildActiveConfig(
        base.config,
        activeContext,
        this.frameworkDescriptions,
        dynamicEnabled
      );
      activeConfig.generatedFrom = base.source;

      this.setDescriptionsFromConfig(activeConfig);
      this.isInitialized = true;

      this.logger.info(
        `Synchronized tool descriptions (${reason}); source=${base.source}, framework=${activeContext.activeFramework || 'n/a'}, methodology=${activeContext.activeMethodology || 'n/a'}`
      );

      if (options?.emitChange ?? true) {
        this.emit('descriptions-changed', this.getStats());
      }
    } catch (error) {
      this.logger.error(
        `[ToolDescriptionLoader] Failed to synchronize tool descriptions: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      this.descriptions = new Map(this.defaults);
      this.lastLoadSource = 'defaults';
      this.isInitialized = true;
      if (options?.emitChange ?? true) {
        this.emit('descriptions-error', error);
      }
    }
  }

  setFrameworkStateStore(frameworkStateStore: FrameworkStateStore): void {
    if (this.frameworkStateStore === frameworkStateStore) {
      return;
    }

    if (this.frameworkStateStore && this.frameworkSwitchedListener) {
      this.frameworkStateStore.off('framework-switched', this.frameworkSwitchedListener);
    }
    if (this.frameworkStateStore && this.frameworkToggledListener) {
      this.frameworkStateStore.off('framework-system-toggled', this.frameworkToggledListener);
    }

    this.frameworkStateStore = frameworkStateStore;

    this.frameworkSwitchedListener = async (_prev, _next, reason) => {
      await this.synchronize(`framework switched: ${reason}`);
    };
    this.frameworkToggledListener = async (enabled, reason) => {
      await this.synchronize(`framework system ${enabled ? 'enabled' : 'disabled'}: ${reason}`);
    };

    this.frameworkStateStore.on('framework-switched', this.frameworkSwitchedListener);
    this.frameworkStateStore.on('framework-system-toggled', this.frameworkToggledListener);
  }

  async initialize(): Promise<void> {
    await this.synchronize('initial load', { emitChange: false });
  }

  getDescription(
    toolName: string,
    frameworkEnabled?: boolean,
    activeMethodology?: string,
    options?: { applyMethodologyOverride?: boolean }
  ): string {
    const toolDesc = this.descriptions.get(toolName) || this.defaults.get(toolName);
    if (!toolDesc) {
      this.logger.warn(`No description found for tool: ${toolName}`);
      return `Tool: ${toolName}`;
    }

    if (!this.frameworksConfig.dynamicToolDescriptions) {
      this.logger.debug(
        `Dynamic tool descriptions disabled; using base description for ${toolName}`
      );
      return toolDesc.description;
    }

    const applyMethodologyOverride = options?.applyMethodologyOverride ?? true;
    this.logger.debug(
      `Getting description for ${toolName} (framework: ${frameworkEnabled}, methodology: ${activeMethodology})`
    );
    const methodologyKey = normalizeMethodologyKey(activeMethodology);

    // PRIORITY 1: Methodology-specific descriptions from YAML guides (SOT)
    if (applyMethodologyOverride && methodologyKey) {
      const frameworkDescs = this.frameworkDescriptions.get(methodologyKey);
      if (frameworkDescs?.[toolName as keyof FrameworkToolDescriptions]?.description) {
        const frameworkDesc =
          frameworkDescs[toolName as keyof FrameworkToolDescriptions]!.description!;
        this.logger.debug(
          `Using methodology-specific description from ${activeMethodology ?? methodologyKey} guide for ${toolName}`
        );
        return frameworkDesc;
      }
    }

    // PRIORITY 2: Framework-aware descriptions from config
    if (frameworkEnabled !== undefined && toolDesc.frameworkAware) {
      if (frameworkEnabled && toolDesc.frameworkAware.enabled) {
        return toolDesc.frameworkAware.enabled;
      } else if (!frameworkEnabled && toolDesc.frameworkAware.disabled) {
        return toolDesc.frameworkAware.disabled;
      }
    }

    // PRIORITY 3: Base config descriptions
    return toolDesc.description;
  }

  getParameterDescription(
    toolName: string,
    paramName: string,
    frameworkEnabled?: boolean,
    activeMethodology?: string,
    options?: { applyMethodologyOverride?: boolean }
  ): string | undefined {
    const toolDesc = this.descriptions.get(toolName) || this.defaults.get(toolName);
    if (!toolDesc) {
      return undefined;
    }

    if (!this.frameworksConfig.dynamicToolDescriptions) {
      const param = toolDesc.parameters?.[paramName];
      return typeof param === 'string' ? param : param?.description;
    }

    const applyMethodologyOverride = options?.applyMethodologyOverride ?? true;
    if (!toolDesc.parameters) return undefined;
    const methodologyKey = normalizeMethodologyKey(activeMethodology);

    if (applyMethodologyOverride && methodologyKey) {
      const frameworkDescs = this.frameworkDescriptions.get(methodologyKey);
      const frameworkTool = frameworkDescs?.[toolName as keyof FrameworkToolDescriptions];
      if (frameworkTool?.parameters?.[paramName]) {
        const param = frameworkTool.parameters[paramName];
        return typeof param === 'string' ? param : param?.description;
      }
    }

    if (frameworkEnabled !== undefined && toolDesc.frameworkAware) {
      const frameworkParams = frameworkEnabled
        ? toolDesc.frameworkAware.parametersEnabled
        : toolDesc.frameworkAware.parametersDisabled;

      if (frameworkParams?.[paramName]) {
        const param = frameworkParams[paramName];
        return typeof param === 'string' ? param : param?.description;
      }
    }

    const param = toolDesc.parameters[paramName];
    return typeof param === 'string' ? param : param?.description;
  }

  getAvailableTools(): string[] {
    return Array.from(this.descriptions.keys());
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  getStats(): {
    totalDescriptions: number;
    loadedFromFile: number;
    usingDefaults: number;
    configPath: string;
    isInitialized: boolean;
    source: string;
  } {
    const loadedFromFile = this.lastLoadSource === 'defaults' ? 0 : this.descriptions.size || 0;
    const defaultCount = this.defaults.size;
    const usingDefaults = this.lastLoadSource === 'defaults' ? defaultCount : 0;

    return {
      totalDescriptions: this.descriptions.size,
      loadedFromFile,
      usingDefaults,
      configPath: this.configPath,
      isInitialized: this.isInitialized,
      source: this.lastLoadSource,
    };
  }

  async reload(): Promise<void> {
    await this.synchronize('reload');
  }

  shutdown(): void {
    if (this.frameworksConfigListener) {
      this.configManager.off('frameworksConfigChanged', this.frameworksConfigListener);
    }
    if (this.frameworkStateStore && this.frameworkSwitchedListener) {
      this.frameworkStateStore.off('framework-switched', this.frameworkSwitchedListener);
    }
    if (this.frameworkStateStore && this.frameworkToggledListener) {
      this.frameworkStateStore.off('framework-system-toggled', this.frameworkToggledListener);
    }
    this.removeAllListeners();
  }
}

export function createToolDescriptionLoader(
  logger: Logger,
  configManager: ConfigManager
): ToolDescriptionLoader {
  return new ToolDescriptionLoader(logger, configManager);
}

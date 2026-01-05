// @lifecycle canonical - Manages MCP tool descriptions and discovery metadata.
/**
 * Tool Description Manager
 *
 * Manages externalized tool descriptions with graceful fallback to defaults.
 * Methodology-specific overlays are sourced solely from runtime YAML definitions (SOT); config
 * may define baseline/non-methodology text but methodology entries are ignored (warned).
 * Follows established ConfigManager pattern for consistency with existing architecture.
 */

import { EventEmitter } from 'events';
import { watch, FSWatcher } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { ConfigManager } from '../config/index.js';
import { FrameworkStateManager } from '../frameworks/framework-state-manager.js';
import { getDefaultRuntimeLoader, createGenericGuide } from '../frameworks/methodology/index.js';
import { MethodologyToolDescriptions } from '../frameworks/types/index.js';
import { Logger } from '../logging/index.js';

import type { ToolDescription, ToolDescriptionsConfig, FrameworksConfig } from '../types/index.js';

/**
 * @deprecated Emergency fallback only - do not edit.
 * Primary source of truth is tool-descriptions.contracts.json generated from tooling/contracts/*.json.
 * Run `npm run generate:contracts` to regenerate from contracts.
 * These defaults exist only as emergency fallback when generated artifacts are missing.
 */
const DEFAULT_TOOL_DESCRIPTION_ENTRIES: Array<[string, ToolDescription]> = [
  [
    'prompt_engine',
    {
      description:
        '🚀 PROMPT ENGINE: Executes prompts/chains with % modifiers and unified gates. Start with real prompt ids (no invented labels); list/inspect via resource_manager(resource_type:"prompt", action:"list") when unsure. Inline gates via `::`; frameworks via `@`; `%clean`/`%lean` disable framework injection. Use `>>guide <topic>` only when you need help.',
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

function cloneToolDescription(description: ToolDescription): ToolDescription {
  const cloned: ToolDescription = { ...description };

  if (description.parameters) {
    cloned.parameters = { ...description.parameters };
  }

  if (description.frameworkAware) {
    const frameworkAware = { ...description.frameworkAware };

    if (description.frameworkAware.methodologies) {
      frameworkAware.methodologies = { ...description.frameworkAware.methodologies };
    }
    if (description.frameworkAware.parametersEnabled) {
      frameworkAware.parametersEnabled = { ...description.frameworkAware.parametersEnabled };
    }
    if (description.frameworkAware.parametersDisabled) {
      frameworkAware.parametersDisabled = { ...description.frameworkAware.parametersDisabled };
    }
    if (description.frameworkAware.methodologyParameters) {
      frameworkAware.methodologyParameters = {
        ...description.frameworkAware.methodologyParameters,
      };
    }

    cloned.frameworkAware = frameworkAware;
  }

  return cloned;
}

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
 * Manages tool descriptions loaded from external configuration with hot-reload support
 */
export class ToolDescriptionManager extends EventEmitter {
  private logger: Logger;
  private configPath: string;
  private activeConfigPath: string;
  private fallbackConfigPath: string;
  private legacyFallbackPath: string;
  private descriptions: Map<string, ToolDescription>;
  private defaults: Map<string, ToolDescription>;
  private methodologyDescriptions: Map<string, MethodologyToolDescriptions>;
  private isInitialized: boolean = false;
  private fileWatcher: FSWatcher | undefined;
  private isWatching: boolean = false;
  private reloadDebounceTimer: NodeJS.Timeout | undefined;
  private configManager: ConfigManager;
  private frameworksConfig: FrameworksConfig;
  private frameworksConfigListener: (
    newConfig: FrameworksConfig,
    previousConfig: FrameworksConfig
  ) => void;
  private frameworkStateManager?: FrameworkStateManager;
  private lastLoadSource: 'active' | 'fallback' | 'legacy' | 'defaults' = 'defaults';
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
    // Generated from contracts - single source of truth
    this.configPath = path.join(
      serverRoot,
      'src',
      'tooling',
      'contracts',
      '_generated',
      'tool-descriptions.contracts.json'
    );
    // Active overlays are derived at runtime and should not overwrite generated artifacts.
    // Persist the active snapshot under runtime-state/ (gitignored).
    this.activeConfigPath = path.join(serverRoot, 'runtime-state', 'tool-descriptions.active.json');
    this.fallbackConfigPath = this.configPath; // No separate fallback - contracts are SSOT
    this.legacyFallbackPath = this.configPath;
    this.descriptions = new Map();
    this.defaults = this.createDefaults();
    this.methodologyDescriptions = new Map();
    this.frameworksConfig = this.configManager.getFrameworksConfig();

    this.frameworksConfigListener = (newConfig: FrameworksConfig) => {
      this.frameworksConfig = { ...newConfig };
      this.logger.info(
        `Tool description manager feature toggle updated (dynamicDescriptions: ${this.frameworksConfig.dynamicToolDescriptions})`
      );
      if (this.isInitialized) {
        void this.synchronizeActiveConfig(
          'Framework feature config changed (dynamic tool descriptions toggle)'
        );
      }
    };

    this.configManager.on('frameworksConfigChanged', this.frameworksConfigListener);
  }

  /**
   * Normalize methodology keys for consistent lookup (case-insensitive)
   */
  private normalizeMethodologyKey(methodology?: string): string | undefined {
    if (!methodology) return undefined;
    return methodology.trim().toUpperCase();
  }

  /**
   * Create default descriptions as fallback
   */
  private createDefaults(): Map<string, ToolDescription> {
    return createDefaultToolDescriptionMap();
  }

  /**
   * Warn if config attempts to define methodology-specific overlays (YAML is SOT for methodology).
   */
  private warnOnMethodologyConfigLeak(toolName: string, description: ToolDescription): void {
    const hasMethodologyDesc = Boolean(description.frameworkAware?.methodologies);
    const hasMethodologyParams = Boolean(description.frameworkAware?.methodologyParameters);
    if (hasMethodologyDesc || hasMethodologyParams) {
      this.logger.warn(
        `[ToolDescriptionManager] Config contains methodology-specific entries for ${toolName}; YAML overlays are the sole source of truth. Config methodology entries are ignored.`
      );
    }
  }

  /**
   * Pre-load all methodology descriptions for dynamic switching
   * Uses RuntimeMethodologyLoader for YAML-based methodology loading
   */
  private preloadMethodologyDescriptions(): void {
    try {
      this.methodologyDescriptions.clear();
      const loader = getDefaultRuntimeLoader();
      const methodologyIds = loader.discoverMethodologies();

      for (const id of methodologyIds) {
        const definition = loader.loadMethodology(id);
        if (!definition) continue;

        const guide = createGenericGuide(definition);
        const descriptions = guide.getToolDescriptions?.() || {};
        const methodologyKey = this.normalizeMethodologyKey(guide.type);
        const frameworkKey = this.normalizeMethodologyKey(guide.frameworkId);

        if (methodologyKey) {
          this.methodologyDescriptions.set(methodologyKey, descriptions);
        }

        if (frameworkKey) {
          this.methodologyDescriptions.set(frameworkKey, descriptions);
        }
      }

      this.logger.info(
        `✅ Pre-loaded tool descriptions for ${this.methodologyDescriptions.size} methodologies from YAML (SOT)`
      );
    } catch (error) {
      this.logger.error(
        `Failed to pre-load methodology descriptions: ${error instanceof Error ? error.message : String(error)}`
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
          `[ToolDescriptionManager] Unable to read tool descriptions from ${filePath}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      return undefined;
    }
  }

  private createConfigFromMap(
    sourceMap: Map<string, ToolDescription>,
    source: 'defaults' | 'fallback' | 'legacy'
  ): ToolDescriptionsConfig {
    return {
      version: '2.0.0',
      lastUpdated: new Date().toISOString(),
      generatedFrom: source,
      tools: Object.fromEntries(
        Array.from(sourceMap.entries()).map(([name, description]) => [
          name,
          cloneToolDescription(description),
        ])
      ),
    };
  }

  private async loadBaseConfig(): Promise<{
    config: ToolDescriptionsConfig;
    source: 'active' | 'fallback' | 'legacy' | 'defaults';
    path: string;
  }> {
    // Load from generated tool-descriptions.contracts.json (contracts are SSOT)
    const generated = await this.readToolDescriptionsConfig(this.configPath);
    if (generated) {
      return { config: generated, source: 'active', path: this.configPath };
    }

    // Fallback to in-memory defaults if generated file missing
    // This should only happen if contracts weren't generated - run `npm run generate:contracts`
    this.logger.warn(
      `[ToolDescriptionManager] Generated tool-descriptions.contracts.json not found at ${this.configPath}. ` +
        `Run 'npm run generate:contracts' to generate from contracts. Using in-memory defaults.`
    );
    return {
      config: this.createConfigFromMap(this.defaults, 'defaults'),
      source: 'defaults',
      path: '<defaults>',
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
    if (!this.frameworkStateManager) {
      return {};
    }

    try {
      const state = this.frameworkStateManager.getCurrentState();
      const activeFramework = this.frameworkStateManager.getActiveFramework();

      return {
        activeFramework: activeFramework?.id,
        activeMethodology: activeFramework?.type ?? activeFramework?.id,
        frameworkSystemEnabled: state?.frameworkSystemEnabled,
      };
    } catch (error) {
      this.logger.warn(
        `[ToolDescriptionManager] Unable to read framework state for tool descriptions: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return {};
    }
  }

  private buildActiveConfig(
    baseConfig: ToolDescriptionsConfig,
    activeContext: {
      activeFramework?: string;
      activeMethodology?: string;
      frameworkSystemEnabled?: boolean;
    }
  ): ToolDescriptionsConfig {
    const methodologyKey = this.normalizeMethodologyKey(
      activeContext.activeMethodology ?? activeContext.activeFramework
    );
    const dynamicDescriptionsEnabled =
      this.frameworksConfig.dynamicToolDescriptions &&
      (activeContext.frameworkSystemEnabled ?? true);

    const tools: Record<string, ToolDescription> = {};
    for (const [name, description] of Object.entries(baseConfig.tools)) {
      const baseDescription = cloneToolDescription(description);

      if (dynamicDescriptionsEnabled && methodologyKey) {
        const methodologyDescs = this.methodologyDescriptions.get(methodologyKey);
        const methodologyTool =
          methodologyDescs?.[name as keyof MethodologyToolDescriptions] || undefined;

        if (methodologyTool?.description) {
          baseDescription.description = methodologyTool.description;
        }

        if (methodologyTool?.parameters) {
          baseDescription.parameters = {
            ...baseDescription.parameters,
            ...methodologyTool.parameters,
          };
        }
      }

      tools[name] = baseDescription;
    }

    const generatedConfig: ToolDescriptionsConfig = {
      ...baseConfig,
      tools,
      generatedAt: new Date().toISOString(),
      generatedFrom: baseConfig.generatedFrom ?? 'fallback',
    };

    if (activeContext.activeFramework) {
      generatedConfig.activeFramework = activeContext.activeFramework;
    }
    if (activeContext.activeMethodology) {
      generatedConfig.activeMethodology = activeContext.activeMethodology;
    }

    return generatedConfig;
  }

  private async maybePersistActiveConfig(config: ToolDescriptionsConfig): Promise<boolean> {
    try {
      const serialized = JSON.stringify(config, null, 2);
      let existing: string | undefined;
      try {
        existing = await fs.readFile(this.activeConfigPath, 'utf-8');
      } catch (error: any) {
        if (error?.code !== 'ENOENT') {
          this.logger.warn(
            `[ToolDescriptionManager] Unable to read active tool descriptions before write: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      if (existing && existing.trim() === serialized.trim()) {
        return false;
      }

      await fs.mkdir(path.dirname(this.activeConfigPath), { recursive: true });
      await fs.writeFile(this.activeConfigPath, serialized, 'utf-8');
      this.logger.info(
        `💾 Wrote active tool descriptions to ${this.activeConfigPath} (framework: ${config.activeFramework || 'n/a'}, methodology: ${config.activeMethodology || 'n/a'})`
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `[ToolDescriptionManager] Failed to persist active tool descriptions: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }

  private async synchronizeActiveConfig(
    reason: string,
    options?: { emitChange?: boolean }
  ): Promise<void> {
    try {
      const base = await this.loadBaseConfig();
      this.lastLoadSource = base.source;
      this.preloadMethodologyDescriptions();
      const activeContext = this.getActiveFrameworkContext();
      const activeConfig = this.buildActiveConfig(base.config, activeContext);
      activeConfig.generatedFrom = base.source;

      await this.maybePersistActiveConfig(activeConfig);
      this.setDescriptionsFromConfig(activeConfig);
      this.isInitialized = true;

      this.logger.info(
        `✅ Synchronized tool descriptions (${reason}); source=${base.source}, framework=${activeContext.activeFramework || 'n/a'}, methodology=${activeContext.activeMethodology || 'n/a'}`
      );

      if (options?.emitChange ?? true) {
        this.emit('descriptions-changed', this.getStats());
      }
    } catch (error) {
      this.logger.error(
        `[ToolDescriptionManager] Failed to synchronize tool descriptions: ${
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

  setFrameworkStateManager(frameworkStateManager: FrameworkStateManager): void {
    if (this.frameworkStateManager === frameworkStateManager) {
      return;
    }

    // Clean up old listeners if re-binding
    if (this.frameworkStateManager && this.frameworkSwitchedListener) {
      this.frameworkStateManager.off('framework-switched', this.frameworkSwitchedListener);
    }
    if (this.frameworkStateManager && this.frameworkToggledListener) {
      this.frameworkStateManager.off('framework-system-toggled', this.frameworkToggledListener);
    }

    this.frameworkStateManager = frameworkStateManager;

    this.frameworkSwitchedListener = async (_prev, _next, reason) => {
      await this.synchronizeActiveConfig(`framework switched: ${reason}`);
    };
    this.frameworkToggledListener = async (enabled, reason) => {
      await this.synchronizeActiveConfig(
        `framework system ${enabled ? 'enabled' : 'disabled'}: ${reason}`
      );
    };

    this.frameworkStateManager.on('framework-switched', this.frameworkSwitchedListener);
    this.frameworkStateManager.on('framework-system-toggled', this.frameworkToggledListener);
  }

  /**
   * Initialize by loading descriptions from external config file
   */
  async initialize(): Promise<void> {
    await this.synchronizeActiveConfig('initial load', { emitChange: false });
  }

  /**
   * Get description for a specific tool with corrected priority hierarchy
   */
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
    const methodologyKey = this.normalizeMethodologyKey(activeMethodology);
    const methodologyLogName = activeMethodology ?? methodologyKey;

    // PRIORITY 1: Methodology-specific descriptions from YAML guides (SOT, HIGHEST PRIORITY)
    if (applyMethodologyOverride && methodologyKey) {
      const methodologyDescs = this.methodologyDescriptions.get(methodologyKey);
      if (methodologyDescs?.[toolName as keyof MethodologyToolDescriptions]?.description) {
        const methodologyDesc =
          methodologyDescs[toolName as keyof MethodologyToolDescriptions]!.description!;
        this.logger.debug(
          `✅ Using methodology-specific description from ${methodologyLogName} guide for ${toolName}`
        );
        return methodologyDesc;
      }
      this.logger.debug(
        `⚠️ No methodology-specific description found for ${toolName} in ${methodologyLogName} guide`
      );
    }

    // PRIORITY 2: Framework-aware descriptions from config (if methodology desc not available)
    if (frameworkEnabled !== undefined && toolDesc.frameworkAware) {
      if (frameworkEnabled && toolDesc.frameworkAware.enabled) {
        this.logger.debug(
          `✅ Using framework-aware enabled description from config for ${toolName}`
        );
        return toolDesc.frameworkAware.enabled;
      } else if (!frameworkEnabled && toolDesc.frameworkAware.disabled) {
        this.logger.debug(
          `✅ Using framework-aware disabled description from config for ${toolName}`
        );
        return toolDesc.frameworkAware.disabled;
      }
    }

    // PRIORITY 3: Basic config file descriptions (LOWER PRIORITY)
    this.logger.debug(`✅ Using basic config/default description for ${toolName}`);
    return toolDesc.description;
  }

  /**
   * Get parameter description for a specific tool parameter
   */
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
    const methodologyKey = this.normalizeMethodologyKey(activeMethodology);

    // Check for methodology-specific parameter descriptions first (from YAML SOT cache)
    if (applyMethodologyOverride && methodologyKey) {
      const methodologyDescs = this.methodologyDescriptions.get(methodologyKey);
      const methodologyTool = methodologyDescs?.[toolName as keyof MethodologyToolDescriptions];
      if (methodologyTool?.parameters?.[paramName]) {
        const param = methodologyTool.parameters[paramName];
        return typeof param === 'string' ? param : param?.description;
      }
    }

    // Check for framework-aware parameter descriptions
    if (frameworkEnabled !== undefined && toolDesc.frameworkAware) {
      const frameworkParams = frameworkEnabled
        ? toolDesc.frameworkAware.parametersEnabled
        : toolDesc.frameworkAware.parametersDisabled;

      if (frameworkParams?.[paramName]) {
        const param = frameworkParams[paramName];
        return typeof param === 'string' ? param : param?.description;
      }
    }

    // Fall back to default parameters
    const param = toolDesc.parameters[paramName];
    return typeof param === 'string' ? param : param?.description;
  }

  /**
   * Get all available tool names
   */
  getAvailableTools(): string[] {
    return Array.from(this.descriptions.keys());
  }

  /**
   * Check if manager is properly initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Get configuration path for debugging
   */
  getConfigPath(): string {
    return this.activeConfigPath;
  }

  /**
   * Get statistics about loaded descriptions
   */
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
      configPath: this.activeConfigPath,
      isInitialized: this.isInitialized,
      source: this.lastLoadSource,
    };
  }

  /**
   * Start watching the tool descriptions file for changes
   */
  startWatching(): void {
    if (this.isWatching) {
      this.logger.debug('Tool description file watcher already active');
      return;
    }

    try {
      this.logger.info(`🔍 Starting file watcher for tool descriptions: ${this.activeConfigPath}`);

      this.fileWatcher = watch(this.activeConfigPath, (eventType) => {
        if (eventType === 'change') {
          this.handleFileChange();
        }
      });

      this.fileWatcher.on('error', (error) => {
        this.logger.error(`Tool description file watcher error: ${error.message}`);
        this.isWatching = false;
      });

      this.isWatching = true;
      this.logger.info('✅ Tool description hot-reload watcher started successfully');
    } catch (error) {
      this.logger.error(
        `Failed to start tool description file watcher: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Stop watching the tool descriptions file
   */
  stopWatching(): void {
    if (this.fileWatcher) {
      this.logger.info('🛑 Stopping tool description file watcher...');
      this.fileWatcher.close();
      this.fileWatcher = undefined;
    }

    if (this.reloadDebounceTimer) {
      clearTimeout(this.reloadDebounceTimer);
      this.reloadDebounceTimer = undefined;
    }

    this.isWatching = false;
    this.logger.info('✅ Tool description file watcher stopped');
  }

  /**
   * Handle file change event with debouncing
   */
  private handleFileChange(): void {
    // Clear existing timer to debounce rapid file changes
    if (this.reloadDebounceTimer) {
      clearTimeout(this.reloadDebounceTimer);
    }

    // Debounce file changes (wait 500ms after last change)
    this.reloadDebounceTimer = setTimeout(async () => {
      try {
        this.logger.info('📝 Tool descriptions file changed, reloading...');
        await this.reload();
        this.emit('descriptions-changed', this.getStats());
        this.logger.info('✅ Tool descriptions reloaded successfully');
      } catch (error) {
        this.logger.error(
          `Failed to reload tool descriptions: ${error instanceof Error ? error.message : String(error)}`
        );
        this.emit('descriptions-error', error);
      }
    }, 500);
  }

  /**
   * Reload descriptions from file
   */
  async reload(): Promise<void> {
    await this.synchronizeActiveConfig('file change');
  }

  /**
   * Check if file watching is active
   */
  isWatchingFile(): boolean {
    return this.isWatching;
  }

  /**
   * Cleanup resources on shutdown
   */
  shutdown(): void {
    this.stopWatching();
    if (this.frameworksConfigListener) {
      this.configManager.off('frameworksConfigChanged', this.frameworksConfigListener);
    }
    if (this.frameworkStateManager && this.frameworkSwitchedListener) {
      this.frameworkStateManager.off('framework-switched', this.frameworkSwitchedListener);
    }
    if (this.frameworkStateManager && this.frameworkToggledListener) {
      this.frameworkStateManager.off('framework-system-toggled', this.frameworkToggledListener);
    }
    this.removeAllListeners();
  }
}

/**
 * Factory function following established pattern
 */
export function createToolDescriptionManager(
  logger: Logger,
  configManager: ConfigManager
): ToolDescriptionManager {
  return new ToolDescriptionManager(logger, configManager);
}

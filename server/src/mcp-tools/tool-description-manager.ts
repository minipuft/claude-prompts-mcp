// @lifecycle canonical - Manages MCP tool descriptions and discovery metadata.
/**
 * Tool Description Manager
 *
 * Manages externalized tool descriptions with graceful fallback to defaults.
 * Follows established ConfigManager pattern for consistency with existing architecture.
 */

import { EventEmitter } from 'events';
import { watch, FSWatcher } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { ConfigManager } from '../config/index.js';
import {
  CAGEERFMethodologyGuide,
  ReACTMethodologyGuide,
  FiveW1HMethodologyGuide,
  SCAMPERMethodologyGuide,
} from '../frameworks/methodology/index.js';
import { MethodologyToolDescriptions } from '../frameworks/types/index.js';
import { Logger } from '../logging/index.js';

import type { ToolDescription, ToolDescriptionsConfig, FrameworksConfig } from '../types/index.js';

const DEFAULT_TOOL_DESCRIPTION_ENTRIES: Array<[string, ToolDescription]> = [
  [
    'prompt_engine',
    {
      description:
        '🚀 PROMPT ENGINE [HOT-RELOAD]: Processes Nunjucks templates, returns executable instructions. WARNING: Output contains instructions YOU must execute (code gen, analysis, multi-step tasks) - not just information. IMPORTANT: Prompt names are case-insensitive and hyphens are converted to underscores. When your arguments include newlines or multi-line payloads, wrap the call in JSON so the parser receives a single-line command shell.',
      shortDescription: 'Execute prompts, templates, and chains',
      category: 'execution',
    },
  ],
  [
    'prompt_manager',
    {
      description:
        '🧰 PROMPT MANAGER: Create, update, delete, list, and analyze prompts. Supports gate configuration, temporary gates, and prompt-type migration for full lifecycle control.',
      shortDescription: 'Manage prompt lifecycle, gates, and discovery',
      category: 'management',
    },
  ],
  [
    'system_control',
    {
      description:
        '⚙️ SYSTEM CONTROL: Unified interface for status reporting, framework and gate controls, analytics, configuration management, and maintenance operations.',
      shortDescription: 'Manage framework state, metrics, and maintenance',
      category: 'system',
    },
  ],
];

function cloneToolDescription(description: ToolDescription): ToolDescription {
  return {
    ...description,
    parameters: description.parameters ? { ...description.parameters } : undefined,
    frameworkAware: description.frameworkAware
      ? {
          ...description.frameworkAware,
          methodologies: description.frameworkAware.methodologies
            ? { ...description.frameworkAware.methodologies }
            : undefined,
          parametersEnabled: description.frameworkAware.parametersEnabled
            ? { ...description.frameworkAware.parametersEnabled }
            : undefined,
          parametersDisabled: description.frameworkAware.parametersDisabled
            ? { ...description.frameworkAware.parametersDisabled }
            : undefined,
          methodologyParameters: description.frameworkAware.methodologyParameters
            ? { ...description.frameworkAware.methodologyParameters }
            : undefined,
        }
      : undefined,
  };
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
  private descriptions: Map<string, ToolDescription>;
  private defaults: Map<string, ToolDescription>;
  private methodologyDescriptions: Map<string, MethodologyToolDescriptions>;
  private isInitialized: boolean = false;
  private fileWatcher?: FSWatcher;
  private isWatching: boolean = false;
  private reloadDebounceTimer?: NodeJS.Timeout;
  private configManager: ConfigManager;
  private frameworksConfig: FrameworksConfig;
  private frameworksConfigListener: (
    newConfig: FrameworksConfig,
    previousConfig: FrameworksConfig
  ) => void;

  constructor(logger: Logger, configManager: ConfigManager) {
    super();
    this.logger = logger;
    this.configManager = configManager;
    this.configPath = path.join(configManager.getServerRoot(), 'config', 'tool-descriptions.json');
    this.descriptions = new Map();
    this.defaults = this.createDefaults();
    this.methodologyDescriptions = new Map();
    this.frameworksConfig = this.configManager.getFrameworksConfig();

    this.frameworksConfigListener = (newConfig: FrameworksConfig) => {
      this.frameworksConfig = { ...newConfig };
      this.logger.info(
        `Tool description manager feature toggle updated (dynamicDescriptions: ${this.frameworksConfig.enableDynamicToolDescriptions})`
      );
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
   * Pre-load all methodology descriptions for dynamic switching
   */
  private preloadMethodologyDescriptions(): void {
    try {
      // Initialize all methodology guides
      const guides = [
        new CAGEERFMethodologyGuide(),
        new ReACTMethodologyGuide(),
        new FiveW1HMethodologyGuide(),
        new SCAMPERMethodologyGuide(),
      ];

      // Pre-load tool descriptions for each methodology using normalized keys
      for (const guide of guides) {
        const descriptions = guide.getToolDescriptions?.() || {};
        const methodologyKey = this.normalizeMethodologyKey(guide.methodology);
        const frameworkKey = this.normalizeMethodologyKey(guide.frameworkId);

        if (methodologyKey) {
          this.methodologyDescriptions.set(methodologyKey, descriptions);
        }

        if (frameworkKey) {
          this.methodologyDescriptions.set(frameworkKey, descriptions);
        }
      }

      this.logger.info(
        `✅ Pre-loaded tool descriptions for ${this.methodologyDescriptions.size} methodologies`
      );
    } catch (error) {
      this.logger.error(
        `Failed to pre-load methodology descriptions: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Initialize by loading descriptions from external config file
   */
  async initialize(): Promise<void> {
    try {
      this.logger.info(`Loading tool descriptions from ${this.configPath}...`);
      const content = await fs.readFile(this.configPath, 'utf-8');
      const config: ToolDescriptionsConfig = JSON.parse(content);

      // Validate config structure
      if (!config.tools || typeof config.tools !== 'object') {
        throw new Error('Invalid tool descriptions config: missing or invalid tools section');
      }

      // Load descriptions
      this.descriptions.clear();
      for (const [name, description] of Object.entries(config.tools)) {
        this.descriptions.set(name, description);
      }

      this.isInitialized = true;
      this.logger.info(
        `✅ Loaded ${this.descriptions.size} tool descriptions from external config (version: ${config.version})`
      );

      // Pre-load methodology descriptions for dynamic switching
      this.preloadMethodologyDescriptions();
    } catch (error) {
      this.logger.warn(
        `⚠️ Failed to load tool descriptions from ${this.configPath}: ${error instanceof Error ? error.message : String(error)}`
      );
      this.logger.info('🔄 Using hardcoded default descriptions as fallback');

      // Use defaults as fallback
      this.descriptions = new Map(this.defaults);
      this.isInitialized = true;

      // Pre-load methodology descriptions for dynamic switching
      this.preloadMethodologyDescriptions();
    }
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

    if (!this.frameworksConfig.enableDynamicToolDescriptions) {
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

    // PRIORITY 1: Methodology-specific descriptions from guides (HIGHEST PRIORITY)
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

      // Check for static methodology descriptions in config as fallback
      if (frameworkEnabled && methodologyKey && toolDesc.frameworkAware?.methodologies) {
        const configMethodologyDescription =
          toolDesc.frameworkAware.methodologies[methodologyKey] ??
          (activeMethodology
            ? toolDesc.frameworkAware.methodologies[activeMethodology]
            : undefined);
        if (configMethodologyDescription) {
          this.logger.debug(
            `✅ Using static methodology description from config for ${toolName} (${methodologyLogName})`
          );
          return configMethodologyDescription;
        }
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

    if (!this.frameworksConfig.enableDynamicToolDescriptions) {
      const param = toolDesc.parameters?.[paramName];
      return typeof param === 'string' ? param : param?.description;
    }

    const applyMethodologyOverride = options?.applyMethodologyOverride ?? true;
    if (!toolDesc.parameters) return undefined;
    const methodologyKey = this.normalizeMethodologyKey(activeMethodology);

    // Check for methodology-specific parameter descriptions first (from pre-loaded cache)
    if (applyMethodologyOverride && methodologyKey) {
      const methodologyDescs = this.methodologyDescriptions.get(methodologyKey);
      const methodologyTool = methodologyDescs?.[toolName as keyof MethodologyToolDescriptions];
      if (methodologyTool?.parameters?.[paramName]) {
        return methodologyTool.parameters[paramName];
      }
      // Fallback to static config if available
      const methodologyParameters = toolDesc.frameworkAware?.methodologyParameters;
      const methodologyParamConfig =
        methodologyParameters?.[methodologyKey] ??
        (activeMethodology ? methodologyParameters?.[activeMethodology] : undefined);
      if (methodologyParamConfig?.[paramName]) {
        const param = methodologyParamConfig[paramName];
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
    return this.configPath;
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
  } {
    const loadedFromFile = this.descriptions.size;
    const defaultCount = this.defaults.size;

    return {
      totalDescriptions: this.descriptions.size,
      loadedFromFile: loadedFromFile > defaultCount ? loadedFromFile : 0,
      usingDefaults: loadedFromFile <= defaultCount ? defaultCount : 0,
      configPath: this.configPath,
      isInitialized: this.isInitialized,
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
      this.logger.info(`🔍 Starting file watcher for tool descriptions: ${this.configPath}`);

      this.fileWatcher = watch(this.configPath, (eventType) => {
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
    await this.initialize();
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

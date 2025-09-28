/**
 * Tool Description Manager
 *
 * Manages externalized tool descriptions with graceful fallback to defaults.
 * Follows established ConfigManager pattern for consistency with existing architecture.
 */

import { Logger } from '../logging/index.js';
import { ConfigManager } from '../config/index.js';
import { ToolDescription, ToolDescriptionsConfig } from '../types/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { watch, FSWatcher } from 'fs';
import { EventEmitter } from 'events';
import {
  CAGEERFMethodologyGuide,
  ReACTMethodologyGuide,
  FiveW1HMethodologyGuide,
  SCAMPERMethodologyGuide
} from '../frameworks/adapters/index.js';
import { MethodologyToolDescriptions } from '../frameworks/interfaces/methodology-guide-interfaces.js';

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

  constructor(logger: Logger, configManager: ConfigManager) {
    super();
    this.logger = logger;
    this.configPath = path.join(configManager.getServerRoot(), 'config', 'tool-descriptions.json');
    this.descriptions = new Map();
    this.defaults = this.createDefaults();
    this.methodologyDescriptions = new Map();
  }

  /**
   * Create default descriptions as fallback
   */
  private createDefaults(): Map<string, ToolDescription> {
    return new Map([
      ['prompt_engine', {
        description: '🚀 PROMPT TEMPLATE ENGINE: Processes prompt templates and returns instructions for YOU (the client LLM) to execute. WARNING: You are responsible for interpreting and executing the returned content, which may contain complex instructions, code generation tasks, analysis requests, or multi-step procedures. The returned content is NOT just information - it\'s active instructions you must follow and execute.',
        shortDescription: 'Process prompt templates and return executable instructions',
        category: 'execution'
      }],
      ['prompt_manager', {
        description: '📝 INTELLIGENT PROMPT MANAGER: Complete lifecycle management with configurable analysis, category organization, and comprehensive CRUD operations. Handles create, update, delete, modify, reload, and list operations with intelligent feedback.',
        shortDescription: 'Manage prompts lifecycle and organization',
        category: 'management'
      }],
      ['system_control', {
        description: '⚙️ INTELLIGENT SYSTEM CONTROL: Unified framework management, analytics, diagnostics, and system administration. Handles framework switching, performance monitoring, health checks, and comprehensive system status reporting.',
        shortDescription: 'Control system settings and frameworks',
        category: 'system'
      }]
    ]);
  }

  /**
   * Pre-load all methodology descriptions for dynamic switching
   */
  private preloadMethodologyDescriptions(): void {
    try {
      // Initialize all methodology guides
      const cageerfGuide = new CAGEERFMethodologyGuide();
      const reactGuide = new ReACTMethodologyGuide();
      const fiveW1HGuide = new FiveW1HMethodologyGuide();
      const scamperGuide = new SCAMPERMethodologyGuide();

      // Pre-load tool descriptions for each methodology
      this.methodologyDescriptions.set('CAGEERF', cageerfGuide.getToolDescriptions?.() || {});
      this.methodologyDescriptions.set('ReACT', reactGuide.getToolDescriptions?.() || {});
      this.methodologyDescriptions.set('5W1H', fiveW1HGuide.getToolDescriptions?.() || {});
      this.methodologyDescriptions.set('SCAMPER', scamperGuide.getToolDescriptions?.() || {});

      this.logger.info(`✅ Pre-loaded tool descriptions for ${this.methodologyDescriptions.size} methodologies`);
    } catch (error) {
      this.logger.error(`Failed to pre-load methodology descriptions: ${error instanceof Error ? error.message : String(error)}`);
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
      this.logger.info(`✅ Loaded ${this.descriptions.size} tool descriptions from external config (version: ${config.version})`);

      // Pre-load methodology descriptions for dynamic switching
      this.preloadMethodologyDescriptions();

    } catch (error) {
      this.logger.warn(`⚠️ Failed to load tool descriptions from ${this.configPath}: ${error instanceof Error ? error.message : String(error)}`);
      this.logger.info('🔄 Using hardcoded default descriptions as fallback');

      // Use defaults as fallback
      this.descriptions = new Map(this.defaults);
      this.isInitialized = true;

      // Pre-load methodology descriptions for dynamic switching
      this.preloadMethodologyDescriptions();
    }
  }

  /**
   * Get description for a specific tool
   */
  getDescription(toolName: string, frameworkEnabled?: boolean, activeMethodology?: string): string {
    const toolDesc = this.descriptions.get(toolName) || this.defaults.get(toolName);

    if (!toolDesc) {
      this.logger.warn(`No description found for tool: ${toolName}`);
      return `Tool: ${toolName}`;
    }

    // Return methodology-specific description if available (from pre-loaded cache)
    if (frameworkEnabled && activeMethodology) {
      const methodologyDescs = this.methodologyDescriptions.get(activeMethodology);
      if (methodologyDescs?.[toolName as keyof MethodologyToolDescriptions]?.description) {
        return methodologyDescs[toolName as keyof MethodologyToolDescriptions]!.description!;
      }
      // Fallback to static config if available
      if (toolDesc.frameworkAware?.methodologies?.[activeMethodology]) {
        return toolDesc.frameworkAware.methodologies[activeMethodology];
      }
    }

    // Return framework-aware description if available and framework state is provided
    if (frameworkEnabled !== undefined && toolDesc.frameworkAware) {
      if (frameworkEnabled && toolDesc.frameworkAware.enabled) {
        return toolDesc.frameworkAware.enabled;
      } else if (!frameworkEnabled && toolDesc.frameworkAware.disabled) {
        return toolDesc.frameworkAware.disabled;
      }
    }

    return toolDesc.description;
  }

  /**
   * Get parameter description for a specific tool parameter
   */
  getParameterDescription(toolName: string, paramName: string, frameworkEnabled?: boolean, activeMethodology?: string): string | undefined {
    const toolDesc = this.descriptions.get(toolName) || this.defaults.get(toolName);
    if (!toolDesc?.parameters) return undefined;

    // Check for methodology-specific parameter descriptions first (from pre-loaded cache)
    if (frameworkEnabled && activeMethodology) {
      const methodologyDescs = this.methodologyDescriptions.get(activeMethodology);
      const methodologyTool = methodologyDescs?.[toolName as keyof MethodologyToolDescriptions];
      if (methodologyTool?.parameters?.[paramName]) {
        return methodologyTool.parameters[paramName];
      }
      // Fallback to static config if available
      if (toolDesc.frameworkAware?.methodologyParameters?.[activeMethodology]?.[paramName]) {
        const param = toolDesc.frameworkAware.methodologyParameters[activeMethodology][paramName];
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
      isInitialized: this.isInitialized
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
      this.logger.error(`Failed to start tool description file watcher: ${error instanceof Error ? error.message : String(error)}`);
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
        this.logger.error(`Failed to reload tool descriptions: ${error instanceof Error ? error.message : String(error)}`);
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
// @lifecycle canonical - Registers MCP tool implementations exposed to Model Context Protocol clients.
/**
 * MCP Tools Module - Consolidated Architecture
 *
 * This module provides 3 core MCP tools with framework-aware descriptions:
 *
 * CORE TOOLS:
 * - prompt_engine: Universal execution engine with framework integration
 * - system_control: Framework and system management with analytics
 * - resource_manager: Unified CRUD for prompts, gates, and methodologies
 *
 * ARCHITECTURE:
 * - Framework-aware tool descriptions that change based on active methodology
 * - Single source of truth for each functional area
 * - Integrated ToolDescriptionManager for dynamic descriptions
 * - Improved maintainability and clear separation of concerns
 */

import * as path from 'node:path';

import { z } from 'zod';

// Import generated Zod schemas from contracts (SSOT for parameter validation)

import { ConsolidatedSystemControl, createConsolidatedSystemControl } from './system-control.js';
import { ToolDescriptionManager } from './tool-description-manager.js';
import { ChainSessionManager, createChainSessionManager } from '../chain-session/manager.js';
import { ConfigManager } from '../config/index.js';
import { FrameworkManager, createFrameworkManager } from '../frameworks/framework-manager.js';
import { FrameworkStateManager } from '../frameworks/framework-state-manager.js';
import { GateSystemManager, createGateSystemManager } from '../gates/gate-state-manager.js';
import { Logger } from '../logging/index.js';
import { MetricsCollector, createMetricsCollector } from '../metrics/index.js';
import { PromptAssetManager } from '../prompts/index.js';
// Gate evaluator removed - now using Framework methodology validation
import { createContentAnalyzer } from '../semantic/configurable-semantic-analyzer.js';
import {
  ConsolidatedFrameworkManager,
  createConsolidatedFrameworkManager,
} from './framework-manager/index.js';
import { ResourceManagerRouter, createResourceManagerRouter } from './resource-manager/index.js';
import { createSemanticIntegrationFactory } from '../semantic/integrations/index.js';
import { ConversationManager } from '../text-references/conversation.js';
import { TextReferenceManager } from '../text-references/index.js';
import { ConsolidatedGateManager, createConsolidatedGateManager } from './gate-manager/index.js';
import {
  ConsolidatedPromptManager,
  createConsolidatedPromptManager,
} from './prompt-manager/index.js';
import {
  promptEngineSchema,
  systemControlSchema,
  resourceManagerSchema,
  type promptEngineInput,
  type systemControlInput,
  type resourceManagerInput,
} from '../tooling/contracts/_generated/mcp-schemas.js';
import { Category, ConvertedPrompt, PromptData, ToolResponse } from '../types/index.js';
import { ServiceManager } from '../utils/service-manager.js';
import { PromptExecutionService, createPromptExecutionService } from './prompt-engine/index.js';

import type { GateManager } from '../gates/gate-manager.js';
import type { GateSpecification } from '../types/execution.js';
// REMOVED: ExecutionCoordinator and ChainOrchestrator - modular chain system removed

// Consolidated tools
import type { FrameworkManagerDependencies } from './framework-manager/core/types.js';
import type { ResourceManagerInput } from './resource-manager/core/types.js';
// Gate system management integration

/**
 * Consolidated MCP Tools Manager
 *
 * Manages 3 intelligent consolidated tools: prompt_engine, system_control, resource_manager
 */
export class ConsolidatedMcpToolsManager {
  private logger: Logger;
  private mcpServer: any;
  private promptManager: PromptAssetManager;
  private configManager: ConfigManager;

  // Consolidated tools (5 core tools)
  private promptExecutionService!: PromptExecutionService;
  private promptManagerTool!: ConsolidatedPromptManager;
  private systemControl!: ConsolidatedSystemControl;
  private gateManagerTool!: ConsolidatedGateManager;
  private frameworkManagerTool!: ConsolidatedFrameworkManager;
  private resourceManagerRouter?: ResourceManagerRouter;
  // Core tools: prompt engine, prompt manager, system control, gate manager, framework manager, resource manager

  // Shared components
  private semanticAnalyzer!: ReturnType<typeof createContentAnalyzer>;
  private frameworkStateManager?: FrameworkStateManager;
  private frameworkManager?: FrameworkManager;
  private chainSessionManager?: ChainSessionManager;
  // REMOVED: chainOrchestrator - modular chain system removed
  private conversationManager: ConversationManager;
  private textReferenceManager: TextReferenceManager;
  private toolDescriptionManager?: ToolDescriptionManager;
  private gateSystemManager?: GateSystemManager;
  private gateManager: GateManager;
  private analyticsService!: MetricsCollector;
  private serviceManager: ServiceManager | undefined;
  // Removed executionCoordinator - chains now use LLM-driven execution model

  // Callback references
  private onRestart?: (reason: string) => Promise<void>;

  // Data references
  private promptsData: PromptData[] = [];
  private convertedPrompts: ConvertedPrompt[] = [];
  private categories: Category[] = [];

  // Pending analytics queue for initialization race condition
  private pendingAnalytics: any[] = [];
  private toolsInitialized = false;

  constructor(
    logger: Logger,
    mcpServer: any,
    promptManager: PromptAssetManager,
    configManager: ConfigManager,
    conversationManager: ConversationManager,
    textReferenceManager: TextReferenceManager,
    serviceManager: ServiceManager | undefined,
    gateManager: GateManager
  ) {
    this.logger = logger;
    this.mcpServer = mcpServer;
    this.promptManager = promptManager;
    this.configManager = configManager;
    this.conversationManager = conversationManager;
    this.textReferenceManager = textReferenceManager;
    if (serviceManager != null) {
      this.serviceManager = serviceManager;
    }
    this.gateManager = gateManager;
  }

  /**
   * Initialize the MCP tools with async configuration
   */
  async initialize(
    onRefresh: () => Promise<void>,
    onRestart: (reason: string) => Promise<void>
  ): Promise<void> {
    // Store callback references
    this.onRestart = onRestart;

    // Initialize shared components with configurable analysis
    const analysisConfig = this.configManager.getSemanticAnalysisConfig();
    const integrationFactory = createSemanticIntegrationFactory(this.logger);
    this.semanticAnalyzer = await integrationFactory.createFromEnvironment(analysisConfig);
    this.analyticsService = createMetricsCollector(this.logger);

    // Initialize gate system manager for runtime gate control
    const runtimeStateDir = path.join(this.configManager.getServerRoot(), 'runtime-state');
    this.gateSystemManager = createGateSystemManager(this.logger, runtimeStateDir);
    await this.gateSystemManager.initialize();

    const analyzerMode = analysisConfig.llmIntegration.enabled ? 'semantic' : 'minimal';
    this.logger.info(`Semantic analyzer initialized (mode: ${analyzerMode})`);

    // Initialize chain session manager
    this.chainSessionManager = createChainSessionManager(
      this.logger,
      this.textReferenceManager,
      this.configManager.getServerRoot()
    );

    // Initialize consolidated tools
    this.promptExecutionService = createPromptExecutionService(
      this.logger,
      this.mcpServer,
      this.promptManager,
      this.configManager,
      this.semanticAnalyzer,
      this.conversationManager,
      this.textReferenceManager,
      this.gateManager,
      this // Pass manager reference for analytics data flow
      // Removed executionCoordinator - chains now use LLM-driven execution
    );

    // Set gate system manager in prompt engine
    this.promptExecutionService.setGateSystemManager(this.gateSystemManager);

    this.promptManagerTool = createConsolidatedPromptManager(
      this.logger,
      this.mcpServer,
      this.configManager,
      this.semanticAnalyzer,
      this.frameworkStateManager,
      this.frameworkManager,
      onRefresh,
      onRestart
    );

    // Initialize 5 core consolidated tools

    this.systemControl = createConsolidatedSystemControl(this.logger, this.mcpServer, onRestart);

    // Set managers in system control
    this.systemControl.setGateSystemManager(this.gateSystemManager);
    this.systemControl.setChainSessionManager(this.chainSessionManager);
    this.systemControl.setGateGuidanceRenderer(
      this.promptExecutionService.getGateGuidanceRenderer()
    );

    // Initialize gate manager tool
    this.gateManagerTool = createConsolidatedGateManager({
      logger: this.logger,
      gateManager: this.gateManager,
      configManager: this.configManager,
      onRefresh,
    });

    // Initialize framework manager tool (framework manager set later via setFrameworkManager)
    // Note: frameworkManager is not yet available at this point, will be set in setFrameworkManager

    // chainScaffolder removed - functionality consolidated into promptEngine

    // Flush any pending analytics data that was queued during initialization
    this.toolsInitialized = true;
    this.flushPendingAnalytics();

    this.logger.info(
      'Consolidated MCP Tools Manager initialized with 5 intelligent tools (chain management in prompt_engine)'
    );
  }

  /**
   * Set framework state manager (called after initialization)
   */
  setFrameworkStateManager(frameworkStateManager: FrameworkStateManager): void {
    this.frameworkStateManager = frameworkStateManager;
    this.promptExecutionService.setFrameworkStateManager(frameworkStateManager);
    this.systemControl.setFrameworkStateManager(frameworkStateManager);
    this.promptManagerTool.setFrameworkStateManager?.(frameworkStateManager);
    // FIXED: Synchronize Framework Manager with Framework State Manager to prevent injection duplication
    if (this.frameworkManager != null) {
      this.frameworkManager.setFrameworkStateManager(frameworkStateManager);
    }
    // Set on framework manager tool if already initialized
    if (this.frameworkManagerTool != null) {
      this.frameworkManagerTool.setFrameworkStateManager(frameworkStateManager);
    }
    // Core tools handle framework state integration
  }

  /**
   * Set tool description manager (called after initialization)
   */
  setToolDescriptionManager(manager: ToolDescriptionManager): void {
    this.toolDescriptionManager = manager;

    this.promptExecutionService.setToolDescriptionManager(manager);
    this.promptExecutionService.setAnalyticsService(this.analyticsService);
    // promptManagerTool doesn't have setToolDescriptionManager method
    this.systemControl.setToolDescriptionManager?.(manager);
    this.systemControl.setAnalyticsService(this.analyticsService);
    // Core tools integrated with framework-aware descriptions

    // Set up hot-reload event listeners
    this.setupToolDescriptionHotReload(manager);

    this.logger.info('Tool description manager set for all MCP tools with hot-reload support');
  }

  /**
   * Setup hot-reload event listeners for tool descriptions
   */
  private setupToolDescriptionHotReload(manager: ToolDescriptionManager): void {
    // Listen for description changes
    manager.on('descriptions-changed', (stats) => {
      this.logger.info(
        `🔥 Tool descriptions hot-reloaded: ${stats.totalDescriptions} descriptions loaded`
      );
      this.handleToolDescriptionChange(stats);
    });

    // Listen for reload errors
    manager.on('descriptions-error', (error) => {
      this.logger.error(
        `❌ Tool description reload failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });

    const serviceName = 'tool-description-watcher';
    if (this.serviceManager != null) {
      if (!this.serviceManager.hasService(serviceName)) {
        this.serviceManager.register({
          name: serviceName,
          start: () => manager.startWatching(),
          stop: () => manager.stopWatching(),
        });
      }
      void this.serviceManager.startService(serviceName);
    } else if (!manager.isWatchingFile()) {
      manager.startWatching();
    }
  }

  /**
   * Handle tool description changes
   */
  private async handleToolDescriptionChange(stats: any): Promise<void> {
    try {
      this.logger.info('🔄 Processing tool description changes...');

      // Emit analytics update
      this.updateAnalytics({
        toolDescriptions: {
          lastReload: new Date().toISOString(),
          totalDescriptions: stats.totalDescriptions,
          loadedFromFile: stats.loadedFromFile,
          usingDefaults: stats.usingDefaults,
        },
      });

      // Note: MCP SDK doesn't support dynamic tool updates
      // The new descriptions will be loaded on next tool registration or server restart
      this.logger.info('✅ Tool descriptions reloaded from file');
      this.logger.info(
        `📊 Stats: ${stats.totalDescriptions} total, using ${
          stats.usingDefaults > 0 ? 'defaults' : 'external config'
        }`
      );

      // Check if restart is configured for tool description changes
      const restartOnChange =
        this.configManager.getConfig().toolDescriptions?.restartOnChange ?? false;

      if (restartOnChange) {
        this.logger.info(
          '🚨 Restart on tool description change is enabled - initiating server restart...'
        );
        // Use the existing restart mechanism
        await this.onRestart?.(
          'Tool descriptions updated - restart required for clients to see new descriptions'
        );
      } else {
        this.logger.info(
          "💡 Tip: New tool descriptions will be used for new client connections. For immediate effect, restart the server manually or enable 'restartOnChange' in config."
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle tool description change: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Initialize and set framework manager (called after framework state manager)
   */
  async setFrameworkManager(existingFrameworkManager?: FrameworkManager): Promise<void> {
    if (this.frameworkManager == null) {
      // Use provided framework manager or create a new one
      this.frameworkManager =
        existingFrameworkManager ?? (await createFrameworkManager(this.logger));

      // FIX: Connect frameworkStateManager if it was set before frameworkManager was created
      // This handles the startup order where setFrameworkStateManager() is called first
      if (this.frameworkStateManager != null) {
        this.frameworkManager.setFrameworkStateManager(this.frameworkStateManager);
      }

      this.promptExecutionService.setFrameworkManager(this.frameworkManager);
      this.systemControl.setFrameworkManager(this.frameworkManager);
      this.promptManagerTool.setFrameworkManager?.(this.frameworkManager);

      // Initialize framework manager tool now that frameworkManager is available
      const frameworkManagerDeps: FrameworkManagerDependencies = {
        logger: this.logger,
        frameworkManager: this.frameworkManager,
        configManager: this.configManager,
        onRefresh: async () => {
          // Trigger reload via the onRestart mechanism (full refresh)
          this.logger.debug('Framework manager triggered refresh');
        },
        onToolsUpdate: async () => {
          // Re-register tools with updated descriptions
          await this.reregisterToolsWithUpdatedDescriptions();
        },
      };

      if (this.frameworkStateManager != null) {
        frameworkManagerDeps.frameworkStateManager = this.frameworkStateManager;
      }

      this.frameworkManagerTool = createConsolidatedFrameworkManager(frameworkManagerDeps);

      // Initialize unified resource manager router (routes to prompt/gate/framework managers)
      this.resourceManagerRouter = createResourceManagerRouter({
        logger: this.logger,
        promptManager: this.promptManagerTool,
        gateManager: this.gateManagerTool,
        frameworkManager: this.frameworkManagerTool,
      });
      this.logger.debug('ResourceManagerRouter initialized for unified resource management');

      // Core tools integrated with framework management

      // Set ConfigManager for system control config operations
      this.systemControl.setConfigManager(this.configManager);

      // Set MCPToolsManager reference for dynamic tool updates
      this.systemControl.setMCPToolsManager(this);

      // Enhanced tool delegation removed (.2)
      // Using core tools directly without delegation patterns

      // REMOVED: ChainOrchestrator initialization - modular chain system removed

      if (existingFrameworkManager != null) {
        this.logger.info('Framework manager integrated with MCP tools (shared instance)');
      } else {
        this.logger.info('Framework manager initialized and integrated with MCP tools');
      }
    }
  }

  /**
   * Expose the framework manager for runtime integrations (e.g., methodology hot reload).
   */
  getFrameworkManager(): FrameworkManager | undefined {
    return this.frameworkManager;
  }

  /**
   * Get resource manager handler for auto-execute functionality.
   * Returns a function that can execute resource_manager actions internally.
   */
  getResourceManagerHandler():
    | ((
        args: Record<string, unknown>,
        context: Record<string, unknown>
      ) => Promise<import('../types/index.js').ToolResponse>)
    | null {
    const router = this.resourceManagerRouter;
    if (router == null) {
      return null;
    }
    return (args, context) => router.handleAction(args as any, context);
  }

  // REMOVED: wireExecutionCoordinator - ExecutionCoordinator removed

  /**
   * Register all consolidated MCP tools with the server (centralized registration)
   */
  async registerAllTools(): Promise<void> {
    this.logger.info('Registering consolidated MCP tools with server (centralized)...');

    // Get current framework state for dynamic descriptions
    const frameworkEnabled = this.frameworkStateManager?.isFrameworkSystemEnabled() ?? false;
    const activeFramework = this.frameworkStateManager?.getActiveFramework();
    const activeMethodology = activeFramework?.type ?? activeFramework?.id;

    this.logger.info(`🔧 Registering tools with framework-aware descriptions:`);
    this.logger.info(`   Framework enabled: ${frameworkEnabled}`);
    this.logger.info(`   Active framework: ${activeFramework?.id ?? 'none'}`);
    this.logger.info(`   Active methodology: ${activeMethodology ?? 'none'}`);
    this.logger.info(
      `   Tool description manager: ${
        this.toolDescriptionManager != null ? 'available' : 'not available'
      }`
    );

    // Register prompt_engine tool
    try {
      // Get dynamic description based on current framework state
      // Description loaded from tool-descriptions.contracts.json via ToolDescriptionManager
      const promptEngineDescription =
        this.toolDescriptionManager?.getDescription(
          'prompt_engine',
          frameworkEnabled,
          activeMethodology,
          { applyMethodologyOverride: true }
        ) ?? '';

      const getPromptEngineParamDescription = (paramName: string, fallback: string) =>
        this.toolDescriptionManager?.getParameterDescription(
          'prompt_engine',
          paramName,
          frameworkEnabled,
          activeMethodology,
          { applyMethodologyOverride: true }
        ) ?? fallback;

      // Log which description source is being used for transparency
      if (this.toolDescriptionManager != null) {
        this.logger.info(
          `   prompt_engine: Using ToolDescriptionManager (framework: ${frameworkEnabled}, methodology: ${activeMethodology})`
        );
      } else {
        this.logger.info(
          `   prompt_engine: Using fallback description (ToolDescriptionManager not available)`
        );
      }

      // Custom check schema for simple inline validation
      const customCheckSchema = z.object({
        name: z.string().min(1, 'Custom check name cannot be empty'),
        description: z.string().min(1, 'Custom check description cannot be empty'),
      });

      // Temporary gate object schema for full gate definitions
      const temporaryGateObjectSchema = z
        .object({
          id: z.string().min(1, 'Gate ID cannot be empty').optional(),
          template: z.string().min(1, 'Template reference cannot be empty').optional(),
          name: z.string().optional(),
          type: z.enum(['validation', 'guidance']).optional(),
          scope: z.enum(['execution', 'session', 'chain', 'step']).optional(),
          description: z.string().optional(),
          guidance: z.string().optional(),
          criteria: z.array(z.string().min(1)).optional(),
          pass_criteria: z.array(z.string().min(1)).optional(),
          severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
          source: z.enum(['manual', 'automatic', 'analysis']).optional(),
          context: z.record(z.any()).optional(),
          target_step_number: z.number().int().positive().optional(),
          apply_to_steps: z.array(z.number().int().positive()).optional(),
        })
        .refine(
          (value) => {
            if (value.id != null) {
              return true;
            }
            const hasCriteria =
              (value.criteria?.length ?? 0) > 0 || (value.pass_criteria?.length ?? 0) > 0;
            const hasGuidance =
              (value.guidance?.trim().length ?? 0) > 0 ||
              (value.description?.trim().length ?? 0) > 0;
            return hasCriteria || hasGuidance;
          },
          {
            message: 'Temporary gate entries require an id or some inline criteria/guidance',
          }
        );

      this.mcpServer.registerTool(
        'prompt_engine',
        {
          title: 'Prompt Engine',
          description: promptEngineDescription,
          inputSchema: {
            command: z
              .string()
              .min(1, 'Command cannot be empty')
              .optional()
              .describe(
                getPromptEngineParamDescription(
                  'command',
                  'Prompt/chain command. PATTERNS: >>prompt_id key="value" (single) | >>s1 --> >>s2 (chain). RESUME: omit command, use chain_id + user_response only.'
                )
              ),
            force_restart: z
              .boolean()
              .optional()
              .describe(
                getPromptEngineParamDescription(
                  'force_restart',
                  'Create a new chain execution (increments chain ID). Use `command`.'
                )
              ),
            chain_id: z
              .string()
              .regex(
                /^chain-[a-zA-Z0-9_-]+(?:#\d+)?$/,
                'Chain ID must follow format: chain-{prompt} or chain-{prompt}#runNumber'
              )
              .optional()
              .describe(
                getPromptEngineParamDescription(
                  'chain_id',
                  'Resume token (e.g., `chain-demo#2`). RESUME: chain_id + user_response only. Omit command.'
                )
              ),
            gate_verdict: z
              .string()
              .trim()
              .regex(
                /^GATE_REVIEW:\s(PASS|FAIL)\s-\s.+$/,
                'Gate verdict must follow format: "GATE_REVIEW: PASS/FAIL - reason"'
              )
              .optional()
              .describe(
                getPromptEngineParamDescription(
                  'gate_verdict',
                  'Send PASS/FAIL verdicts when resuming after gate reviews (e.g., "GATE_REVIEW: PASS - rationale"). Keep user_response for actual step output.'
                )
              ),
            gate_action: z
              .enum(['retry', 'skip', 'abort'])
              .optional()
              .describe(
                getPromptEngineParamDescription(
                  'gate_action',
                  'User choice after gate retry limit exhaustion. "retry" resets attempt count, "skip" bypasses the gate, "abort" stops execution.'
                )
              ),
            user_response: z
              .string()
              .min(1, 'User response cannot be empty if provided')
              .optional()
              .describe(
                getPromptEngineParamDescription(
                  'user_response',
                  'Your Step output to capture before advancing. Supply the same text you would reply with during manual execution.'
                )
              ),
            gates: z
              .array(
                z.union([
                  z.string().min(1, 'Gate reference cannot be empty'),
                  customCheckSchema,
                  temporaryGateObjectSchema,
                ])
              )
              .optional()
              .describe(
                getPromptEngineParamDescription(
                  'gates',
                  'Unified gate specification - Accepts gate IDs (strings), custom checks ({name, description}), or full gate definitions. Supports mixed types in single array for maximum flexibility. Canonical parameter for all gate specification (v3.0.0+).'
                )
              ),
            options: z
              .record(z.any())
              .optional()
              .describe(
                getPromptEngineParamDescription(
                  'options',
                  'Additional execution options (key-value pairs) passed through to execution.'
                )
              ),
          },
        },
        async (args: promptEngineInput) => {
          try {
            // Normalize and validate string inputs (trim whitespace, filter empty values)
            const trimmedCommand = args.command?.trim();
            const trimmedChainId = args.chain_id?.trim();
            const trimmedUserResponse = args.user_response?.trim();
            const trimmedGateVerdict = args.gate_verdict?.trim();
            const trimmedGateAction = args.gate_action?.trim();

            const extraPayload = trimmedUserResponse
              ? { previous_step_output: trimmedUserResponse }
              : undefined;
            const requestExtras = extraPayload != null ? { extra: extraPayload } : {};

            // Build normalized args, only including non-empty values
            const normalizedArgs: Parameters<PromptExecutionService['executePromptCommand']>[0] = {
              ...(trimmedCommand ? { command: trimmedCommand } : {}),
              ...(trimmedChainId ? { chain_id: trimmedChainId } : {}),
              ...(trimmedUserResponse ? { user_response: trimmedUserResponse } : {}),
              ...(trimmedGateVerdict ? { gate_verdict: trimmedGateVerdict } : {}),
              ...(trimmedGateAction
                ? { gate_action: trimmedGateAction as 'retry' | 'skip' | 'abort' }
                : {}),
              ...(args.force_restart !== undefined ? { force_restart: args.force_restart } : {}),
              ...(args.options != null ? { options: args.options } : {}),
            };

            if (args.gates != null) {
              const normalizedGates = args.gates
                .map((gate): GateSpecification | null => {
                  if (typeof gate === 'string') {
                    return gate;
                  }

                  // Check for CustomCheck type ({name, description} - simple inline gate)
                  if ('name' in gate && 'description' in gate) {
                    // Validate non-empty name and description
                    const trimmedName = gate.name?.trim();
                    const trimmedDescription = gate.description?.trim();
                    if (trimmedName && trimmedDescription) {
                      return {
                        name: trimmedName,
                        description: trimmedDescription,
                      };
                    }
                    return null;
                  }

                  const normalized: Record<string, unknown> = {};
                  if (gate['id'] !== undefined) {
                    normalized['id'] = gate['id'];
                  }
                  if (gate['name'] !== undefined) {
                    normalized['name'] = gate['name'];
                  }
                  if (gate['description'] !== undefined) {
                    normalized['description'] = gate['description'];
                  }
                  if (gate['criteria'] !== undefined) {
                    normalized['criteria'] = gate['criteria'];
                  }
                  if (gate['pass_criteria'] !== undefined) {
                    normalized['pass_criteria'] = gate['pass_criteria'];
                  }
                  if (gate['severity'] !== undefined) {
                    normalized['severity'] = gate['severity'];
                  }
                  if (gate['type'] !== undefined) {
                    normalized['type'] = gate['type'];
                  }
                  if (gate['scope'] !== undefined) {
                    normalized['scope'] = gate['scope'];
                  }
                  if (gate['context'] !== undefined) {
                    normalized['context'] = gate['context'];
                  }
                  if (gate['guidance'] !== undefined) {
                    normalized['guidance'] = gate['guidance'];
                  }
                  if (gate['source'] !== undefined) {
                    normalized['source'] = gate['source'];
                  }
                  if (gate['target_step_number'] !== undefined) {
                    normalized['target_step_number'] = gate['target_step_number'];
                  }
                  if (gate['apply_to_steps'] !== undefined) {
                    normalized['apply_to_steps'] = gate['apply_to_steps'];
                  }

                  return normalized as GateSpecification;
                })
                .filter((entry): entry is GateSpecification => entry !== null);
              normalizedArgs.gates = normalizedGates;
            }

            const toolResponse = await this.promptExecutionService.executePromptCommand(
              normalizedArgs,
              requestExtras
            );

            return {
              content: toolResponse.content,
              isError: toolResponse.isError,
            };
          } catch (error) {
            this.logger.error(
              `prompt_engine error: ${error instanceof Error ? error.message : String(error)}`
            );
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        }
      );
      this.logger.debug('✅ prompt_engine tool registered successfully');
    } catch (error) {
      this.logger.error(
        `❌ Failed to register prompt_engine tool: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }

    // Register system_control tool
    try {
      // Description loaded from tool-descriptions.contracts.json via ToolDescriptionManager
      const systemControlDescription =
        this.toolDescriptionManager?.getDescription(
          'system_control',
          frameworkEnabled,
          activeMethodology,
          { applyMethodologyOverride: true }
        ) ?? '';

      // Log which description source is being used for transparency
      if (this.toolDescriptionManager != null) {
        this.logger.info(
          `   system_control: Using ToolDescriptionManager (framework: ${frameworkEnabled}, methodology: ${activeMethodology})`
        );
      } else {
        this.logger.info(
          `   system_control: Using fallback description (ToolDescriptionManager not available)`
        );
      }

      const getSystemControlParamDescription = (paramName: string, fallback: string) =>
        this.toolDescriptionManager?.getParameterDescription(
          'system_control',
          paramName,
          frameworkEnabled,
          activeMethodology,
          { applyMethodologyOverride: true }
        ) ?? fallback;

      this.mcpServer.registerTool(
        'system_control',
        {
          title: 'System Control',
          description: systemControlDescription,
          inputSchema: {
            action: z
              .string()
              .describe(
                getSystemControlParamDescription(
                  'action',
                  'Top-level command. Supported values: status, framework, gates, analytics, config, maintenance.'
                )
              ),
            operation: z
              .string()
              .optional()
              .describe(
                getSystemControlParamDescription(
                  'operation',
                  'Sub-command for the selected action (e.g. framework: switch|list|enable|disable, analytics: view|reset|history).'
                )
              ),
            framework: z
              .string()
              .optional()
              .describe(
                getSystemControlParamDescription(
                  'framework',
                  'Framework identifier when switching. Use framework:list to see available options.'
                )
              ),
            reason: z
              .string()
              .optional()
              .describe(
                getSystemControlParamDescription(
                  'reason',
                  'Audit-friendly explanation for switches, config changes, or restarts.'
                )
              ),
            persist: z
              .boolean()
              .optional()
              .describe(
                getSystemControlParamDescription(
                  'persist',
                  'When true, gate/framework enable/disable changes are also written to config.json.'
                )
              ),
            include_history: z
              .boolean()
              .optional()
              .describe(
                getSystemControlParamDescription(
                  'include_history',
                  'Include historical entries (where supported).'
                )
              ),
            include_metrics: z
              .boolean()
              .optional()
              .describe(
                getSystemControlParamDescription(
                  'include_metrics',
                  'Include detailed metrics output (where supported).'
                )
              ),
            show_details: z
              .boolean()
              .optional()
              .describe(
                getSystemControlParamDescription(
                  'show_details',
                  'Request an expanded response for list/status style commands.'
                )
              ),
          },
        },
        async (args: systemControlInput) => {
          try {
            const toolResponse = await this.systemControl.handleAction(args, {});
            return {
              content: toolResponse.content,
              isError: toolResponse.isError,
              ...(toolResponse.structuredContent != null
                ? { structuredContent: toolResponse.structuredContent }
                : {}),
            };
          } catch (error) {
            this.logger.error(
              `system_control error: ${error instanceof Error ? error.message : String(error)}`
            );
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        }
      );
      this.logger.debug('✅ system_control tool registered successfully');
    } catch (error) {
      this.logger.error(
        `❌ Failed to register system_control tool: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }

    // Register resource_manager tool (unified router for prompts, gates, methodologies)
    try {
      // Description loaded from tool-descriptions.contracts.json via ToolDescriptionManager
      const resourceManagerDescription =
        this.toolDescriptionManager?.getDescription(
          'resource_manager',
          frameworkEnabled,
          activeMethodology,
          { applyMethodologyOverride: true }
        ) ?? '';

      this.mcpServer.registerTool(
        'resource_manager',
        {
          title: 'Resource Manager',
          description: resourceManagerDescription,
          // Use generated schema from contracts - includes .passthrough() for advanced methodology fields
          inputSchema: resourceManagerSchema,
        },
        async (args: resourceManagerInput) => {
          try {
            const router = this.resourceManagerRouter;
            if (router == null) {
              return {
                content: [{ type: 'text', text: 'Error: resource_manager not initialized' }],
                isError: true,
              };
            }
            // Cast to ResourceManagerInput - the generated schema uses .passthrough() so advanced
            // methodology fields flow through, but router expects the more specific local type
            const toolResponse = await router.handleAction(args as ResourceManagerInput, {});
            return {
              content: toolResponse.content,
              isError: toolResponse.isError,
            };
          } catch (error) {
            this.logger.error(
              `resource_manager error: ${error instanceof Error ? error.message : String(error)}`
            );
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        }
      );
      this.logger.debug('✅ resource_manager tool registered successfully');
    } catch (error) {
      this.logger.error(
        `❌ Failed to register resource_manager tool: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }

    this.logger.info('🎉 MCP tools registered successfully!');
    this.logger.info('📊 Core Tools: 3 registered MCP tools');
    this.logger.info('🚀 Active Tools: prompt_engine, system_control, resource_manager');

    // Log available tools for user reference
    const toolSummary = [
      'Available MCP Tools:',
      '🎯 prompt_engine - Execute prompts with frameworks and gates',
      '⚙️ system_control - System administration and status',
      '📦 resource_manager - Unified CRUD for prompts, gates, and methodologies',
    ].join('\n   ');

    this.logger.info(toolSummary);
  }

  /**
   * Update tool descriptions for framework switching without re-registering tools.
   * The MCP SDK does not support re-registering already registered tools.
   * Instead, we sync the description manager and notify clients of the change.
   */
  async reregisterToolsWithUpdatedDescriptions(): Promise<void> {
    this.logger.info('🔄 Updating tool descriptions for framework switch...');

    try {
      // Sync tool description manager with new framework state
      // The descriptions are fetched dynamically when clients request tool info
      if (this.toolDescriptionManager != null) {
        await this.toolDescriptionManager.reload();
        this.logger.info('✅ Tool description manager synchronized');
      }

      // Notify MCP clients that tool list has changed (descriptions updated)
      if (typeof this.mcpServer?.server?.sendToolListChanged === 'function') {
        await this.mcpServer.server.sendToolListChanged();
        this.logger.info('✅ Sent tool list changed notification to MCP clients');
      } else {
        this.logger.warn('⚠️ MCP server does not support sendToolListChanged notification');
      }

      this.logger.info('🎉 Tool descriptions updated successfully for framework switch!');
    } catch (error) {
      this.logger.error(
        `Failed to update tool descriptions: ${error instanceof Error ? error.message : String(error)}`
      );
      // Don't throw - framework switch should still succeed even if description update fails
      this.logger.warn(
        'Framework switch completed but tool descriptions may not reflect new framework'
      );
    }
  }

  /**
   * Update internal data references
   */
  updateData(
    promptsData: PromptData[],
    convertedPrompts: ConvertedPrompt[],
    categories: Category[]
  ): void {
    this.promptsData = promptsData;
    this.convertedPrompts = convertedPrompts;
    this.categories = categories;

    // Update all consolidated tools with new data
    this.promptExecutionService.updateData(promptsData, convertedPrompts);
    this.promptManagerTool.updateData(promptsData, convertedPrompts, categories);
    // Core tools handle data updates directly
  }

  /**
   * Update system analytics (from consolidated tools)
   */
  updateAnalytics(analytics: any): void {
    if (this.toolsInitialized) {
      this.systemControl.updateAnalytics(analytics);
    } else {
      // Queue analytics data until systemControl is initialized
      this.pendingAnalytics.push(analytics);
      this.logger.debug(
        `SystemControl not yet initialized, queued analytics data (${this.pendingAnalytics.length} pending)`
      );
    }
  }

  /**
   * Internal entry point for modules that need to reuse prompt_manager actions
   * without going through the MCP transport (e.g., ApiManager). Keeps prompt
   * mutations flowing through the canonical tool implementation.
   */
  async runPromptManagerAction(args: PromptManagerActionArgs): Promise<ToolResponse> {
    if (!this.toolsInitialized) {
      throw new Error('promptManagerTool is not initialized');
    }
    return this.promptManagerTool.handleAction(args, {});
  }

  /**
   * Flush pending analytics data to systemControl after initialization
   */
  private flushPendingAnalytics(): void {
    if (this.toolsInitialized && this.pendingAnalytics.length > 0) {
      this.logger.debug(`Flushing ${this.pendingAnalytics.length} pending analytics updates`);
      this.pendingAnalytics.forEach((analytics) => {
        this.systemControl.updateAnalytics(analytics);
      });
      this.pendingAnalytics = [];
    }
  }

  /**
   * Shutdown all components and cleanup resources
   */
  shutdown(): void {
    this.logger.info('🛑 Shutting down MCP tools manager...');

    // Shutdown tool description manager and stop file watching
    if (this.toolDescriptionManager != null) {
      this.toolDescriptionManager.shutdown();
      this.logger.info('✅ Tool description manager shut down');
    }

    // Cleanup gate system manager
    if (this.gateSystemManager != null) {
      this.gateSystemManager.cleanup().catch((error) => {
        this.logger.error('Error during gate system manager cleanup:', error);
      });
      this.logger.info('✅ Gate system manager cleanup initiated');
    }

    // Clear pending analytics
    this.pendingAnalytics = [];

    this.logger.info('✅ MCP tools manager shutdown completed');
  }
}

/**
 * Create consolidated MCP tools manager
 */
export async function createConsolidatedMcpToolsManager(
  logger: Logger,
  mcpServer: any,
  promptManager: PromptAssetManager,
  configManager: ConfigManager,
  conversationManager: ConversationManager,
  textReferenceManager: TextReferenceManager,
  lifecycleServices: ServiceManager | undefined,
  onRefresh: () => Promise<void>,
  onRestart: (reason: string) => Promise<void>,
  gateManager: GateManager
  // Removed executionCoordinator parameter - using LLM-driven chain model
): Promise<ConsolidatedMcpToolsManager> {
  const manager = new ConsolidatedMcpToolsManager(
    logger,
    mcpServer,
    promptManager,
    configManager,
    conversationManager,
    textReferenceManager,
    lifecycleServices,
    gateManager
    // Removed executionCoordinator parameter
  );

  await manager.initialize(onRefresh, onRestart);
  return manager;
}

// Legacy compatibility - export the consolidated manager as the old name
export { ConsolidatedMcpToolsManager as McpToolsManager };
export const createMcpToolsManager = createConsolidatedMcpToolsManager;

export type PromptManagerActionArgs = {
  action:
    | 'create'
    | 'analyze_type'
    | 'update'
    | 'delete'
    | 'reload'
    | 'list'
    | 'inspect'
    | 'analyze_gates'
    | 'guide';
  [key: string]: any;
};

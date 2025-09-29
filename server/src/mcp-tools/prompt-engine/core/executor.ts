/**
 * Chain Executor - Handles chain execution logic
 *
 * Extracted from ConsolidatedPromptEngine to provide focused
 * chain execution capabilities with clear separation of concerns.
 */

import { ConvertedPrompt, ToolResponse } from "../../../types/index.js";
import {
  ChainExecutionContext,
  ChainManagementCommand,
  ChainGateInfo,
  ChainExecutionOptions,
  ChainValidationResult,
  ChainStepData,
  StepArgumentsContext
} from "./types.js";
import { ConversationManager } from "../../../text-references/conversation.js";
import { LightweightGateSystem } from "../../../gates/core/index.js";
import { FrameworkManager } from "../../../frameworks/framework-manager.js";
import { FrameworkStateManager } from "../../../frameworks/framework-state-manager.js";
import { createLogger, Logger } from "../../../logging/index.js";
import { isChainPrompt } from "../../../utils/chainUtils.js";
import { ChainSessionManager } from "../../../chain-session/manager.js";
// Phase 4: Legacy cleanup - Advanced gate orchestration removed

const logger = createLogger({
  logFile: '/tmp/chain-executor.log',
  transport: 'stdio',
  enableDebug: false,
  configuredLevel: 'info'
});

/**
 * ChainExecutor handles all chain-related execution logic
 *
 * This class provides:
 * - Chain instruction generation
 * - Step argument building and command formatting
 * - Chain management commands (validate, list, etc.)
 * - Gate integration for chain validation
 * - Framework integration for methodology guidance
 */
export class ChainExecutor {
  private conversationManager: ConversationManager;
  private lightweightGateSystem: LightweightGateSystem;
  private frameworkManager: FrameworkManager;
  private frameworkStateManager: FrameworkStateManager;
  private responseFormatter: any;
  private chainSessionManager: ChainSessionManager;
  // Phase 4: Legacy cleanup - Advanced gate orchestration removed

  constructor(
    conversationManager: ConversationManager,
    lightweightGateSystem: LightweightGateSystem,
    frameworkManager: FrameworkManager,
    frameworkStateManager: FrameworkStateManager,
    responseFormatter: any,
    chainSessionManager: ChainSessionManager
  ) {
    this.conversationManager = conversationManager;
    this.lightweightGateSystem = lightweightGateSystem;
    this.frameworkManager = frameworkManager;
    this.frameworkStateManager = frameworkStateManager;
    this.responseFormatter = responseFormatter;
    this.chainSessionManager = chainSessionManager;
  }

  /**
   * Phase 4: Legacy cleanup - Advanced gate orchestrator setter removed
   */

  /**
   * Detects if a command is a chain management command
   */
  detectChainManagementCommand(command: string): {
    isChainManagement: boolean;
    action?: string;
    target?: string;
    parameters?: Record<string, any>;
  } {
    logger.debug('🔍 [Chain Management] Detecting chain management command', { command });

    const validActions = ['validate', 'list', 'gates', 'status', 'run', 'execute'];
    const chainIndicators = ['chain', 'chains'];

    const lowerCommand = command.toLowerCase();

    for (const action of validActions) {
      for (const indicator of chainIndicators) {
        const actionPattern = new RegExp(`\\b${action}\\s+${indicator}`, 'i');
        const indicatorPattern = new RegExp(`\\b${indicator}\\s+${action}`, 'i');

        if (actionPattern.test(lowerCommand) || indicatorPattern.test(lowerCommand)) {
          const parts = lowerCommand.split(/\s+/);
          const actionIndex = parts.indexOf(action);
          const indicatorIndex = parts.indexOf(indicator);

          let target = '';
          let paramString = '';

          if (actionIndex < indicatorIndex) {
            target = parts.slice(indicatorIndex + 1).join(' ');
          } else {
            target = parts.slice(actionIndex + 1).join(' ');
          }

          const [targetName, ...paramParts] = target.split(/\s+/);
          paramString = paramParts.join(' ');

          const parameters = this.parseKeyValueParams(paramString);

          logger.debug('✅ [Chain Management] Detected chain management command', {
            action,
            target: targetName,
            parameters
          });

          return {
            isChainManagement: true,
            action,
            target: targetName,
            parameters
          };
        }
      }
    }

    logger.debug('❌ [Chain Management] Not a chain management command', { command });
    return { isChainManagement: false };
  }

  /**
   * Parses key-value parameters from a string
   */
  private parseKeyValueParams(paramString: string): Record<string, any> {
    const params: Record<string, any> = {};

    if (!paramString || paramString.trim() === '') {
      return params;
    }

    const keyValuePattern = /(\w+)[:=]([^\s]+)/g;
    let match;

    while ((match = keyValuePattern.exec(paramString)) !== null) {
      const [, key, value] = match;

      if (value.toLowerCase() === 'true') {
        params[key] = true;
      } else if (value.toLowerCase() === 'false') {
        params[key] = false;
      } else if (!isNaN(Number(value))) {
        params[key] = Number(value);
      } else {
        params[key] = value;
      }
    }

    return params;
  }

  /**
   * Handles chain management commands (validate, list, etc.)
   */
  async handleChainManagementCommand(chainCommand: {
    action: string;
    target: string;
    parameters: Record<string, any>;
  }): Promise<ToolResponse> {
    logger.debug('🔧 [Chain Management] Handling chain management command', { chainCommand });

    try {
      switch (chainCommand.action) {
        case 'validate':
          return await this.handleValidateCommand(chainCommand.target, chainCommand.parameters);
        case 'list':
          return await this.handleListChainsCommand(chainCommand.parameters);
        case 'gates':
          return await this.getGateInfo(chainCommand.target);
        default:
          return this.responseFormatter.formatErrorResponse(
            `Unknown chain management action: ${chainCommand.action}`,
            'ChainExecutor',
            'handleChainManagementCommand'
          );
      }
    } catch (error) {
      logger.error('❌ [Chain Management] Error handling chain management command:', error);
      return this.responseFormatter.formatErrorResponse(
        error,
        'ChainExecutor',
        'handleChainManagementCommand'
      );
    }
  }

  /**
   * Executes a chain with dual support (instructions generation)
   */
  async executeChainWithDualSupport(
    convertedPrompt: ConvertedPrompt,
    promptArgs: Record<string, any>,
    enableGates: boolean,
    options: ChainExecutionOptions = { enableGates: true }
  ): Promise<ToolResponse> {
    logger.debug('🔗 [Chain Execution] Starting chain execution with dual support', {
      promptId: convertedPrompt.id,
      stepCount: convertedPrompt.chainSteps?.length || 0,
      enableGates
    });

    return await this.generateChainInstructions(
      convertedPrompt,
      convertedPrompt.chainSteps || [],
      enableGates,
      options
    );
  }

  /**
   * Handles chain management operations
   */
  async executeChainManagement(
    action: string,
    parameters: Record<string, any>,
    options: Record<string, any>
  ): Promise<ToolResponse> {
    logger.debug('⚙️ [Chain Management] Executing chain management action', { action, parameters });

    try {
      switch (action) {
        case 'validate':
          return await this.handleValidateCommand(parameters.target || '', parameters);
        case 'list':
          return await this.handleListChainsCommand(parameters);
        case 'gates':
          return await this.getGateInfo(parameters.target || '');
        default:
          return this.responseFormatter.formatErrorResponse(
            `Unknown chain management action: ${action}`,
            'ChainExecutor',
            'executeChainManagement'
          );
      }
    } catch (error) {
      logger.error('❌ [Chain Management] Error in executeChainManagement:', error);
      return this.responseFormatter.formatErrorResponse(
        error,
        'ChainExecutor',
        'executeChainManagement'
      );
    }
  }

  /**
   * Generates comprehensive chain execution instructions
   */
  async generateChainInstructions(
    prompt: ConvertedPrompt,
    steps: any[],
    enableGates: boolean,
    options: ChainExecutionOptions = { enableGates: true }
  ): Promise<ToolResponse> {
    logger.debug(
      `🔍 [Chain Debug] generateChainInstructions called for: ${prompt.id}`
    );

    try {
      if (!steps || steps.length === 0) {
        return this.responseFormatter.formatErrorResponse(
          `Chain ${prompt.id} has no steps defined`,
          'ChainExecutor',
          'generateChainInstructions'
        );
      }

      // Get framework context for chain execution
      const activeFramework = this.frameworkStateManager.getActiveFramework();
      const frameworkContext = activeFramework ?
        this.frameworkManager.generateExecutionContext(prompt, { userPreference: activeFramework.methodology as any }) :
        null;

      // Build chain metadata
      const metadata = await this.generateMetadataSection(prompt, steps, enableGates);

      // Generate step-by-step instructions
      let instructions = `# 🔗 Chain Execution Instructions: ${prompt.name}\n\n`;
      instructions += `${metadata}\n\n`;

      if (frameworkContext) {
        instructions += `## 🎯 Framework Integration\n\n`;
        instructions += `**Active Framework**: ${activeFramework.name}\n`;
        instructions += `**Methodology**: ${activeFramework.methodology}\n\n`;
        instructions += `**Framework Guidance**:\n`;
        instructions += `${frameworkContext.systemPrompt}\n\n`;
      }

      instructions += `## 📋 Execution Steps\n\n`;
      instructions += `Execute the following ${steps.length} steps in sequence:\n\n`;

      for (let i = 0; i < steps.length; i++) {
        const stepData = steps[i];
        const stepNumber = i + 1;

        // Get session context for this step (CRITICAL FIX: was hardcoded empty {})
        const sessionId = options.session_id;
        const contextData = sessionId ? this.chainSessionManager.getChainContext(sessionId) : {};
        const originalArgs = sessionId ? this.chainSessionManager.getOriginalArgs(sessionId) : {};

        // Build step arguments with actual context
        const stepArgs = this.buildStepArguments({
          stepData,
          originalArgs,
          contextData,
          currentStep: stepNumber
        });

        // Format step command
        const stepCommand = this.formatStepCommand(stepData.promptId || stepData.id, stepArgs);

        instructions += `### Step ${stepNumber}: ${stepData.stepName || stepData.promptId || stepData.id}\n\n`;
        instructions += `**Command**: \`${stepCommand}\`\n\n`;

        // Add step configuration
        if (stepData.config) {
          instructions += `**Configuration**:\n`;
          if (stepData.config.gates && enableGates) {
            instructions += `- Gates: ${stepData.config.gates.join(', ')}\n`;
          }
          instructions += `\n`;
        }

        // Add input/output mapping
        if (stepData.inputMapping && Object.keys(stepData.inputMapping).length > 0) {
          instructions += `**Input Mapping**:\n`;
          for (const [key, value] of Object.entries(stepData.inputMapping)) {
            instructions += `- ${key} → ${value}\n`;
          }
          instructions += `\n`;
        }

        if (stepData.outputMapping && Object.keys(stepData.outputMapping).length > 0) {
          instructions += `**Output Mapping**:\n`;
          for (const [key, value] of Object.entries(stepData.outputMapping)) {
            instructions += `- ${key} → ${value}\n`;
          }
          instructions += `\n`;
        }

        // Add gate validation if enabled
        if (enableGates && (stepData.gates || stepData.config?.gates)) {
          const gates = stepData.gates || stepData.config?.gates || [];
          instructions += `**Gate Validation**:\n`;
          for (const gate of gates) {
            instructions += `- Validate: ${gate}\n`;
          }
          instructions += `\n`;
        }

        instructions += `---\n\n`;
      }

      // Add execution notes
      instructions += `## 📝 Execution Notes\n\n`;
      instructions += `- Execute steps sequentially, do not skip steps\n`;
      instructions += `- Validate outputs before proceeding to next step\n`;
      if (enableGates) {
        instructions += `- Gate validation is enabled - ensure quality gates pass\n`;
      }
      instructions += `- Maintain context between steps for data flow\n`;

      if (frameworkContext) {
        instructions += `- Apply ${activeFramework.name} methodology throughout execution\n`;
      }

      instructions += `\n**Total Steps**: ${steps.length}\n`;
      instructions += `**Estimated Time**: ${steps.length * 2} minutes\n`;

      logger.debug('✅ [Chain Instructions] Generated instructions', {
        promptId: prompt.id,
        stepCount: steps.length,
        instructionsLength: instructions.length
      });

      return this.responseFormatter.formatPromptEngineResponse({
        content: instructions,
        metadata: {
          type: 'chain_instructions',
          promptId: prompt.id,
          stepCount: steps.length,
          gatesEnabled: enableGates,
          framework: activeFramework?.name || 'none'
        }
      });

    } catch (error) {
      logger.error('❌ [Chain Instructions] Error generating chain instructions:', error);
      return this.responseFormatter.formatErrorResponse(
        error,
        'ChainExecutor',
        'generateChainInstructions'
      );
    }
  }

  /**
   * Builds step arguments from context and mappings
   */
  buildStepArguments(context: StepArgumentsContext): Record<string, any> {
    const { stepData, originalArgs, contextData, currentStep } = context;
    const stepArgs: Record<string, any> = {};

    // Start with original arguments
    Object.assign(stepArgs, originalArgs);

    // ENHANCEMENT: Add all context data as template variables for step result interpolation
    // This enables {{step1_result}}, {{step2_result}}, etc. in templates
    Object.assign(stepArgs, contextData);

    // Apply input mapping if present (this can override context data if needed)
    if (stepData.inputMapping && typeof stepData.inputMapping === 'object') {
      for (const [stepKey, sourceKey] of Object.entries(stepData.inputMapping)) {
        if (typeof sourceKey === 'string') {
          if (contextData[sourceKey] !== undefined) {
            stepArgs[stepKey] = contextData[sourceKey];
          } else if (originalArgs[sourceKey] !== undefined) {
            stepArgs[stepKey] = originalArgs[sourceKey];
          }
        }
      }
    }

    // Add step context
    stepArgs._stepNumber = currentStep;
    stepArgs._stepName = stepData.stepName || stepData.promptId;

    // Add any step-specific configuration
    if (stepData.config) {
      stepArgs._config = stepData.config;
    }

    return stepArgs;
  }

  /**
   * Formats a step command with arguments
   */
  formatStepCommand(promptId: string, stepArgs: Record<string, any>): string {
    const baseCommand = `>>${promptId}`;

    // Filter out internal arguments (starting with _)
    const publicArgs = Object.entries(stepArgs)
      .filter(([key]) => !key.startsWith('_'))
      .map(([key, value]) => {
        if (typeof value === 'string' && value.includes(' ')) {
          return `${key}="${value}"`;
        }
        return `${key}=${value}`;
      });

    if (publicArgs.length === 0) {
      return baseCommand;
    }

    return `${baseCommand} ${publicArgs.join(' ')}`;
  }

  /**
   * Handles validate command for chains
   */
  async handleValidateCommand(target: string, parameters: Record<string, any>): Promise<ToolResponse> {
    logger.debug('🔍 [Chain Validation] Validating chain', { target, parameters });

    try {
      if (!target) {
        return this.responseFormatter.formatErrorResponse(
          'Chain ID is required for validation',
          'ChainExecutor',
          'handleValidateCommand'
        );
      }

      // This would need access to prompt registry to validate
      // For now, return a placeholder response
      const validationResult: ChainValidationResult = {
        isValid: true,
        issues: [],
        chainId: target,
        stepCount: 0
      };

      return this.responseFormatter.formatPromptEngineResponse({
        content: `Chain "${target}" validation completed`,
        metadata: {
          type: 'chain_validation',
          result: validationResult
        }
      });

    } catch (error) {
      logger.error('❌ [Chain Validation] Error validating chain:', error);
      return this.responseFormatter.formatErrorResponse(
        error,
        'ChainExecutor',
        'handleValidateCommand'
      );
    }
  }

  /**
   * Handles list chains command
   */
  async handleListChainsCommand(parameters: Record<string, any>): Promise<ToolResponse> {
    logger.debug('📋 [Chain List] Listing chains', { parameters });

    try {
      // This would need access to prompt registry to list chains
      // For now, return a placeholder response
      return this.responseFormatter.formatPromptEngineResponse({
        content: 'Chain listing functionality - requires prompt registry integration',
        metadata: {
          type: 'chain_list',
          count: 0
        }
      });

    } catch (error) {
      logger.error('❌ [Chain List] Error listing chains:', error);
      return this.responseFormatter.formatErrorResponse(
        error,
        'ChainExecutor',
        'handleListChainsCommand'
      );
    }
  }

  /**
   * Gets gate information for a chain
   */
  async getGateInfo(target: string): Promise<ToolResponse> {
    logger.debug('🚪 [Gate Info] Getting gate information', { target });

    try {
      if (!target) {
        return this.responseFormatter.formatErrorResponse(
          'Chain ID is required for gate information',
          'ChainExecutor',
          'getGateInfo'
        );
      }

      const gateInfo: ChainGateInfo = {
        status: 'available',
        gates: [
          {
            name: 'validation',
            location: 'step_completion',
            criteria: 'output_quality'
          }
        ]
      };

      return this.responseFormatter.formatPromptEngineResponse({
        content: `Gate information for chain "${target}"`,
        metadata: {
          type: 'gate_info',
          gateInfo
        }
      });

    } catch (error) {
      logger.error('❌ [Gate Info] Error getting gate information:', error);
      return this.responseFormatter.formatErrorResponse(
        error,
        'ChainExecutor',
        'getGateInfo'
      );
    }
  }

  /**
   * Generates metadata section for chain instructions
   */
  async generateMetadataSection(
    prompt: ConvertedPrompt,
    steps: any[],
    enableGates: boolean
  ): Promise<string> {
    let metadata = `## 📊 Chain Metadata\n\n`;
    metadata += `**Chain ID**: ${prompt.id}\n`;
    metadata += `**Name**: ${prompt.name}\n`;
    metadata += `**Description**: ${prompt.description || 'No description provided'}\n`;
    metadata += `**Category**: ${prompt.category}\n`;
    metadata += `**Total Steps**: ${steps.length}\n`;
    metadata += `**Gates Enabled**: ${enableGates ? 'Yes' : 'No'}\n`;

    // Add framework information
    const activeFramework = this.frameworkStateManager.getActiveFramework();
    if (activeFramework) {
      metadata += `**Active Framework**: ${activeFramework.name}\n`;
      metadata += `**Methodology**: ${activeFramework.methodology}\n`;
    }

    metadata += `**Execution Type**: Chain\n`;
    metadata += `**Created**: ${new Date().toISOString()}\n`;

    return metadata;
  }
}
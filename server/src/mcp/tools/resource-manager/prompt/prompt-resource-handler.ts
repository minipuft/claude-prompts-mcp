// @lifecycle canonical - Prompt resource orchestration for resource_manager.

import { ComparisonEngine } from './analysis/comparison-engine.js';
import { GateAnalyzer } from './analysis/gate-analyzer.js';
import { ObjectDiffGenerator } from './analysis/object-diff-generator.js';
import { PromptAnalyzer } from './analysis/prompt-analyzer.js';
import { PromptResourceContext } from './core/context.js';
import { PromptResourceDependencies, PromptResourceData } from './core/types.js';
import { FileOperations } from './operations/file-operations.js';
import { FilterParser } from './search/filter-parser.js';
import { PromptMatcher } from './search/prompt-matcher.js';
import { PromptDiscoveryProcessor } from './services/prompt-discovery-processor.js';
import { PromptLifecycleProcessor } from './services/prompt-lifecycle-processor.js';
import { PromptVersioningProcessor } from './services/prompt-versioning-processor.js';
import { promptResourceMetadata } from '../../../metadata/definitions/prompt-resource.js';
import { recordActionInvocation } from '../../../metadata/usage-tracker.js';

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { PromptData, Category } from '#modules/prompts/types.js';
import type { PromptResourceActionId } from '../../../metadata/definitions/prompt-resource.js';
import type { ActionDescriptor } from '../../../metadata/definitions/types.js';
import type { PromptResourceHandlerPort } from '../core/types.js';

import { FrameworkManager } from '#engine/frameworks/framework-manager.js';
import { FrameworkStateStore } from '#engine/frameworks/framework-state-store.js';
import { ContentAnalyzer } from '#modules/semantic/content-analyzer.js';
import { VersionHistoryService } from '#modules/versioning/index.js';
import { logMcpToolChange } from '#runtime/resource-change-tracking.js';
import { type Logger, ToolResponse, ConfigManager } from '#shared/types/index.js';
import { ValidationError, handleError as utilsHandleError } from '#shared/utils/index.js';

const PROMPT_RESOURCE_ACTIONS = promptResourceMetadata.data.actions;
const PROMPT_RESOURCE_ACTION_MAP = new Map<PromptResourceActionId, ActionDescriptor>(
  PROMPT_RESOURCE_ACTIONS.map((action) => [action.id as PromptResourceActionId, action])
);

const LEGACY_ACTION_ALIASES: Record<string, string> = {};

export class PromptResourceHandler implements PromptResourceHandlerPort {
  private readonly logger: Logger;
  private readonly dependencies: PromptResourceDependencies;
  private readonly promptAnalyzer: PromptAnalyzer;
  private readonly comparisonEngine: ComparisonEngine;
  private readonly gateAnalyzer: GateAnalyzer;
  private readonly textDiffService: ObjectDiffGenerator;
  private readonly filterParser: FilterParser;
  private readonly promptMatcher: PromptMatcher;
  private readonly fileOperations: FileOperations;
  private readonly versionHistoryService: VersionHistoryService;
  private readonly lifecycleService: PromptLifecycleProcessor;
  private readonly discoveryService: PromptDiscoveryProcessor;
  private readonly versioningService: PromptVersioningProcessor;

  private promptsData: PromptData[] = [];
  private convertedPrompts: ConvertedPrompt[] = [];
  private categories: Category[] = [];

  constructor(dependencies: PromptResourceDependencies) {
    this.dependencies = dependencies;
    this.logger = dependencies.logger;
    this.promptAnalyzer = new PromptAnalyzer(dependencies);
    this.comparisonEngine = new ComparisonEngine(this.logger);
    this.gateAnalyzer = new GateAnalyzer(dependencies);
    this.textDiffService = new ObjectDiffGenerator();
    this.filterParser = new FilterParser(this.logger);
    this.promptMatcher = new PromptMatcher(this.logger);
    this.fileOperations = new FileOperations(dependencies);
    this.versionHistoryService = new VersionHistoryService({
      logger: this.logger,
      configManager: dependencies.configManager,
    });

    const context: PromptResourceContext = {
      dependencies: this.dependencies,
      promptAnalyzer: this.promptAnalyzer,
      comparisonEngine: this.comparisonEngine,
      gateAnalyzer: this.gateAnalyzer,
      textDiffService: this.textDiffService,
      filterParser: this.filterParser,
      promptMatcher: this.promptMatcher,
      fileOperations: this.fileOperations,
      versionHistoryService: this.versionHistoryService,
      getData: () => ({
        promptsData: this.promptsData,
        convertedPrompts: this.convertedPrompts,
        categories: this.categories,
      }),
    };

    this.lifecycleService = new PromptLifecycleProcessor(context);
    this.discoveryService = new PromptDiscoveryProcessor(context);
    this.versioningService = new PromptVersioningProcessor(context);

    this.logger.debug('PromptResourceHandler initialized with modular services');
  }

  updateData(
    promptsData: PromptData[],
    convertedPrompts: ConvertedPrompt[],
    categories: Category[]
  ): void {
    this.promptsData = promptsData;
    this.convertedPrompts = convertedPrompts;
    this.categories = categories;

    const data: PromptResourceData = { promptsData, convertedPrompts, categories };
    this.logger.debug(
      `Updated prompt resource data: ${data.promptsData.length} prompts, ${data.categories.length} categories`
    );
  }

  setDatabasePort(
    db: import('#shared/types/persistence.js').DatabasePort,
    scope?: import('#shared/types/persistence.js').StateStoreOptions
  ): void {
    this.versionHistoryService.setDatabasePort(db, scope);
  }

  setFrameworkStateStore(frameworkStateStore: FrameworkStateStore): void {
    this.dependencies.frameworkStateStore = frameworkStateStore;
    this.logger.debug('Framework state manager set in PromptResourceHandler');
  }

  setFrameworkManager(frameworkManager: FrameworkManager): void {
    this.dependencies.frameworkManager = frameworkManager;
    this.logger.debug('Framework manager set in PromptResourceHandler');
  }

  async handleAction(
    args: {
      action: PromptResourceActionId;
      [key: string]: any;
    },
    _extra: any
  ): Promise<ToolResponse> {
    const { action } = args;
    this.logger.info(`📝 Prompt Resource: Executing action "${action}"`);
    recordActionInvocation('resource_manager', action, 'received');

    try {
      let response: ToolResponse;

      switch (action) {
        case 'create':
          response = await this.lifecycleService.createPrompt(args);
          break;
        case 'validate':
          response = await this.lifecycleService.validatePrompt(args);
          break;
        case 'analyze_type':
          response = await this.discoveryService.analyzePromptType(args);
          break;
        case 'update':
          response = await this.lifecycleService.updatePrompt(args);
          break;
        case 'delete':
          response = await this.lifecycleService.deletePrompt(args);
          break;
        case 'reload':
          response = await this.reloadPrompts(args);
          break;
        case 'list':
          response = await this.discoveryService.listPrompts(args);
          break;
        case 'inspect':
          response = await this.discoveryService.inspectPrompt(args);
          break;
        case 'analyze_gates':
          response = await this.discoveryService.analyzePromptGates(args);
          break;
        case 'guide':
          response = await this.discoveryService.guidePromptActions(args);
          break;
        case 'history':
          response = await this.versioningService.handleHistory(args);
          break;
        case 'rollback':
          response = await this.versioningService.handleRollback(args);
          break;
        case 'compare':
          response = await this.versioningService.handleCompare(args);
          break;
        default:
          recordActionInvocation('resource_manager', action, 'unknown');
          throw new ValidationError(`Unknown action: ${action}`);
      }

      response = this.appendActionWarnings(response, action);
      recordActionInvocation('resource_manager', action, 'success');

      const resourceId = args['id'] as string | undefined;
      if (
        ['create', 'update', 'delete'].includes(action) &&
        response.isError !== true &&
        resourceId !== undefined &&
        resourceId !== ''
      ) {
        const operation =
          action === 'create' ? 'added' : action === 'delete' ? 'removed' : 'modified';
        const promptsDir = this.dependencies.configManager.getResolvedPromptsDirectory();
        const category = (args['category'] as string | undefined) ?? 'general';
        const filePath = `${promptsDir}/${category.toLowerCase().replace(/\s+/g, '-')}/${resourceId}/prompt.yaml`;
        void logMcpToolChange(this.logger, {
          operation,
          resourceType: 'prompt',
          resourceId,
          filePath,
        });
      }

      return response;
    } catch (error) {
      recordActionInvocation('resource_manager', action, 'failure', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.handleError(error, action);
    }
  }

  private async reloadPrompts(args: any): Promise<ToolResponse> {
    const reason = args.reason || 'Manual reload requested';

    let response = `🔄 **Reloading Prompts System**\n\n`;
    response += `**Reason**: ${reason}\n`;
    response += `**Mode**: ${args.full_restart ? 'Full Server Restart' : 'Hot Reload'}\n\n`;

    if (args.full_restart) {
      setTimeout(() => this.dependencies.onRestart(reason), 1000);
      response += `⚡ **Server restart initiated**... Please wait for reconnection.\n`;
    } else {
      await this.dependencies.onRefresh();
      response += `✅ **Hot reload completed** - All prompts refreshed from disk.\n`;
    }

    return { content: [{ type: 'text' as const, text: response }], isError: false };
  }

  private appendActionWarnings(
    response: ToolResponse,
    actionId: PromptResourceActionId
  ): ToolResponse {
    const descriptor = PROMPT_RESOURCE_ACTION_MAP.get(actionId);
    if (!descriptor) {
      return response;
    }

    const warnings: string[] = [];
    if (descriptor.status !== 'working') {
      warnings.push(`Status: ${this.describeActionStatus(descriptor)}`);
    }

    if (descriptor.issues && descriptor.issues.length > 0) {
      descriptor.issues.forEach((issue) => {
        warnings.push(`${issue.severity === 'high' ? '❗' : '⚠️'} ${issue.summary}`);
      });
    }

    if (LEGACY_ACTION_ALIASES[actionId]) {
      warnings.push(`Prefer action="${LEGACY_ACTION_ALIASES[actionId]}" for canonical workflows.`);
    }

    if (warnings.length === 0) {
      return response;
    }

    const originalText = response.content?.[0]?.text ?? '';
    const note = `\n\n---\n⚠️ **Action Notes (${descriptor.displayName})**\n${warnings
      .map((warning) => `- ${warning}`)
      .join('\n')}`;

    return {
      ...response,
      content: [{ type: 'text' as const, text: `${originalText}${note}` }],
      isError: response.isError ?? false,
    };
  }

  private describeActionStatus(action: ActionDescriptor): string {
    switch (action.status) {
      case 'working':
        return '✅ Working';
      case 'planned':
        return '🗺️ Planned';
      case 'untested':
        return '🧪 Untested';
      case 'deprecated':
        return '🛑 Deprecated';
      default:
        return `⚠️ ${action.status}`;
    }
  }

  private handleError(error: unknown, context: string): ToolResponse {
    const { message } = utilsHandleError(error, context, this.logger);
    return { content: [{ type: 'text' as const, text: message }], isError: true };
  }
}

export function createPromptResourceHandler(
  logger: Logger,
  configManager: ConfigManager,
  semanticAnalyzer: ContentAnalyzer,
  frameworkStateStore: FrameworkStateStore | undefined,
  frameworkManager: FrameworkManager | undefined,
  onRefresh: () => Promise<void>,
  onRestart: (reason: string) => Promise<void>
): PromptResourceHandler {
  const dependencies: PromptResourceDependencies = {
    logger,
    configManager,
    semanticAnalyzer,
    onRefresh,
    onRestart,
    ...(frameworkStateStore ? { frameworkStateStore } : {}),
    ...(frameworkManager ? { frameworkManager } : {}),
  };

  return new PromptResourceHandler(dependencies);
}

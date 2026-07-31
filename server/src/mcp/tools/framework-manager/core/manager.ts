// @lifecycle canonical - Thin routing handler for framework MCP tool.
/**
 * Framework Tool Handler
 *
 * Thin routing layer for framework lifecycle management.
 * Domain logic delegated to services:
 * - FrameworkLifecycleProcessor: create, update, delete, reload, switch
 * - FrameworkDiscoveryProcessor: list, inspect
 * - FrameworkVersioningProcessor: history, rollback, compare
 * - FrameworkDraftValidator: scoring, error/success formatting
 * - FrameworkFileWriter: file I/O with merge support
 */

import { VersionHistoryService } from '../../../../modules/versioning/index.js';
import { ObjectDiffGenerator } from '../../resource-manager/prompt/analysis/object-diff-generator.js';
import { FrameworkDiscoveryProcessor } from '../services/framework-discovery-processor.js';
import { FrameworkLifecycleProcessor } from '../services/framework-lifecycle-processor.js';
import { FrameworkVersioningProcessor } from '../services/framework-versioning-processor.js';
import { FrameworkFileWriter } from '../services/methodology-file-writer.js';
import { FrameworkDraftValidator } from '../services/methodology-validator.js';

import type { FrameworkResourceContext } from './context.js';
import type { FrameworkManagerInput, FrameworkManagerDependencies } from './types.js';
import type { FrameworkStateStore } from '../../../../engine/frameworks/framework-state-store.js';
import type { ToolResponse } from '../../../../shared/types/index.js';

export class FrameworkToolHandler {
  private readonly ctx: FrameworkResourceContext;
  private readonly lifecycle: FrameworkLifecycleProcessor;
  private readonly discovery: FrameworkDiscoveryProcessor;
  private readonly versioning: FrameworkVersioningProcessor;

  constructor(deps: FrameworkManagerDependencies) {
    const validationService = new FrameworkDraftValidator();

    this.ctx = {
      logger: deps.logger,
      frameworkManager: deps.frameworkManager,
      frameworkStateStore: deps.frameworkStateStore,
      configManager: deps.configManager,
      fileService: new FrameworkFileWriter({
        logger: deps.logger,
        configManager: deps.configManager,
      }),
      textDiffService: new ObjectDiffGenerator(),
      versionHistoryService: new VersionHistoryService({
        logger: deps.logger,
        configManager: deps.configManager,
      }),
      onRefresh: deps.onRefresh,
      onToolsUpdate: deps.onToolsUpdate,
    };

    this.lifecycle = new FrameworkLifecycleProcessor(this.ctx, validationService);
    this.discovery = new FrameworkDiscoveryProcessor(this.ctx, validationService);
    this.versioning = new FrameworkVersioningProcessor(this.ctx);

    deps.logger.debug('FrameworkToolHandler initialized');
  }

  setDatabasePort(db: import('../../../../shared/types/persistence.js').DatabasePort): void {
    this.ctx.versionHistoryService.setDatabasePort(db);
  }

  /**
   * Set framework state store (called during late initialization).
   * Updates the shared context so all services see the new store.
   */
  setFrameworkStateStore(fsm: FrameworkStateStore): void {
    this.ctx.frameworkStateStore = fsm;
  }

  async handleAction(
    args: FrameworkManagerInput,
    _context: Record<string, unknown>
  ): Promise<ToolResponse> {
    const { action } = args;

    try {
      switch (action) {
        case 'create':
          return await this.lifecycle.handleCreate(args);
        case 'update':
          return await this.lifecycle.handleUpdate(args);
        case 'delete':
          return await this.lifecycle.handleDelete(args);
        case 'reload':
          return await this.lifecycle.handleReload(args);
        case 'switch':
          return await this.lifecycle.handleSwitch(args);
        case 'list':
          return await this.discovery.handleList(args);
        case 'inspect':
          return await this.discovery.handleInspect(args);
        case 'history':
          return await this.versioning.handleHistory(args);
        case 'rollback':
          return await this.versioning.handleRollback(args);
        case 'compare':
          return await this.versioning.handleCompare(args);
        default:
          return {
            content: [{ type: 'text', text: `Error: Unknown action: ${action}` }],
            isError: true,
          };
      }
    } catch (error) {
      this.ctx.logger.error(`framework_manager error:`, error);
      return {
        content: [
          {
            type: 'text',
            text: `Error: Error in framework_manager: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
}

export function createFrameworkToolHandler(
  deps: FrameworkManagerDependencies
): FrameworkToolHandler {
  return new FrameworkToolHandler(deps);
}

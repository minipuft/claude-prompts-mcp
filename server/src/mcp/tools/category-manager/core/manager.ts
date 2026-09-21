// @lifecycle canonical - Thin category tool handler routing actions to services.
/**
 * Category Tool Handler
 *
 * Thin routing layer for prompt-category lifecycle management.
 * Domain logic delegated to:
 * - CategoryLifecycleProcessor: create, update, delete, reload
 * - CategoryDiscoveryProcessor: list, inspect
 * - CategoryVersioningProcessor: history, rollback, compare
 */

import { ObjectDiffGenerator } from '../../resource-manager/prompt/analysis/object-diff-generator.js';
import { resolveDispatchAction } from '../../shared/preview-action.js';
import { CategoryDiscoveryProcessor } from '../services/category-discovery-processor.js';
import { CategoryFileWriter } from '../services/category-file-writer.js';
import { CategoryLifecycleProcessor } from '../services/category-lifecycle-processor.js';
import { CategoryVersioningProcessor } from '../services/category-versioning-processor.js';

import type { ToolResponse } from '#shared/types/index.js';
import type { CategoryResourceContext } from './context.js';
import type { CategoryManagerInput, CategoryManagerDependencies } from './types.js';

import { VersionHistoryService } from '#modules/versioning/index.js';

export class CategoryToolHandler {
  private readonly lifecycle: CategoryLifecycleProcessor;
  private readonly discovery: CategoryDiscoveryProcessor;
  private readonly versioning: CategoryVersioningProcessor;
  private readonly versionHistoryService: VersionHistoryService;

  constructor(deps: CategoryManagerDependencies) {
    this.versionHistoryService = new VersionHistoryService({
      logger: deps.logger,
      configManager: deps.configManager,
      resourceFileLocator: deps.resourceFileLocator,
    });

    const ctx: CategoryResourceContext = {
      logger: deps.logger,
      configManager: deps.configManager,
      textDiffService: new ObjectDiffGenerator(),
      versionHistoryService: this.versionHistoryService,
      categoryFileService: new CategoryFileWriter({
        logger: deps.logger,
        configManager: deps.configManager,
      }),
      onRefresh: deps.onRefresh,
    };

    this.lifecycle = new CategoryLifecycleProcessor(ctx);
    this.discovery = new CategoryDiscoveryProcessor(ctx);
    this.versioning = new CategoryVersioningProcessor(ctx);

    deps.logger.debug('CategoryToolHandler initialized');
  }

  setDatabasePort(
    db: import('#shared/types/persistence.js').DatabasePort,
    scope?: import('#shared/types/persistence.js').StateStoreOptions
  ): void {
    this.versionHistoryService.setDatabasePort(db, scope);
  }

  async handleAction(
    args: CategoryManagerInput,
    _context: Record<string, unknown>
  ): Promise<ToolResponse> {
    // Bound to `action` rather than switched on inline: `validate:registry-coherence` locates
    // this dispatch table by the literal `switch (action)`, and an inline call expression makes
    // it report zero rows for this file — which reads as a clean result.
    const action = resolveDispatchAction(args);
    switch (action) {
      case 'create':
        return this.lifecycle.handleCreate(args);
      case 'update':
        return this.lifecycle.handleUpdate(args);
      case 'delete':
        return this.lifecycle.handleDelete(args);
      case 'reload':
        return this.lifecycle.handleReload(args);
      case 'list':
        return this.discovery.handleList(args);
      case 'inspect':
        return this.discovery.handleInspect(args);
      case 'history':
        return this.versioning.handleHistory(args);
      case 'rollback':
        return this.versioning.handleRollback(args);
      case 'compare':
        return this.versioning.handleCompare(args);
      // Reached only when `preview_action` is absent, which the router refuses ahead of dispatch.
      case 'preview':
        return {
          content: [
            {
              type: 'text',
              text:
                '❌ action:"preview" requires \'preview_action\' — a preview of WHAT. ' +
                'Valid values for category are: "delete", "rollback".',
            },
          ],
          isError: true,
        };
      default:
        return {
          content: [{ type: 'text', text: `❌ Unknown action: ${args.action}` }],
          isError: true,
        };
    }
  }
}

export function createCategoryToolHandler(deps: CategoryManagerDependencies): CategoryToolHandler {
  return new CategoryToolHandler(deps);
}

// @lifecycle canonical - Thin gate tool handler routing actions to services.
/**
 * Gate Tool Handler
 *
 * Thin routing layer for gate lifecycle management.
 * Domain logic delegated to:
 * - GateLifecycleProcessor: create, update, delete, reload
 * - GateDiscoveryProcessor: list, inspect
 * - GateVersioningProcessor: history, rollback, compare
 */

import { ObjectDiffGenerator } from '../../resource-manager/prompt/analysis/object-diff-generator.js';
import { resolveDispatchAction } from '../../shared/preview-action.js';
import { GateDiscoveryProcessor } from '../services/gate-discovery-processor.js';
import { GateFileWriter } from '../services/gate-file-writer.js';
import { GateLifecycleProcessor } from '../services/gate-lifecycle-processor.js';
import { GateVersioningProcessor } from '../services/gate-versioning-processor.js';

import type { ToolResponse } from '#shared/types/index.js';
import type { GateResourceContext } from './context.js';
import type { GateManagerInput, GateManagerDependencies } from './types.js';

import { VersionHistoryService } from '#modules/versioning/index.js';

export class GateToolHandler {
  private readonly lifecycle: GateLifecycleProcessor;
  private readonly discovery: GateDiscoveryProcessor;
  private readonly versioning: GateVersioningProcessor;
  private readonly versionHistoryService: VersionHistoryService;

  constructor(deps: GateManagerDependencies) {
    this.versionHistoryService = new VersionHistoryService({
      logger: deps.logger,
      configManager: deps.configManager,
    });

    const ctx: GateResourceContext = {
      logger: deps.logger,
      gateManager: deps.gateManager,
      configManager: deps.configManager,
      textDiffService: new ObjectDiffGenerator(),
      versionHistoryService: this.versionHistoryService,
      gateFileService: new GateFileWriter({
        logger: deps.logger,
        configManager: deps.configManager,
      }),
      onRefresh: deps.onRefresh,
    };

    this.lifecycle = new GateLifecycleProcessor(ctx);
    this.discovery = new GateDiscoveryProcessor(ctx);
    this.versioning = new GateVersioningProcessor(ctx);

    deps.logger.debug('GateToolHandler initialized');
  }

  setDatabasePort(
    db: import('#shared/types/persistence.js').DatabasePort,
    scope?: import('#shared/types/persistence.js').StateStoreOptions
  ): void {
    this.versionHistoryService.setDatabasePort(db, scope);
  }

  async handleAction(args: GateManagerInput, _context: Record<string, any>): Promise<ToolResponse> {
    // A preview dispatches to its target's own handler and that handler returns before it writes,
    // so there is one delete path and one rollback path rather than a second read-only copy of
    // each. `args.action` stays `'preview'`, which is what those early returns read.
    //
    // Bound to `action` rather than switched on inline: `validate:registry-coherence` locates this
    // dispatch table by the literal `switch (action)`, and an inline call expression makes it
    // report zero rows for this file — which reads as a clean result.
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
                'Valid values for gate are: "delete", "rollback".',
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

export function createGateToolHandler(deps: GateManagerDependencies): GateToolHandler {
  return new GateToolHandler(deps);
}

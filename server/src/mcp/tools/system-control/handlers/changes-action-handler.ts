// @lifecycle canonical - Handler for resource change tracking operations.

import { ActionHandler } from '../core/action-handler-base.js';

import type { ToolResponse, ChangeSource, TrackedResourceType } from '#shared/types/index.js';

import { getResourceChangeTracker } from '#runtime/resource-change-tracking.js';

export class ChangesActionHandler extends ActionHandler {
  async execute(args: any): Promise<ToolResponse> {
    const tracker = getResourceChangeTracker();

    if (tracker === undefined) {
      return this.createMinimalSystemResponse(
        '⚠️ **Resource Change Tracker Not Initialized**\n\nThe resource change tracker is not available. This may occur if the server was started without a valid server root directory.',
        'changes_error'
      );
    }

    const operation = (args['operation'] as string | undefined) ?? 'list';

    switch (operation) {
      case 'list':
        return await this.listChanges(args);
      default:
        throw new Error(`Unknown changes operation: ${operation}. Valid operations: list`);
    }
  }

  private async listChanges(args: Record<string, unknown>): Promise<ToolResponse> {
    const tracker = getResourceChangeTracker();
    if (tracker === undefined) {
      throw new Error('Resource change tracker not initialized');
    }

    const limit = typeof args['limit'] === 'number' ? args['limit'] : 50;
    const source = args['source'] as ChangeSource | undefined;
    const resourceType = args['resourceType'] as TrackedResourceType | undefined;
    const since = args['since'] as string | undefined;

    const changes = await tracker.getChanges({
      limit,
      source,
      resourceType,
      since,
    });

    if (changes.length === 0) {
      let message = '📭 **No Resource Changes Found**\n\n';
      message += 'No changes have been recorded';
      if (source !== undefined) message += ` from source \`${source}\``;
      if (resourceType !== undefined) message += ` for type \`${resourceType}\``;
      if (since !== undefined && since !== '') message += ` since \`${since}\``;
      message += '.';
      return this.createMinimalSystemResponse(message, 'changes_list');
    }

    let response = `📋 **Resource Changes** (${changes.length}${limit > 0 ? ` of max ${limit}` : ''})\n\n`;

    const bySource = new Map<string, typeof changes>();
    for (const change of changes) {
      const group = bySource.get(change.source) ?? [];
      group.push(change);
      bySource.set(change.source, group);
    }

    for (const [src, srcChanges] of bySource) {
      const sourceIcon =
        src === 'mcp-tool' ? '🔧' : src === 'filesystem' ? '📁' : src === 'external' ? '🌐' : '❓';
      response += `### ${sourceIcon} ${src} (${srcChanges.length})\n\n`;

      for (const change of srcChanges.slice(0, 10)) {
        const timestamp = new Date(change.timestamp).toLocaleString();
        const opIcon =
          change.operation === 'added' ? '➕' : change.operation === 'removed' ? '➖' : '✏️';

        response += `${opIcon} **${change.resourceType}**: \`${change.resourceId}\`\n`;
        response += `   - Time: ${timestamp}\n`;
        response += `   - Operation: ${change.operation}\n`;
        if (change.contentHash !== '') {
          response += `   - Hash: \`${change.contentHash.slice(0, 16)}...\`\n`;
        }
        response += '\n';
      }

      if (srcChanges.length > 10) {
        response += `_...and ${srcChanges.length - 10} more from ${src}_\n\n`;
      }
    }

    response += '---\n';
    response += '💡 **Filter options:**\n';
    response += '- `source`: "filesystem" | "mcp-tool" | "external"\n';
    response += '- `resourceType`: "prompt" | "gate"\n';
    response += '- `since`: ISO timestamp (e.g., "2026-01-20T00:00:00Z")\n';
    response += '- `limit`: Number of entries to return (default: 50)\n';

    return this.createMinimalSystemResponse(response, 'changes_list');
  }
}

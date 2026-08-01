// @lifecycle canonical - Handler for guide/discovery operations.

import { systemControlMetadata } from '../../../metadata/definitions/system-control.js';
import { ActionHandler } from '../core/action-handler-base.js';

import type { ToolResponse } from '#shared/types/index.js';

export class GuideActionHandler extends ActionHandler {
  async execute(args: any): Promise<ToolResponse> {
    const topic = typeof args.topic === 'string' ? args.topic.trim().toLowerCase() : '';
    const includePlanned = args.include_planned !== false;
    const operations = systemControlMetadata.data.operations.filter(
      (operation) => includePlanned || operation.status !== 'planned'
    );

    const filtered =
      topic.length > 0
        ? operations.filter(
            (operation) =>
              operation.category.toLowerCase().includes(topic) ||
              operation.id.toLowerCase().includes(topic) ||
              operation.description.toLowerCase().includes(topic)
          )
        : operations;

    const lines: string[] = [];
    lines.push('🧭 **System Control Guide**');
    if (topic) {
      lines.push(`Focus: \`${topic}\``);
    } else {
      lines.push('Use `system_control action:"guide" topic:"framework"` for focused help.');
    }

    if (filtered.length === 0) {
      lines.push(
        includePlanned
          ? 'No operations matched the requested topic.'
          : 'No stable operations matched the requested topic. Set `include_planned:true` to view planned commands.'
      );
    } else {
      filtered.forEach((operation) => {
        let entry = `- \`${operation.id}\` (${this.describeStatus(operation.status)}) — ${
          operation.description
        }`;
        if (operation.issues && operation.issues.length > 0) {
          entry += `\n  Issues: ${operation.issues
            .map((issue) => `${issue.severity === 'high' ? '❗' : '⚠️'} ${issue.summary}`)
            .join(' • ')}`;
        }
        lines.push(entry);
      });
    }

    if (!includePlanned) {
      lines.push('Include planned operations with `include_planned:true`.');
    }

    return this.createMinimalSystemResponse(lines.join('\n\n'), 'guide');
  }

  private describeStatus(status: string): string {
    switch (status) {
      case 'working':
        return '✅ Working';
      case 'planned':
        return '🗺️ Planned';
      case 'untested':
        return '🧪 Untested';
      case 'deprecated':
        return '🛑 Deprecated';
      default:
        return `⚠️ ${status}`;
    }
  }
}

// @lifecycle canonical - Gate versioning operations: history, rollback, compare.

import type { ToolResponse } from '#shared/types/index.js';
import type { GateResourceContext } from '../core/context.js';
import type { GateManagerInput, GateCreationData } from '../core/types.js';

export class GateVersioningProcessor {
  constructor(private readonly ctx: GateResourceContext) {}

  async handleHistory(args: GateManagerInput): Promise<ToolResponse> {
    const { id, limit } = args;

    if (!id) return this.error('Gate ID is required for history action');

    if (!this.ctx.gateManager.has(id)) {
      return this.error(`Gate '${id}' not found`);
    }

    const history = await this.ctx.versionHistoryService.loadHistory('gate', id);

    if (!history || history.versions.length === 0) {
      return this.success(
        `No version history for gate '${id}'\n\n` +
          `Version history is created automatically when updates are made.`
      );
    }

    const formatted = this.ctx.versionHistoryService.formatHistoryForDisplay(history, limit ?? 10);
    return this.success(formatted);
  }

  async handleRollback(args: GateManagerInput): Promise<ToolResponse> {
    const { id, version, confirm } = args;

    if (!id) return this.error('Gate ID is required for rollback action');
    if (version === undefined) {
      return this.error('Version number is required for rollback action');
    }
    if (!confirm) {
      return this.error(
        `⚠️ Rollback requires confirmation.\n\n` +
          `To rollback gate '${id}' to version ${version}, set confirm: true`
      );
    }

    const existingGate = this.ctx.gateManager.get(id);
    if (!existingGate) {
      return this.error(`Gate '${id}' not found`);
    }

    const currentState: Record<string, unknown> = {
      id: existingGate.gateId,
      name: existingGate.name,
      type: existingGate.type,
      description: existingGate.description,
      guidance: existingGate.getGuidance(),
    };

    const result = await this.ctx.versionHistoryService.rollback('gate', id, version, currentState);
    if (!result.success) {
      return this.error(`Rollback failed: ${result.error}`);
    }

    const snapshot = result.snapshot;
    if (!snapshot) {
      return this.error('Rollback failed: No snapshot found in target version');
    }

    const gateData: GateCreationData = {
      id: String(snapshot['id'] ?? id),
      name: String(snapshot['name'] ?? existingGate.name),
      type: (snapshot['type'] as 'validation' | 'guidance') ?? existingGate.type ?? 'validation',
      description: String(snapshot['description'] ?? existingGate.description),
      guidance: String(snapshot['guidance'] ?? existingGate.getGuidance()),
    };

    const writeResult = await this.ctx.gateFileService.writeGateFiles(gateData);
    if (!writeResult.success) {
      return this.error(`Rollback write failed: ${writeResult.error}`);
    }

    await this.ctx.gateManager.reload(id);

    return this.success(
      `✅ Gate '${id}' rolled back to version ${version}\n\n` +
        `📜 Current state saved as version ${result.saved_version}\n` +
        `🔄 Gate reloaded with restored content`
    );
  }

  async handleCompare(args: GateManagerInput): Promise<ToolResponse> {
    const { id, from_version, to_version } = args;

    if (!id) return this.error('Gate ID is required for compare action');
    if (from_version === undefined || to_version === undefined) {
      return this.error('Both from_version and to_version are required for compare action');
    }

    if (!this.ctx.gateManager.has(id)) {
      return this.error(`Gate '${id}' not found`);
    }

    const result = await this.ctx.versionHistoryService.compareVersions(
      'gate',
      id,
      from_version,
      to_version
    );

    if (!result.success) {
      return this.error(`Compare failed: ${result.error}`);
    }

    const diffResult = this.ctx.textDiffService.generateObjectDiff(
      result.from!.snapshot,
      result.to!.snapshot,
      `${id}/gate.yaml`
    );

    let response =
      `📊 **Version Comparison**: ${id}\n\n` +
      `| Property | Version ${from_version} | Version ${to_version} |\n` +
      `|----------|-----------|------------|\n` +
      `| Date | ${new Date(result.from!.date).toLocaleString()} | ${new Date(result.to!.date).toLocaleString()} |\n` +
      `| Description | ${result.from!.description} | ${result.to!.description} |\n\n`;

    if (diffResult.hasChanges) {
      response += `${diffResult.formatted}\n`;
    } else {
      response += `No differences found between versions.\n`;
    }

    return this.success(response);
  }

  private success(text: string): ToolResponse {
    return { content: [{ type: 'text', text }], isError: false };
  }

  private error(text: string): ToolResponse {
    return { content: [{ type: 'text', text: `❌ ${text}` }], isError: true };
  }
}

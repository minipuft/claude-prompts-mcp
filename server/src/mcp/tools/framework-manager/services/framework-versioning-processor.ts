// @lifecycle canonical - Framework versioning operations: history, rollback, compare.

import type { ToolResponse } from '#shared/types/index.js';
import type { FrameworkResourceContext } from '../core/context.js';
import type { FrameworkManagerInput, FrameworkCreationData } from '../core/types.js';

export class FrameworkVersioningProcessor {
  constructor(private readonly ctx: FrameworkResourceContext) {}

  async handleHistory(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id, limit } = args;

    if (id === undefined || id === '') {
      return this.error('Framework ID is required for history action');
    }

    const framework = this.ctx.frameworkManager.getFramework(id);
    if (framework === undefined) {
      return this.error(`Framework '${id}' not found`);
    }

    const history = await this.ctx.versionHistoryService.loadHistory('framework', id);

    if (!history || history.versions.length === 0) {
      return this.success(
        `No version history for framework '${id}'\n\n` +
          `Version history is created automatically when updates are made.`
      );
    }

    const formatted = this.ctx.versionHistoryService.formatHistoryForDisplay(history, limit ?? 10);
    return this.success(formatted);
  }

  async handleRollback(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id, version, confirm } = args;

    if (id === undefined || id === '') {
      return this.error('Framework ID is required for rollback action');
    }
    if (version === undefined) {
      return this.error('Version number is required for rollback action');
    }
    if (confirm !== true) {
      return this.error(
        `⚠️ Rollback requires confirmation.\n\n` +
          `To rollback framework '${id}' to version ${version}, set confirm: true`
      );
    }

    const existingFramework = this.ctx.frameworkManager.getFramework(id);
    if (existingFramework === undefined) {
      return this.error(`Framework '${id}' not found`);
    }

    // Load existing data to capture current state
    const existingData = await this.ctx.fileService.loadExistingFramework(id);
    if (existingData === null) {
      return this.error(`Failed to load current framework state`);
    }

    // Capture current state
    const currentState: Record<string, unknown> = {
      id: existingData.framework['id'],
      name: existingData.framework['name'],
      type: existingData.framework['type'],
      description: existingData.framework['description'],
      enabled: existingData.framework['enabled'],
    };

    // Perform rollback
    const result = await this.ctx.versionHistoryService.rollback(
      'framework',
      id,
      version,
      currentState
    );

    if (!result.success) {
      return this.error(`Rollback failed: ${result.error}`);
    }

    const snapshot = result.snapshot;
    if (!snapshot) {
      return this.error('Rollback failed: No snapshot found in target version');
    }

    // Rebuild framework data from snapshot
    const frameworkData: Partial<FrameworkCreationData> & { id: string } = {
      id,
      name: String(snapshot['name'] ?? existingFramework.name),
      type: String(snapshot['type'] ?? existingData.framework['type']),
      description: String(snapshot['description'] ?? existingData.framework['description']),
      enabled: (snapshot['enabled'] as boolean) ?? existingData.framework['enabled'],
      system_prompt_guidance: existingData.systemPrompt ?? '',
    };

    // Write restored framework files
    const writeResult = await this.ctx.fileService.writeFrameworkFiles(frameworkData, existingData);
    if (!writeResult.success) {
      return this.error(`Rollback write failed: ${writeResult.error}`);
    }

    // Trigger refresh
    await this.ctx.onRefresh?.();

    return this.success(
      `✅ Framework '${id}' rolled back to version ${version}\n\n` +
        `📜 Current state saved as version ${result.saved_version}\n` +
        `🔄 Framework registry reloaded`
    );
  }

  async handleCompare(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id, from_version, to_version } = args;

    if (id === undefined || id === '') {
      return this.error('Framework ID is required for compare action');
    }
    if (from_version === undefined || to_version === undefined) {
      return this.error('Both from_version and to_version are required for compare action');
    }

    const framework = this.ctx.frameworkManager.getFramework(id);
    if (framework === undefined) {
      return this.error(`Framework '${id}' not found`);
    }

    const result = await this.ctx.versionHistoryService.compareVersions(
      'framework',
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
      `${id}/framework.yaml`
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
    return { content: [{ type: 'text', text: `Error: ${text}` }], isError: true };
  }
}

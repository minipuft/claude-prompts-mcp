// @lifecycle canonical - Framework discovery operations: list, inspect.

import type { FrameworkDraftValidator } from './methodology-validator.js';
import type { ToolResponse } from '../../../../shared/types/index.js';
import type { FrameworkResourceContext } from '../core/context.js';
import type { FrameworkManagerInput } from '../core/types.js';

export class FrameworkDiscoveryProcessor {
  constructor(
    private readonly ctx: FrameworkResourceContext,
    private readonly validationService: FrameworkDraftValidator
  ) {}

  async handleList(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { enabled_only = true } = args;

    const frameworks = this.ctx.frameworkManager.listFrameworks(enabled_only);
    const activeFramework = this.ctx.frameworkStateStore?.getActiveFramework();

    if (frameworks.length === 0) {
      return this.success(
        `📋 No frameworks found${enabled_only ? ' (enabled only)' : ''}\n\n` +
          `Use resource_manager(resource_type:"methodology", action:"create", ...) to add a new methodology.`
      );
    }

    const frameworkList = frameworks
      .map((fw) => {
        const isActive = activeFramework?.id === fw.id;
        const activeIndicator = isActive ? ' ← Active' : '';
        return `  🧭 ${fw.id}: ${fw.name}${activeIndicator}`;
      })
      .join('\n');

    const activeInfo =
      activeFramework !== undefined
        ? `\n📍 Active Framework: ${activeFramework.type !== '' ? activeFramework.type : activeFramework.id}`
        : '\n📍 No active framework';

    return this.success(
      `📋 Frameworks (${frameworks.length} total)\n\n` + `${frameworkList}\n` + `${activeInfo}`
    );
  }

  async handleInspect(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id } = args;

    if (id === undefined || id === '') {
      return this.error('Methodology ID is required for inspect action');
    }

    const framework = this.ctx.frameworkManager.getFramework(id);

    if (framework === undefined) {
      return this.error(`Methodology '${id}' not found`);
    }

    const isActive = this.ctx.frameworkStateStore?.getActiveFramework()?.id === framework.id;
    const activeStatus = isActive ? 'Active' : 'Inactive';

    // Load methodology data from disk to calculate validation score
    let validationInfo = '';
    try {
      const existingData = await this.ctx.fileService.loadExistingMethodology(id);
      if (existingData !== null) {
        const creationData = this.ctx.fileService.toMethodologyCreationData(id, existingData);
        if (creationData !== null) {
          const validation = this.validationService.validate(creationData);
          validationInfo = `\n\n**Quality:** ${validation.score}% (${validation.level})`;
          if (validation.warnings.length > 0) {
            validationInfo += `\n**Recommendations:**\n${validation.warnings
              .slice(0, 3)
              .map((w) => `  • ${w}`)
              .join('\n')}`;
          }
        }
      }
    } catch (error) {
      this.ctx.logger.debug(`Could not load methodology data for validation: ${id}`, { error });
    }

    return this.success(
      `Methodology: ${framework.name}\n\n` +
        `Details:\n` +
        `  ID: ${framework.id}\n` +
        `  Type: ${framework.type}\n` +
        `  Status: ${activeStatus}\n` +
        `  Enabled: ${framework.enabled ? 'Yes' : 'No'}\n` +
        `  Description: ${framework.description || '(none)'}` +
        `${validationInfo}`
    );
  }

  private success(text: string): ToolResponse {
    return { content: [{ type: 'text', text }], isError: false };
  }

  private error(text: string): ToolResponse {
    return { content: [{ type: 'text', text: `Error: ${text}` }], isError: true };
  }
}

// @lifecycle canonical - Framework discovery operations: list, inspect.

import { renderAdvancedFrameworkFields } from './framework-advanced-field-summary.js';
import {
  formatQuarantineSection,
  formatQuarantinedInspect,
  formatShadowedNote,
  summarizeQuarantine,
  type QuarantineFinding,
} from '../../shared/quarantine-report.js';

import type { ToolResponse } from '#shared/types/index.js';
import type { FrameworkDraftValidator } from './framework-draft-validator.js';
import type { FrameworkResourceContext } from '../core/context.js';
import type { FrameworkManagerInput } from '../core/types.js';

export class FrameworkDiscoveryProcessor {
  constructor(
    private readonly ctx: FrameworkResourceContext,
    private readonly validationService: FrameworkDraftValidator
  ) {}

  /**
   * Every refused framework file on disk, paired with whatever is serving its id instead.
   *
   * Asks the manager on each call rather than holding a bound view: the runtime loader that owns
   * the collection is built inside the registry's `initialize()`, so a view captured at
   * construction would be the empty stand-in for the process's whole life.
   *
   * `sourceRoot` comes off the loaded definition, where `RuntimeFrameworkLoader` stamped the root
   * it read the file from (P4.18), carried through `FrameworkManager`'s projection. Passed through
   * untouched: this processor must not infer which root serves an id.
   *
   * Ids are lowercased on the way in, and until P4.18 they were not — which made this pairing
   * dead. `generateSingleFrameworkDefinition` upper-cases every served id while a quarantine
   * record's id is the lower-cased directory name, so no record ever matched a served framework
   * and the `list` surface announced no shadow at all. `handleInspect` lowercases already, which
   * is why the two surfaces disagreed.
   */
  private quarantineFindings(): QuarantineFinding[] {
    const records = this.ctx.frameworkManager.getQuarantine().list();
    if (records.length === 0) return [];
    return summarizeQuarantine(
      records,
      this.ctx.frameworkManager.listFrameworks(false).map((framework) => ({
        id: framework.id.toLowerCase(),
        sourceRoot: framework.sourceRoot,
      }))
    );
  }

  async handleList(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { enabled_only = true } = args;

    const frameworks = this.ctx.frameworkManager.listFrameworks(enabled_only);
    const activeFramework = this.ctx.frameworkStateStore?.getActiveFramework();

    if (frameworks.length === 0) {
      // The quarantine section belongs on THIS branch above all others: a root whose frameworks all
      // failed to load produces exactly this response, and "no frameworks found" for a directory
      // full of framework.yaml files is the least actionable thing the tool can say.
      return this.success(
        `📋 No frameworks found${enabled_only ? ' (enabled only)' : ''}\n\n` +
          `Use resource_manager(resource_type:"framework", action:"create", ...) to add a new framework.` +
          formatQuarantineSection(this.quarantineFindings(), 'framework')
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
      `📋 Frameworks (${frameworks.length} total)\n\n` +
        `${frameworkList}\n` +
        `${activeInfo}` +
        formatQuarantineSection(this.quarantineFindings(), 'framework')
    );
  }

  async handleInspect(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id } = args;

    if (id === undefined || id === '') {
      return this.error('Framework ID is required for inspect action');
    }

    const framework = this.ctx.frameworkManager.getFramework(id);

    if (framework === undefined) {
      // `Framework '<id>' not found` is true of the registry and false of the disk. A framework
      // file the loader refused is exactly the one an operator needs to reach, and this was the
      // surface that denied it existed — the same shape P4.9 removed for prompts.
      const quarantined = this.ctx.frameworkManager.getQuarantine().byId(id.toLowerCase());
      if (quarantined.length > 0) {
        return this.error(formatQuarantinedInspect(quarantined, 'framework'));
      }
      return this.error(`Framework '${id}' not found`);
    }

    const isActive = this.ctx.frameworkStateStore?.getActiveFramework()?.id === framework.id;
    const activeStatus = isActive ? 'Active' : 'Inactive';

    // Load framework data from disk to calculate validation score, and — P4.11 — to read back the
    // 11 advanced fields `update` already writes. One load serves both: `creationData` is the same
    // disk-derived object each consumes, so this stays the single read-back source (ruling R1)
    // rather than a second derivation next to the quality score.
    let validationInfo = '';
    let advancedFieldsInfo = '';
    try {
      const existingData = await this.ctx.fileService.loadExistingFramework(id);
      if (existingData !== null) {
        const creationData = this.ctx.fileService.toFrameworkCreationData(id, existingData);
        if (creationData !== null) {
          const validation = this.validationService.validate(creationData);
          validationInfo = `\n\n**Quality:** ${validation.score}% (${validation.level})`;
          if (validation.warnings.length > 0) {
            validationInfo += `\n**Recommendations:**\n${validation.warnings
              .slice(0, 3)
              .map((w) => `  • ${w}`)
              .join('\n')}`;
          }
          advancedFieldsInfo = renderAdvancedFrameworkFields(creationData);
        }
      }
    } catch (error) {
      this.ctx.logger.debug(`Could not load framework data for validation: ${id}`, { error });
    }

    // Announce the fallback. The served definition is correct and the operator asked about it —
    // but if a file for the same id failed to load, their edit to that file is inert, and nothing
    // else in this response would tell them. Empty for every healthy framework.
    const shadowedNote = formatShadowedNote(
      this.ctx.frameworkManager.getQuarantine().byId(framework.id.toLowerCase()),
      // The root serving what the operator is reading — the loader's own stamp, so the claim
      // "repairing that file will change what this id serves" can be checked before acting on it.
      framework.sourceRoot
    );

    return this.success(
      `Framework: ${framework.name}\n\n` +
        `Details:\n` +
        `  ID: ${framework.id}\n` +
        `  Type: ${framework.type}\n` +
        `  Status: ${activeStatus}\n` +
        `  Enabled: ${framework.enabled ? 'Yes' : 'No'}\n` +
        `  Description: ${framework.description || '(none)'}` +
        `${validationInfo}` +
        `${advancedFieldsInfo}` +
        shadowedNote
    );
  }

  private success(text: string): ToolResponse {
    return { content: [{ type: 'text', text }], isError: false };
  }

  private error(text: string): ToolResponse {
    return { content: [{ type: 'text', text: `Error: ${text}` }], isError: true };
  }
}

// @lifecycle canonical - Gate read-only operations: list, inspect.

import {
  formatQuarantineSection,
  formatQuarantinedInspect,
  formatShadowedNote,
  summarizeQuarantine,
  type QuarantineFinding,
} from '../../shared/quarantine-report.js';

import type { ToolResponse } from '#shared/types/index.js';
import type { GateResourceContext } from '../core/context.js';
import type { GateManagerInput } from '../core/types.js';

export class GateDiscoveryProcessor {
  constructor(private readonly ctx: GateResourceContext) {}

  /**
   * Every refused gate file on disk, paired with whatever is serving its id instead.
   *
   * Asks the manager on each call rather than holding a bound view: the loader that owns the
   * collection is built inside the registry's `initialize()`, so a view captured at construction
   * would be the empty stand-in for the process's whole life.
   *
   * `sourceRoot` comes off the loaded definition, where `GateDefinitionLoader` stamped the root it
   * read the file from (P4.18). Passed through untouched: this processor must not infer which root
   * serves an id, because a second derivation of a question the loader already answered is how two
   * answers to it start disagreeing.
   *
   * Ids are lowercased on the way in. A quarantine record's id is path-derived from a directory
   * name, while `gateId` is whatever the file declared — `validateGateSchema` compares those two
   * case-insensitively, so a `gate.yaml` declaring `id: Shared-Gate` under `shared-gate/` loads
   * fine and would otherwise never match its own refusal record. `handleInspect` already lowercases
   * for the same lookup.
   */
  private quarantineFindings(): QuarantineFinding[] {
    const records = this.ctx.gateManager.getQuarantine().list();
    if (records.length === 0) return [];
    return summarizeQuarantine(
      records,
      this.ctx.gateManager.list(false).map((gate) => ({
        id: gate.gateId.toLowerCase(),
        sourceRoot: gate.getDefinition().sourceRoot,
      }))
    );
  }

  async handleList(args: GateManagerInput): Promise<ToolResponse> {
    const { enabled_only = true } = args;

    const gates = this.ctx.gateManager.list(enabled_only);
    const stats = this.ctx.gateManager.getStats();

    if (gates.length === 0) {
      // The quarantine section belongs on THIS branch above all others: a root whose gates all
      // failed to load produces exactly this response, and "no gates found" for a directory full
      // of gate.yaml files is the least actionable thing the tool can say.
      return this.success(
        `📋 No gates found${enabled_only ? ' (enabled only)' : ''}\n\n` +
          `Use resource_manager(resource_type:"gate", action:"create", ...) to add a new gate.` +
          formatQuarantineSection(this.quarantineFindings(), 'gate')
      );
    }

    const gateList = gates
      .map((gate) => {
        const typeIcon = gate.type === 'validation' ? '✓' : '📖';
        return `  ${typeIcon} ${gate.gateId}: ${gate.name}`;
      })
      .join('\n');

    return this.success(
      `📋 Gates (${gates.length} total)\n\n` +
        `${gateList}\n\n` +
        `📊 Registry Stats:\n` +
        `  - Total gates: ${stats.totalGates}\n` +
        `  - Enabled: ${stats.enabledGates}\n` +
        `  - Disabled: ${stats.totalGates - stats.enabledGates}` +
        formatQuarantineSection(this.quarantineFindings(), 'gate')
    );
  }

  async handleInspect(args: GateManagerInput): Promise<ToolResponse> {
    const { id } = args;

    if (!id) {
      return this.error('Gate ID is required for inspect action');
    }

    const gate = this.ctx.gateManager.get(id);
    if (!gate) {
      // `Gate '<id>' not found` is true of the registry and false of the disk. A gate file the
      // loader refused is exactly the one an operator needs to reach, and this was the surface
      // that denied it existed — the same shape P4.9 removed for prompts.
      const quarantined = this.ctx.gateManager.getQuarantine().byId(id.toLowerCase());
      if (quarantined.length > 0) {
        return this.error(formatQuarantinedInspect(quarantined, 'gate'));
      }
      return this.error(`Gate '${id}' not found`);
    }

    const typeIcon = gate.type === 'validation' ? '✓' : '📖';
    const guidance = gate.getGuidance();
    const guidancePreview = guidance.length > 500 ? guidance.substring(0, 500) + '...' : guidance;

    // Inspect shows the EFFECTIVE severity — the value the engine acts on. Defaults are applied
    // at load, so every definition carries one and there is no omitted case to render around.
    // `enforcementMode` has no schema default, so it is still absent unless the author set it.
    const definition = gate.getDefinition();
    const severityLine = `\n  - Severity: ${definition.severity}`;
    const enforcementModeLine =
      definition.enforcementMode !== undefined
        ? `\n  - Enforcement Mode: ${definition.enforcementMode}`
        : '';
    // P4.10 — `gate_type` became settable through the tool once the parameter holding its name
    // was renamed to `type`. Read back from the raw definition for the same reason as the two
    // above: `GenericGateGuide.gateType` resolves an absent key to 'custom', so the guide's own
    // property cannot distinguish an authored 'custom' from no declaration at all.
    const gateTypeLine =
      definition.gate_type !== undefined ? `\n  - Classification: ${definition.gate_type}` : '';
    // P4.100 — same class again, and the one with the largest consequence to read back: this key
    // decides whether a FAIL withholds the step output. Rendered from the raw definition, and
    // only when declared, so an authored `false` is distinguishable from silence.
    const blockResponseLine =
      definition.blockResponseOnFail !== undefined
        ? `\n  - Blocks Response On Fail: ${String(definition.blockResponseOnFail)}`
        : '';

    // Announce the fallback. The served definition is correct and the operator asked about it —
    // but if a file for the same id failed to load, their edit to that file is inert, and nothing
    // else in this response would tell them. Empty for every healthy gate.
    const shadowedNote = formatShadowedNote(
      this.ctx.gateManager.getQuarantine().byId(gate.gateId.toLowerCase()),
      // The root serving what the operator is reading — the loader's own stamp, so the claim
      // "repairing that file will change what this id serves" can be checked before acting on it.
      gate.getDefinition().sourceRoot
    );

    return this.success(
      `🚦 Gate: ${gate.name}\n\n` +
        `📋 Details:\n` +
        `  - ID: ${gate.gateId}\n` +
        `  - Type: ${typeIcon} ${gate.type}\n` +
        `  - Description: ${gate.description}` +
        `${severityLine}${enforcementModeLine}${gateTypeLine}${blockResponseLine}\n\n` +
        `📝 Guidance:\n${guidancePreview}` +
        shadowedNote
    );
  }

  private success(text: string): ToolResponse {
    return { content: [{ type: 'text', text }], isError: false };
  }

  private error(text: string): ToolResponse {
    return { content: [{ type: 'text', text: `❌ ${text}` }], isError: true };
  }
}

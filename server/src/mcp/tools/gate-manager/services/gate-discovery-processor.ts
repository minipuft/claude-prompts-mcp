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
   * `sourceRoot` is deliberately absent from the served summaries — the gate loader does not stamp
   * one on a definition, so a finding says "another root" rather than naming a root it would have
   * to guess. The shadow is still announced; only its origin is unnamed.
   */
  private quarantineFindings(): QuarantineFinding[] {
    const records = this.ctx.gateManager.getQuarantine().list();
    if (records.length === 0) return [];
    return summarizeQuarantine(
      records,
      this.ctx.gateManager.list(false).map((gate) => ({ id: gate.gateId }))
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

    // P4.11 — `severity`/`enforcementMode` are read from the on-disk definition
    // (`GateGuide.getDefinition()`), not from `gate.severity`/`gate.enforcementMode`: the guide
    // resolves both to a loader default (medium / severity-mapped) when the gate.yaml omits them,
    // so the guide's own properties can never distinguish "author set it" from "loader defaulted
    // it". The raw definition still has `undefined` for an omitted key, which is what the
    // conditional-projection idiom (gate-loader.ts toLightweightGate) also keys off.
    const definition = gate.getDefinition();
    const severityLine =
      definition.severity !== undefined ? `\n  - Severity: ${definition.severity}` : '';
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

    // Announce the fallback. The served definition is correct and the operator asked about it —
    // but if a file for the same id failed to load, their edit to that file is inert, and nothing
    // else in this response would tell them. Empty for every healthy gate.
    const shadowedNote = formatShadowedNote(
      this.ctx.gateManager.getQuarantine().byId(gate.gateId.toLowerCase()),
      undefined
    );

    return this.success(
      `🚦 Gate: ${gate.name}\n\n` +
        `📋 Details:\n` +
        `  - ID: ${gate.gateId}\n` +
        `  - Type: ${typeIcon} ${gate.type}\n` +
        `  - Description: ${gate.description}` +
        `${severityLine}${enforcementModeLine}${gateTypeLine}\n\n` +
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

// @lifecycle canonical - Derives authored tool, semantic evaluation and reminder requirements.
/**
 * Gate tier describes requirements, not attempted execution, verified results or model quality.
 * Tool criteria take precedence in mixed gates; the component readers retain both facts.
 * Semantic-only criteria require evaluation; legacy guidance and missing criteria are reminders.
 * The shipped registry/index cross-check covers current resource fixtures. Semantic index and
 * skills-export projections remain separate consumers of this rule.
 *
 * `formatCheckLine` is shared by runtime guidance and skills export: it names the command
 * the engine runs rather than asserting an outcome a static export cannot know.
 */

export type GateTier = 'check' | 'evaluation' | 'reminder';

const TOOL_PASS_CRITERIA_TYPES: ReadonlySet<string> = new Set(['shell_verify', 'script_tool']);

/** Narrow authored facts, accepted from loader DTOs, frozen requirements and raw YAML. */
export interface GateTierSource {
  readonly pass_criteria?: readonly { readonly type?: string }[];
}

/** Declared tool requirement only; this says nothing about whether a command ran or passed. */
export function hasToolCheck(definition: GateTierSource): boolean {
  return (definition.pass_criteria ?? []).some(
    (criterion) => criterion.type !== undefined && TOOL_PASS_CRITERIA_TYPES.has(criterion.type)
  );
}

/** Declared semantic requirement only; report acceptance remains owned by the canonical kernel. */
export function hasSemanticEvaluation(definition: GateTierSource): boolean {
  return (definition.pass_criteria ?? []).some(
    (criterion) => criterion.type === 'semantic_evaluation'
  );
}

/** Tool precedence selects the display tier without discarding a mixed gate's semantic facts. */
export function deriveGateTier(definition: GateTierSource): GateTier {
  if (hasToolCheck(definition)) return 'check';
  return hasSemanticEvaluation(definition) ? 'evaluation' : 'reminder';
}

/**
 * One `pass_criteria` entry, as read by `formatCheckLine` — the fields it actually inspects,
 * not the full gate schema. `shell_command` accepts a bare string alongside the argv array the
 * current schema requires: a gate.yaml written before the 2026-08-29 argv migration is refused
 * at load, but the export path reads `gate.yaml` files directly off disk (not through the
 * loader), so a legacy string is still a shape it must render rather than silently drop.
 */
export interface GateTierCriterion {
  type?: string;
  shell_command?: ReadonlyArray<string> | string;
  script_tool_id?: string;
}

/**
 * One check's guidance line, naming the command or tool that produces its verdict — never its
 * guidance prose. Shared by the runtime guidance renderer (`GatePassCriteria[]`, argv-only) and
 * the skills export (`unknown[]` off a raw parsed `gate.yaml`, legacy string still possible) —
 * see the module doc for why one function replaced two drifted phrasings.
 */
export function formatCheckLine(
  name: string,
  passCriteria: ReadonlyArray<GateTierCriterion | Record<string, unknown> | null | undefined>
): string {
  const criteria = passCriteria.map((entry) => (entry ?? {}) as GateTierCriterion);
  const criterion = criteria.find(
    (entry) => entry.type === 'shell_verify' || entry.type === 'script_tool'
  );

  if (criterion?.type === 'shell_verify') {
    const { shell_command: shellCommand } = criterion;
    if (Array.isArray(shellCommand) && shellCommand.length > 0) {
      return `- **${name}** — check: runs \`${shellCommand.join(' ')}\``;
    }
    if (typeof shellCommand === 'string' && shellCommand.length > 0) {
      return `- **${name}** — check: runs \`${shellCommand}\``;
    }
  }
  if (criterion?.type === 'script_tool' && criterion.script_tool_id) {
    return `- **${name}** — check: runs tool \`${criterion.script_tool_id}\``;
  }

  // A check whose criterion names neither a command nor a tool id cannot run; still list it,
  // so an operator sees the gate rather than silently losing it.
  return `- **${name}** — check`;
}

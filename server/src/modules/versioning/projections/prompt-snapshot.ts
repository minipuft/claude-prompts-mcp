// @lifecycle canonical - The one prompt snapshot projection, read by the MCP tool layer and by cpm.
/**
 * Where this sits, and why its exported name is not `projectPromptSnapshot`.
 *
 * Sibling of `gate-snapshot.ts`, `framework-snapshot.ts` and `category-snapshot.ts`: one
 * projection per resource type, in the module both `mcp/tools/**` and `cli-shared/` may import
 * (R69). It arrived here later than the other three, from
 * `mcp/tools/resource-manager/prompt/utils/validation.ts`, as a plain move — the name
 * `canonicalPromptSnapshot` is cited by prose in a dozen places and by the receipt service's own
 * failure message, so renaming it to match the family would have churned those for symmetry alone.
 * The asymmetry is the name only; the contract is the same one the siblings state.
 *
 * WHAT MADE THE MOVE NECESSARY. `cpm` wrote prompt version rows from the raw `prompt.yaml` map
 * while the server wrote them from this projection, and the bridge decision is `hashCanonical`
 * equality — so the two shapes could never compare equal and every server edit of a `cpm`-written
 * prompt recorded a bridge row describing a change nobody made. Building a second, YAML-shaped
 * prompt projection in `cli-shared/` would have made that permanent, which is why the CLI reaches
 * the loader and the converter instead (`cli-shared/prompt-projection.ts`) and calls THIS.
 */

/**
 * The preserved fields the canonical snapshot projects, and the ones it cannot.
 *
 * A field belongs here only when the projection SOURCE holds its authored value. `ConvertedPrompt`
 * copies `subagentModel` and `agentType` verbatim from the prompt's own YAML (converter.ts:165-169,
 * both behind a `!= null` guard) and carries `injection` only when the file declared one
 * (converter.ts:176-177) — so for these three, present-on-the-source means authored.
 *
 * `registerWithMcp` and `mcpPromptMode` are deliberately absent. `PromptConverter` RESOLVES both
 * through prompt → category → global → hard-coded default (converter.ts:28-64) and assigns them
 * unconditionally, so they are ALWAYS present on a live prompt. Projecting them "if present" would
 * therefore materialise an inherited default into `promptData` on EVERY update, and `promptData`
 * outranks the writer's on-disk preservation — freezing the prompt against any later change to the
 * default it was inheriting, on every edit, without anyone asking. That is DEV-T1-3's hazard made
 * unconditional. They reach the YAML only when a caller sets them explicitly.
 */
/*
 * `budget` and `artifacts` joined at P4.83, and they pass the same test the four above do: the
 * converter copies each verbatim from the prompt's own YAML behind a `!== undefined` guard
 * (converter.ts:177-178, :192-193), so present-on-the-source means authored, and absent stays
 * absent. Until then the snapshot omitted them, which made a rollback unable to restore either —
 * the writer's on-disk preservation carried the CURRENT value forward instead, so rolling a chain
 * back to a version with a different `budget` silently kept today's.
 *
 * `edges` and the authored `tools` id list are the half of P4.83 this list CANNOT close, and the
 * reason is a property of the source rather than a judgement: `ConvertedPrompt` carries neither
 * (the loader linearises edges into `chainSteps` order and drops them; `tools` survives only as
 * loaded `scriptTools` definitions, not as the authored ids). Their only readable source is the
 * on-disk YAML, which four of this function's seven call sites cannot reach — see the note on
 * `canonicalPromptSnapshot` below. Recorded as open, with the condition that closes it, rather
 * than half-projected: a field present on the record side and absent on the compare side bridges
 * every edit into a durable table, silently.
 */
export const SNAPSHOT_PRESERVED_FIELDS = [
  'composer',
  'injection',
  'subagentModel',
  'agentType',
  'budget',
  'artifacts',
] as const;

/**
 * Project a live prompt onto the canonical snapshot shape `updatePrompt` records.
 *
 * `recordEditResult` decides whether to write a bridge row by structurally comparing the latest
 * recorded snapshot against the live pre-edit state. A live `ConvertedPrompt` carries
 * loader-resolved runtime keys the recorded shape never has (`registerWithMcp`, `mcpPromptMode`,
 * `promptDir`, `scriptTools`, …), and the comparison is JSON-based, so passing the raw converted
 * prompt makes every post-reload edit look out-of-band and bridge — doubling rows in steady
 * state. Both sides of every before/after comparison (bridge check, diffs, preview) must
 * therefore come from THIS one projection; `updatePrompt`'s produced `promptData` is this object
 * plus `tools` (which only ever arrives via `args.tools` — the live prompt carries loaded
 * `scriptTools`, not the raw id list, so the prior value is not reconstructable here and the key
 * is deliberately absent).
 *
 * **This function takes ONE source, and that bounds what P4.83 could close.** `edges` and the
 * authored `tools` id list live only in the on-disk YAML, and of the seven call sites here, four
 * cannot reach it: `prompt-discovery-processor` and `prompt-mutation-receipt-service` hold no
 * `FileOperations` at all, and `ConvertedPrompt` records no path to its own entry file (only
 * `sourceRoot`, the root), so even the two sites that do hold one would have to re-derive the
 * loader's single-file-vs-directory layout rule. Adding the YAML as a second source WITHOUT
 * reaching every site forks the projection, and a forked projection is not a cosmetic gap: the
 * receipt compares `canonicalPromptSnapshot(writeModel)` against
 * `canonicalPromptSnapshot(reloadedPrompt)`, so a YAML-fed write model versus a loader-fed reload
 * would report `❌ Post-write verification failed (mismatched: edges, tools)` on every prompt
 * write, and `recordEditResult` would bridge every edit into a durable table. ☐ open as of
 * 2026-09-20 · closes when `ConvertedPrompt` carries its own entry path (one field, stamped by
 * the converter where `promptDir` already is) so every call site can read the YAML from the
 * source it already holds — at which point `edges` and `tools` join the list above.
 *
 * The `SNAPSHOT_PRESERVED_FIELDS` tail (OQ-P7-8) is preserve-if-present, never defaulted: absent
 * on the source stays absent from the projection. Without it a recorded snapshot omits a field the
 * file still carries, and a rollback to that version restores a prompt the version never described
 * — it would land on whatever the on-disk preservation happened to be holding. With it, every
 * snapshot recorded from this point describes the whole authored state of those fields.
 */
export function canonicalPromptSnapshot(
  id: string,
  source: object | undefined
): Record<string, unknown> {
  const from = source as Record<string, unknown> | undefined;
  const snapshot: Record<string, unknown> = {
    id,
    name: from?.['name'] ?? id,
    category: from?.['category'] ?? 'general',
    description: from?.['description'] ?? '',
    systemMessage: from?.['systemMessage'],
    userMessageTemplate: from?.['userMessageTemplate'] ?? '',
    arguments: from?.['arguments'] ?? [],
    chainSteps: from?.['chainSteps'] ?? [],
    gateConfiguration: from?.['gateConfiguration'],
  };

  for (const field of SNAPSHOT_PRESERVED_FIELDS) {
    const value = from?.[field];
    if (value !== undefined) {
      snapshot[field] = value;
    }
  }

  return snapshot;
}

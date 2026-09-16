// @lifecycle canonical - Renders quarantined resource files for the resource_manager read surface.
/**
 * How a refused resource file is described to an operator.
 *
 * TWO THINGS ARE BEING ANNOUNCED, and they are different findings.
 *
 *   1. A file that failed to load and whose id nothing else answers. The prompt is simply gone;
 *      the operator needs the path and the reason.
 *   2. A file that failed to load whose id IS served, by a definition from another root. This is
 *      the silent half of the original defect: an operator edits a workspace prompt, breaks it,
 *      and the bundled one answers with no indication their edit is inert. Repairing that file
 *      will CHANGE what serves, so it has to be said before they are surprised by their own fix.
 *
 * WHAT IS NEVER RENDERED. No systemMessage, no user template, no description, no argument
 * descriptions — the type these functions take carries none of them, so this is structural rather
 * than a rule anyone has to follow. A file that failed validation is the one whose content has not
 * been checked, and `prompts/list` plus `list detail:"full"` ship those four fields to a client
 * before anything is invoked (CLAUDE.md §Instruction surface).
 *
 * Pure: strings in, strings out, no I/O. The processors are orchestration and own no formatting
 * decision this file could not be unit-tested for on its own.
 *
 * ONE COPY, THREE RESOURCE KINDS. Written for prompts at P4.9 and generalized at P4.15 rather than
 * copied twice: the only prompt-specific text was the noun in two repair hints, which is now the
 * `noun` parameter. A per-kind copy would have three places to keep the content rule true, and the
 * rule is the whole point. `category` stays optional on the record for the same reason — gates and
 * frameworks are FLAT (`{root}/{id}/gate.yaml`), so rendering a category line for them would assert
 * a level of the tree that does not exist.
 */

import * as path from 'node:path';

import type { QuarantinedResource } from '#shared/utils/resource-quarantine.js';

/** The served-catalog facts a report needs, without importing the catalog's type. */
export interface ServedResourceSummary {
  readonly id: string;
  /**
   * Root the live definition was loaded from, when the loader stamped one.
   *
   * All three loaders stamp it as of P4.18, so the `'another root'` fallback in the two renderers
   * below is now the in-process case (a guide registered from a definition that never came off
   * disk) rather than the ordinary one. It stays optional because a caller supplying nothing is
   * still honest — the alternative is a renderer that guesses, which is the thing this type
   * exists to prevent.
   */
  readonly sourceRoot?: string | undefined;
}

/** A quarantine record paired with what, if anything, is serving its id instead. */
export interface QuarantineFinding {
  readonly record: QuarantinedResource;
  /** The root currently answering this id, when one is. Absent means the id is unserved. */
  readonly servedFrom?: string | undefined;
  /** True when a valid definition answers this id from somewhere else. */
  readonly shadowed: boolean;
}

/**
 * Pair every quarantine record with the served definition that shadows it, if any.
 *
 * Matching on id alone, not on path: the point is precisely that a DIFFERENT file is answering.
 */
export function summarizeQuarantine(
  records: readonly QuarantinedResource[],
  served: readonly ServedResourceSummary[]
): QuarantineFinding[] {
  const servedById = new Map(served.map((resource) => [resource.id, resource]));
  return records.map((record) => {
    const live = servedById.get(record.id);
    return {
      record,
      servedFrom: live?.sourceRoot,
      shadowed: live !== undefined,
    };
  });
}

/**
 * One line per finding, for the `list` surface. Empty string when nothing is quarantined.
 *
 * @param noun - What one of these resources is called, for the repair hint: `prompt`, `gate`,
 *   `framework`. Not derived from `finding.record.type` so the caller — which already knows which
 *   surface it is rendering — stays the single place that decides, and an empty `findings` list
 *   still renders the same way.
 */
export function formatQuarantineSection(
  findings: readonly QuarantineFinding[],
  noun: string
): string {
  if (findings.length === 0) return '';

  const lines = [`\n\n🚧 **Quarantined** (${findings.length}) — on disk, not in the catalog`];
  for (const finding of findings) {
    lines.push(`\n- \`${finding.record.id}\` — ${finding.record.path}`);
    lines.push(`\n  ↳ ${finding.record.error}`);
    if (finding.shadowed) {
      // "may change", not "will": since P4.35 a record here can come from a root BELOW the one
      // serving, in which case repairing it changes nothing about what answers. Ranking the two
      // is not something this renderer has been given the order to do — see `formatShadowedNote`.
      lines.push(
        `\n  ↳ **shadowed**: \`${finding.record.id}\` is currently served from ` +
          `${finding.servedFrom ?? 'another root'}; repairing this file changes what serves only ` +
          `if its root outranks that one.`
      );
    }
  }
  lines.push(
    `\n\n_Repair with \`action:"update"\` and the full ${noun} body — a quarantined file's own ` +
      `content is not returned here, because it is the content that failed validation._`
  );
  return lines.join('');
}

/**
 * The whole `inspect` response for an id nothing serves but something quarantined.
 *
 * Replaces the bare `Prompt not found`, which was true of the catalog and false of the disk — and
 * a reason nobody can act on is the part that costs.
 */
export function formatQuarantinedInspect(
  records: readonly QuarantinedResource[],
  noun: string
): string {
  const lines = [`🚧 **Quarantined**: \`${records[0]?.id ?? ''}\` is on disk but failed to load\n`];
  for (const record of records) {
    lines.push(`\n**File**: ${record.path}`);
    lines.push(`\n**Root**: ${record.root}`);
    // Conditional because gates and frameworks are FLAT layouts with no category, and a
    // `**Category**: undefined` line asserts a level of the tree that does not exist. Prompts
    // always carry one.
    if (record.category !== undefined) lines.push(`\n**Category**: ${record.category}`);
    lines.push(`\n**Load error**: ${record.error}\n`);
  }
  lines.push(
    `\n💡 Repair it with \`action:"update"\`, supplying the full ${noun} — there is no loaded ` +
      `state to merge onto, and the content that failed validation is deliberately not returned ` +
      `here. A successful reload clears the quarantine record.`
  );
  return lines.join('');
}

/**
 * The note appended to a healthy `inspect` whose id ALSO has a quarantined file behind it.
 *
 * Empty when nothing shadows it, so an ordinary inspect stays unchanged.
 *
 * "Another file", not "a nearer file", and "may change what serves", not "will". Both of those
 * were true while the only root that could go quiet was one ABOVE the winner. P4.35 made the
 * loaders read past the root that served, so a record here can now come from a LOWER root — the
 * writable one included — and calling that file nearer, or promising that repairing it changes
 * what serves, states a rank this renderer has not been given. The order itself is stated instead,
 * once, from `shared/utils/resource-root-lookup.ts` §resourceRootPrecedence.
 */
export function formatShadowedNote(
  records: readonly QuarantinedResource[],
  servedFrom: string | undefined
): string {
  if (records.length === 0) return '';
  const lines = [
    `\n🚧 **Another file for this id failed to load.** What you are reading is served from ` +
      `${servedFrom ?? 'another root'}.\n`,
  ];
  for (const record of records) {
    lines.push(`\n- ${record.path} — ${record.error}`);
  }
  lines.push(
    `\n\n_Repairing that file changes what \`${records[0]?.id ?? ''}\` serves only if its root ` +
      `outranks ${servedFrom ?? 'the serving root'}: overlays outrank the writable root, which ` +
      `outranks the bundled tree._\n`
  );
  return lines.join('');
}

/**
 * The sentence a repair response adds about which root answers the id AFTER the write.
 *
 * MEASURED, NOT DERIVED. `servedFrom` is the loader's own `sourceRoot` stamp read back after the
 * reload, so this says what the catalog does rather than re-deriving precedence at a second site —
 * the rule P4.18 (ruling R7) set for exactly this question.
 *
 * WHAT IT REPLACES. Both repair responses told the operator, verbatim, that the repair "wrote
 * `<path>`, which takes precedence, so `<id>` now serves your copy". A write lands in the WRITABLE
 * root, and since P4.27 every overlay outranks that root — so for a refused file living in an
 * overlay the claim was false in both halves: the overlay still answered, and the operator was
 * told their copy was serving while it was inert.
 *
 * One helper for both kinds rather than a copy in each processor: the claim is the thing that was
 * wrong, and a second copy is a second place for it to go wrong again.
 */
export function formatRepairServingLine(
  id: string,
  writtenRoot: string,
  servedFrom: string | undefined
): string {
  if (servedFrom === undefined) {
    return (
      `\n⚠️ Nothing currently serves \`${id}\` — no root in the lookup order yielded a valid ` +
      `definition. See the server log for the loader's reason.\n`
    );
  }
  if (path.resolve(servedFrom) === path.resolve(writtenRoot)) {
    return `\n✅ \`${id}\` is served from your copy in ${writtenRoot}.\n`;
  }
  return (
    `\n⚠️ \`${id}\` is still served from ${servedFrom}, which outranks ${writtenRoot} — the copy ` +
    `this repair wrote is NOT what answers, and will not be until that root stops defining the id.\n`
  );
}

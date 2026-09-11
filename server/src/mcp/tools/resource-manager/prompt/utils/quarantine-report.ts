// @lifecycle canonical - Renders quarantined prompt files for the resource_manager read surface.
/**
 * How a refused prompt file is described to an operator.
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
 */

import type { QuarantinedPrompt } from '#modules/prompts/quarantine.js';

/** The served-catalog facts a report needs, without importing the catalog's type. */
export interface ServedPromptSummary {
  readonly id: string;
  /** Root the live definition was loaded from, when the loader stamped one. */
  readonly sourceRoot?: string | undefined;
}

/** A quarantine record paired with what, if anything, is serving its id instead. */
export interface QuarantineFinding {
  readonly record: QuarantinedPrompt;
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
  records: readonly QuarantinedPrompt[],
  served: readonly ServedPromptSummary[]
): QuarantineFinding[] {
  const servedById = new Map(served.map((prompt) => [prompt.id, prompt]));
  return records.map((record) => {
    const live = servedById.get(record.id);
    return {
      record,
      servedFrom: live?.sourceRoot,
      shadowed: live !== undefined,
    };
  });
}

/** One line per finding, for the `list` surface. Empty array when nothing is quarantined. */
export function formatQuarantineSection(findings: readonly QuarantineFinding[]): string {
  if (findings.length === 0) return '';

  const lines = [`\n\n🚧 **Quarantined** (${findings.length}) — on disk, not in the catalog`];
  for (const finding of findings) {
    lines.push(`\n- \`${finding.record.id}\` — ${finding.record.path}`);
    lines.push(`\n  ↳ ${finding.record.error}`);
    if (finding.shadowed) {
      lines.push(
        `\n  ↳ **shadowed**: \`${finding.record.id}\` is currently served from ` +
          `${finding.servedFrom ?? 'another root'}; repairing this file will change what serves.`
      );
    }
  }
  lines.push(
    `\n\n_Repair with \`action:"update"\` and the full prompt body — a quarantined file's own ` +
      `content is not read back, because it is the content that failed validation._`
  );
  return lines.join('');
}

/**
 * The whole `inspect` response for an id nothing serves but something quarantined.
 *
 * Replaces the bare `Prompt not found`, which was true of the catalog and false of the disk — and
 * a reason nobody can act on is the part that costs.
 */
export function formatQuarantinedInspect(records: readonly QuarantinedPrompt[]): string {
  const lines = [`🚧 **Quarantined**: \`${records[0]?.id ?? ''}\` is on disk but failed to load\n`];
  for (const record of records) {
    lines.push(`\n**File**: ${record.path}`);
    lines.push(`\n**Root**: ${record.root}`);
    lines.push(`\n**Category**: ${record.category}`);
    lines.push(`\n**Load error**: ${record.error}\n`);
  }
  lines.push(
    `\n💡 Repair it with \`action:"update"\`, supplying the full prompt — there is no loaded ` +
      `state to merge onto, and the content that failed validation is deliberately not returned ` +
      `here. A successful reload clears the quarantine record.`
  );
  return lines.join('');
}

/**
 * The note appended to a healthy `inspect` whose id ALSO has a quarantined file behind it.
 *
 * Empty when nothing shadows it, so an ordinary inspect stays unchanged.
 */
export function formatShadowedNote(
  records: readonly QuarantinedPrompt[],
  servedFrom: string | undefined
): string {
  if (records.length === 0) return '';
  const lines = [
    `\n🚧 **A nearer file for this id failed to load.** What you are reading is served from ` +
      `${servedFrom ?? 'another root'}.\n`,
  ];
  for (const record of records) {
    lines.push(`\n- ${record.path} — ${record.error}`);
  }
  lines.push(`\n\n_Repairing that file will change what \`${records[0]?.id ?? ''}\` serves._\n`);
  return lines.join('');
}

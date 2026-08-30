// @lifecycle canonical - Parses a leading `-->` command into the append spelling of a remainder (row A.3).
/**
 * ONE MECHANISM, TWO SPELLINGS (OQ-A1).
 *
 * `prompt_engine({chain_id, command: "--> >>write_summary"})` and
 * `prompt_engine({chain_id, remainder: {mode:'append', nodes:[{id:'write-summary',
 * promptId:'write_summary'}]}})` are the SAME append. This module is the half that turns the
 * string into the structure; everything after it — admissibility, IR validation, caps, the store
 * write, the recorded provenance — is `RemainderProcessor` and `ChainSessionStore.replaceRemainder`
 * unchanged. The two spellings may therefore never diverge in any of those, because after this
 * function there is only one of them left.
 *
 * WHY THE STRING FORM IS NARROWER THAN THE STRUCTURED ONE. A `-->` command can carry two operators
 * this parser refuses rather than maps: `::` step criteria and `==>` delegation.
 *
 * The blocker MOVED at row A.2 and the refusal is kept for a different reason than it was written
 * for. A.2 shipped `inlineGateCriteria` and `delegated` on the IR node schema, so the node
 * vocabulary can now say both — that half is done. What still cannot carry them is the REMAINDER,
 * one layer down: `projectNodes` (`capture/remainder-processor.ts`) narrows every submitted node
 * to `{id, promptId, stepName}` before the store write, so a mapped `::` or `==>` would be dropped
 * silently on its way to `chain_run_nodes`. It would be dropped for the STRUCTURED spelling too —
 * which is exactly why accepting it here would break OQ-A1's "may never diverge": the string form
 * would appear to accept an operator that changes nothing about the run.
 *
 * Lifting it therefore means widening `RemainderNodeSpec`, the store's node write and the row
 * projection for both spellings at once — storage surface owned by rows 1.2 / 2.3, not by A.2.
 * Until then the refusal names the operator and points at the layer, so it is retirable rather
 * than folklore.
 *
 * Pure: no I/O, no logger, no registry. Prompt existence and required arguments are NOT checked
 * here — `validateWorkflowIR`, reached through `RemainderProcessor`, owns both, and checking them
 * twice is how two answers to one question start.
 */

/**
 * The token a command must begin with to be read as an append rather than a new run.
 *
 * NOT exported: `isAppendCommand` is the only correct way to ask the question (it trims first),
 * and an exported constant invites a second, subtly different prefix test at the call site — which
 * is exactly how the schema and the translator would come to disagree about which strings are
 * appends.
 */
const APPEND_COMMAND_PREFIX = '-->';

/** Discriminated parse outcome. A refusal carries the sentence the caller reads, never a code. */
export type AppendCommandParse =
  | { readonly ok: true; readonly nodes: readonly AppendNode[] }
  | { readonly ok: false; readonly message: string };

/**
 * One parsed step.
 *
 * Structurally a `WorkflowNode`, declared locally rather than imported: `engine/` may type-import
 * `modules/workflow-ir/`, but this module has no other reason to know that layer exists, and the
 * three fields it produces are the three `RemainderNodeSpec` survives with.
 */
interface AppendNode {
  readonly id: string;
  readonly promptId: string;
  readonly args?: Record<string, unknown>;
}

/**
 * True when `command` is the append spelling.
 *
 * The FIRST non-whitespace token decides, and nothing else does: `>>a --> >>b` contains the same
 * three characters in the middle and is a new chain, not an append. The `command`×`chain_id`
 * exclusivity lifts for exactly the commands this returns true for (row A.3).
 */
export function isAppendCommand(command: string | undefined): boolean {
  return typeof command === 'string' && command.trimStart().startsWith(APPEND_COMMAND_PREFIX);
}

/**
 * Parse `--> >>a --> >>b` into append nodes.
 *
 * @param command - the raw command string. Must satisfy {@link isAppendCommand}; a command that
 *   does not is a caller error and is refused rather than silently treated as a new run.
 */
export function parseAppendCommand(command: string): AppendCommandParse {
  if (!isAppendCommand(command)) {
    return {
      ok: false,
      message:
        'append refused: a command sent together with chain_id must begin with "-->". ' +
        'Send a new run without chain_id, or spell the append as "--> >>prompt_id".',
    };
  }

  const fragment = command.trimStart().slice(APPEND_COMMAND_PREFIX.length).trim();
  if (fragment.length === 0) {
    return {
      ok: false,
      message: 'append refused: "-->" names no steps. Spell it "--> >>prompt_id".',
    };
  }

  if (fragment.includes('==>')) {
    return {
      ok: false,
      message:
        'append refused: the "==>" delegation operator is declarable on an IR node but a remainder ' +
        'node still carries only {id, promptId, stepName}, so it would be dropped before the run ' +
        'sees it. Append the step with "-->" and set delegation on the prompt.',
    };
  }
  if (/(^|\s)::/.test(fragment)) {
    return {
      ok: false,
      message:
        'append refused: the "::" gate operator is declarable on an IR node but a remainder node ' +
        'still carries only {id, promptId, stepName}, so it would be dropped before the run sees ' +
        'it. Bind the gate with the `gates` parameter and its target_step_id instead.',
    };
  }

  const segments = fragment.split('-->').map((segment) => segment.trim());
  const nodes: AppendNode[] = [];
  const taken = new Set<string>();

  for (const segment of segments) {
    if (segment.length === 0) {
      return {
        ok: false,
        message: `append refused: "${command.trim()}" has an empty step between two "-->" arrows.`,
      };
    }
    const match = /^>>\s*([A-Za-z0-9_][A-Za-z0-9_-]*)\s*([\s\S]*)$/.exec(segment);
    if (match === null) {
      return {
        ok: false,
        message:
          `append refused: step "${segment}" is not a prompt reference. ` +
          'Every step of an append is spelled ">>prompt_id".',
      };
    }
    const promptId = match[1] ?? '';
    const node: AppendNode = {
      id: mintAppendId(promptId, taken),
      promptId,
      ...(parseInlineArgs(match[2] ?? '') ?? {}),
    };
    nodes.push(node);
  }

  return { ok: true, nodes };
}

/**
 * Kebab-case node id derived from the prompt id, de-duplicated within the fragment.
 *
 * DERIVED, not minted from a counter: `n1` would collide with the symbolic parser's own frozen
 * `n1..nK` on the run being appended to, and a caller writing the structured spelling of the same
 * append has no way to guess a counter's starting point. A slug is reproducible from the command
 * text alone, which is what lets OQ-A1's both-spellings test author one id and get one row.
 *
 * `ChainSessionStore.replaceRemainder` re-mints against the run's live ids anyway
 * (`mintInsertionId`), so a collision with an existing node is resolved there, not here.
 */
function mintAppendId(promptId: string, taken: Set<string>): string {
  const base =
    promptId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'step';
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * `key="value"` pairs off a step segment, or `undefined` when the segment declares none.
 *
 * DELIBERATELY NARROWER than `ArgumentParser`, and the narrowness is bounded by what it feeds:
 * `RemainderNodeSpec` carries id / promptId / stepName only, so these values never reach the run.
 * Their ONE effect is `validateWorkflowIR`'s `required-argument-missing` check — without them a
 * caller appending a prompt with a required argument would be refused for an argument they did
 * supply. Positional arguments are not accepted, because a remainder node has no positional form
 * to carry them into.
 */
function parseInlineArgs(raw: string): { args: Record<string, unknown> } | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const args: Record<string, unknown> = {};
  const pattern = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  let match: RegExpExecArray | null = pattern.exec(trimmed);
  while (match !== null) {
    const key = match[1];
    if (key !== undefined) {
      args[key] = match[2] ?? match[3] ?? match[4] ?? '';
    }
    match = pattern.exec(trimmed);
  }
  return Object.keys(args).length > 0 ? { args } : undefined;
}

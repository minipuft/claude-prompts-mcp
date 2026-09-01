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
 * `==>` DELEGATION IS MAPPED (row A.5). The operator marks the step that FOLLOWS it, exactly as
 * `SymbolicOperatorParser.splitChainSteps` reads it in a full chain, and it lands on the node's
 * `delegated` declaration — which `RemainderNodeSpec`, `ChainNode`, the `chain_run_nodes` row and
 * `synthesizeStep` now each carry, so the appended step renders delegated. Both spellings map it
 * through the same `RemainderProcessor`, which is what keeps OQ-A1 structural.
 *
 * `::` CRITERIA ARE STILL REFUSED, and the reason is timing rather than vocabulary. A raw `::`
 * token means nothing until `InlineGateProcessor.partitionGateCriteria` splits it against the gate
 * registry (stage 11 in a fresh parse) — and an appended node joins a run that is RESUMING, where
 * `05-inline-gate-stage` skips on `isBlueprintRestored` and no per-node criteria resolution runs
 * at all. Accepting the token would record it and fire nothing. The structured spelling refuses
 * the same field, from `REMAINDER_REFUSED_NODE_FIELDS`, so the two spellings still say one thing.
 * Bind the gate with the `gates` parameter and its `target_step_id` instead.
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
  /** Set by a `==>` delimiter preceding this step (row A.5). */
  readonly delegated?: boolean;
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

  if (/(^|\s)::/.test(fragment)) {
    return {
      ok: false,
      message:
        'append refused: a raw "::" gate token is resolved against the gate registry at parse ' +
        'time, and an appended step joins a run that is resuming — no per-step criteria ' +
        'resolution runs there, so the token would be recorded and fire nothing. Bind the gate ' +
        'with the `gates` parameter and its target_step_id instead.',
    };
  }

  const segments = splitAppendSegments(fragment);
  const nodes: AppendNode[] = [];
  const taken = new Set<string>();

  for (const { text: segment, delegated } of segments) {
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
      ...(delegated ? { delegated: true } : {}),
    };
    nodes.push(node);
  }

  return { ok: true, nodes };
}

/**
 * Split an append fragment on its two step delimiters, recording which steps `==>` delegated.
 *
 * The delimiter semantics are `SymbolicOperatorParser.splitChainSteps`': `==>` marks the step
 * that FOLLOWS it, so `>>a ==> >>b` delegates b and leaves a alone, and a fragment that opens
 * with `==>` delegates its first step. Reimplemented here rather than shared, for the reason the
 * module header gives for `parseInlineArgs`: the symbolic splitter also tracks quote state for
 * positional argument strings this grammar does not accept, and importing the parser would give
 * this module a reason to know a class it otherwise does not touch.
 *
 * The `--> a --> b` arrows inside a QUOTED argument value are not defended against here for the
 * same reason the symbolic form defends them: it is `parseInlineArgs` that reads quotes, and a
 * split arrow inside one produces a segment that fails the `>>prompt_id` match with a named
 * refusal rather than a silently wrong plan.
 */
function splitAppendSegments(fragment: string): { text: string; delegated: boolean }[] {
  const segments: { text: string; delegated: boolean }[] = [];
  let current = '';
  // A fragment opening with `==>` delegates its first step and is not an empty leading segment:
  // `--> ==> >>a` is "append a, delegated". Consumed here rather than dropped after the split, so
  // that every OTHER empty segment still reaches the caller's `--> >>a --> --> >>b` refusal.
  let delegated = fragment.startsWith('==>');
  let index = delegated ? 3 : 0;

  while (index < fragment.length) {
    const delimiter = fragment.startsWith('==>', index)
      ? 'delegation'
      : fragment.startsWith('-->', index)
        ? 'chain'
        : undefined;
    if (delimiter !== undefined) {
      segments.push({ text: current.trim(), delegated });
      delegated = delimiter === 'delegation';
      current = '';
      index += 3;
      continue;
    }
    current += fragment[index];
    index += 1;
  }
  segments.push({ text: current.trim(), delegated });
  return segments;
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
 * `RemainderNodeSpec` carries id / promptId / stepName / args / delegated, so a `key="value"`
 * pair both satisfies `validateWorkflowIR`'s `required-argument-missing` check AND reaches the
 * rendered step (row A.5 widened the path; before it, these values were validated and dropped).
 * Positional arguments are still not accepted, because a contributed node has no positional form
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

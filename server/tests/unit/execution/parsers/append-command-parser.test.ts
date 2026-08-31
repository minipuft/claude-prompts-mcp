// @lifecycle test - Row A.3: the string spelling of an append remainder (OQ-A1).
/**
 * `parseAppendCommand` is the ONLY thing that differs between the two spellings of one append.
 * Everything after it — admissibility, `validateWorkflowIR`, caps, `replaceRemainder`, the
 * recorded `origin`/`origin_unknown_id` — is shared code the structured spelling already runs
 * through. So this suite's job is narrow and total: prove the string produces exactly the
 * structure a caller could have typed, and prove that everything it cannot represent is refused
 * by name rather than dropped.
 */

import { describe, expect, test } from '@jest/globals';

import {
  isAppendCommand,
  parseAppendCommand,
} from '../../../../src/engine/execution/parsers/append-command-parser.js';

describe('isAppendCommand', () => {
  test.each([
    ['--> >>x', true],
    ['   --> >>x', true],
    ['-->>>x', true],
    ['>>a --> >>b', false],
    ['>>x', false],
    ['', false],
    [undefined, false],
  ])('%p → %p', (command, expected) => {
    expect(isAppendCommand(command as string | undefined)).toBe(expected);
  });
});

describe('parseAppendCommand', () => {
  test('one step becomes one node with an id derived from the prompt id', () => {
    const parsed = parseAppendCommand('--> >>write_summary');
    expect(parsed).toEqual({
      ok: true,
      nodes: [{ id: 'write-summary', promptId: 'write_summary' }],
    });
  });

  test('several steps become several nodes, in written order', () => {
    const parsed = parseAppendCommand('--> >>research_docs --> >>write_summary');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.nodes.map((node) => node.promptId)).toEqual(['research_docs', 'write_summary']);
    expect(parsed.nodes.map((node) => node.id)).toEqual(['research-docs', 'write-summary']);
  });

  test('a repeated prompt gets distinct ids', () => {
    const parsed = parseAppendCommand('--> >>review --> >>review --> >>review');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.nodes.map((node) => node.id)).toEqual(['review', 'review-2', 'review-3']);
  });

  test('key="value" arguments are carried onto the node', () => {
    const parsed = parseAppendCommand('--> >>write_summary topic="cache TTL" depth=2');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.nodes[0]?.args).toEqual({ topic: 'cache TTL', depth: '2' });
  });

  test('a step with no arguments carries no `args` key at all', () => {
    // The byte-identical negative: a caller writing the structured spelling of the same append
    // omits `args`, and OQ-A1 requires the two to be indistinguishable.
    const parsed = parseAppendCommand('--> >>review');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.nodes[0]).not.toHaveProperty('args');
  });

  test.each([
    ['a command that is not an append', '>>write_summary', 'must begin with "-->"'],
    ['an arrow naming nothing', '-->', 'names no steps'],
    ['an empty segment', '--> >>a --> ', 'empty step'],
    ['a segment that is not a prompt reference', '--> summarise it', 'not a prompt reference'],
    ['the gate operator', '--> >>a :: "cite sources"', 'raw "::" gate token'],
  ])('refuses %s by name', (_label, command, fragment) => {
    const parsed = parseAppendCommand(command);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain(fragment);
  });

  // --- row A.5: `==>` is mapped, not refused --------------------------------------------------

  describe('the "==>" delegation operator maps onto the node declaration (row A.5)', () => {
    test('it delegates the step that FOLLOWS it, and only that step', () => {
      // The delimiter semantics are `SymbolicOperatorParser.splitChainSteps`'. A different
      // reading here would make one operator mean two things depending on where it is written.
      const parsed = parseAppendCommand('--> >>draft ==> >>review');
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.nodes).toHaveLength(2);
      expect(parsed.nodes[0]).not.toHaveProperty('delegated');
      expect(parsed.nodes[1]).toMatchObject({ promptId: 'review', delegated: true });
    });

    test('a fragment opening with "==>" delegates its first step rather than reading as empty', () => {
      const parsed = parseAppendCommand('--> ==> >>review');
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.nodes).toEqual([{ id: 'review', promptId: 'review', delegated: true }]);
    });

    test('a step with no "==>" carries no `delegated` key at all', () => {
      // Same byte-identity requirement as `args`: the structured spelling omits the key, and
      // OQ-A1 requires the two spellings to be indistinguishable at the row.
      const parsed = parseAppendCommand('--> >>review');
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.nodes[0]).not.toHaveProperty('delegated');
    });

    test('delegation and arguments survive together on one step', () => {
      const parsed = parseAppendCommand('--> ==> >>review depth="2"');
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.nodes[0]).toMatchObject({ delegated: true, args: { depth: '2' } });
    });

    test('an empty segment between two "-->" arrows is still refused', () => {
      // The positive control for the leading-`==>` allowance: consuming a leading delimiter must
      // not turn the `--> --> >>a` typo into a silent accept.
      const parsed = parseAppendCommand('-->  --> >>a');
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.message).toContain('empty step');
    });
  });

  test('a "::" inside a quoted argument value is not read as a gate operator', () => {
    // The refusal keys on `::` preceded by whitespace or start-of-fragment, mirroring how the
    // symbolic parser leaves `input="has :: colons"` alone. Without this the refusal would
    // reject a legitimate argument.
    const parsed = parseAppendCommand('--> >>write_summary note="a::b"');
    expect(parsed.ok).toBe(true);
  });
});

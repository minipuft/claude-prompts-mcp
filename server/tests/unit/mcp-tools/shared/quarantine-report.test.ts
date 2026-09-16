// @lifecycle canonical - Unit tests for how quarantined resource files are reported (P4.9, P4.15)
/**
 * The announcement half of quarantine.
 *
 * The silence is the other half of the defect the row closes: an operator edits a workspace
 * prompt, breaks it, and a definition from another root answers with no indication their edit is
 * inert. These assertions exist so that never becomes true again quietly — each one reads the
 * operator-visible string, not an internal flag.
 */

import { describe, expect, it } from '@jest/globals';

import {
  formatQuarantineSection,
  formatQuarantinedInspect,
  formatRepairServingLine,
  formatShadowedNote,
  summarizeQuarantine,
} from '../../../../src/mcp/tools/shared/quarantine-report.js';

import type { QuarantinedResource } from '../../../../src/shared/utils/resource-quarantine.js';

const record = (overrides: Partial<QuarantinedResource> = {}): QuarantinedResource => ({
  type: 'prompt',
  id: 'minimal_prompt',
  category: 'examples',
  root: '/ws/resources/prompts',
  path: '/ws/resources/prompts/examples/minimal_prompt/prompt.yaml',
  error: 'arguments: expected array, received string',
  ...overrides,
});

describe('summarizeQuarantine', () => {
  it('marks a record shadowed, and names the root actually serving the id', () => {
    const findings = summarizeQuarantine(
      [record()],
      [{ id: 'minimal_prompt', sourceRoot: '/pkg/resources/prompts' }]
    );

    expect(findings[0]?.shadowed).toBe(true);
    expect(findings[0]?.servedFrom).toBe('/pkg/resources/prompts');
  });

  it('leaves a record unshadowed when nothing serves its id', () => {
    const findings = summarizeQuarantine(
      [record({ id: 'broken_prompt' })],
      [{ id: 'minimal_prompt', sourceRoot: '/pkg/resources/prompts' }]
    );

    expect(findings[0]?.shadowed).toBe(false);
    expect(findings[0]?.servedFrom).toBeUndefined();
  });
});

describe('formatQuarantineSection', () => {
  it('is empty when nothing is quarantined, so a healthy list is unchanged', () => {
    expect(formatQuarantineSection([], 'prompt')).toBe('');
  });

  it('names the id, the path and the load error', () => {
    const section = formatQuarantineSection(summarizeQuarantine([record()], []), 'prompt');

    expect(section).toContain('Quarantined** (1)');
    expect(section).toContain('/ws/resources/prompts/examples/minimal_prompt/prompt.yaml');
    expect(section).toContain('arguments: expected array, received string');
  });

  it('conditions the repair on rank, when a valid definition is shadowing it', () => {
    const section = formatQuarantineSection(
      summarizeQuarantine([record()], [{ id: 'minimal_prompt', sourceRoot: '/pkg/prompts' }]),
      'prompt'
    );

    expect(section).toContain('shadowed');
    expect(section).toContain('/pkg/prompts');
    // "changes … only if its root outranks that one", not the flat "will change what serves" this
    // said until P4.35. Since the loaders read past the root that serves, a record here can come
    // from BELOW the winner, where repairing it changes nothing about what answers.
    expect(section).toContain('changes what serves only if its root outranks that one');
    expect(section).not.toContain('will change what serves');
  });
});

describe('formatQuarantinedInspect', () => {
  it('replaces "not found" with the path, root, category and reason', () => {
    const text = formatQuarantinedInspect(
      [record({ id: 'broken_prompt', category: 'probecat' })],
      'prompt'
    );

    expect(text).toContain('Quarantined');
    expect(text).toContain('broken_prompt');
    expect(text).toContain('probecat');
    expect(text).toContain('/ws/resources/prompts/examples/minimal_prompt/prompt.yaml');
    expect(text).toContain('arguments: expected array, received string');
  });
});

describe('formatShadowedNote', () => {
  it('is empty for a prompt nothing quarantined, so an ordinary inspect is unchanged', () => {
    expect(formatShadowedNote([], '/pkg/prompts')).toBe('');
  });

  it('says which root the reader is actually looking at', () => {
    const note = formatShadowedNote([record()], '/pkg/resources/prompts');

    expect(note).toContain('served from /pkg/resources/prompts');
    expect(note).toContain('/ws/resources/prompts/examples/minimal_prompt/prompt.yaml');
  });

  it('claims no rank for the refused file, because it has not been given one', () => {
    const note = formatShadowedNote([record()], '/pkg/resources/prompts');

    // Both sentences were written when the only root that could go quiet was one ABOVE the
    // winner. P4.35 made the loaders read past the root that served, so a record here can come
    // from the writable root BELOW it — where the file is neither nearer nor able to change what
    // serves by being repaired.
    expect(note).not.toContain('A nearer file');
    expect(note).toContain('Another file for this id failed to load');
    expect(note).toContain('only if its root outranks /pkg/resources/prompts');
    expect(note).not.toContain('will change what');
  });
});

/**
 * The line a repair response adds about which root answers the id AFTER the write.
 *
 * WHAT IT REPLACES. Both repair responses told the operator that the repair "wrote `<path>`,
 * which takes precedence, so `<id>` now serves your copy". A repair lands in the WRITABLE root,
 * and since P4.27 every overlay outranks that root — so the sentence asserted a rank the write
 * does not have, and drew a serving conclusion from it. Here the conclusion is an input: the
 * callers read the loader's own `sourceRoot` stamp back after the reload and pass it in.
 *
 * Unit rather than integration for the outranked branch specifically. `handleUpdate` only reaches
 * its repair path when the registry has no entry for the id, so no root above the write target
 * can hold a definition that loads — which makes the outranked outcome unreachable from the gate
 * tool today, and reachable on the framework side only through `getFramework`'s disabled filter.
 * A renderer that is only correct on the branches currently reachable is one refactor away from
 * being wrong, so all three are pinned here.
 */
describe('formatRepairServingLine', () => {
  it('says the written copy serves, when the stamp names the root it was written to', () => {
    const line = formatRepairServingLine(
      'broken-gate',
      '/ws/resources/gates',
      '/ws/resources/gates'
    );

    expect(line).toContain('`broken-gate` is served from your copy in /ws/resources/gates');
    expect(line).not.toContain('outranks');
  });

  it('names the root that outranks the write, and says the copy is NOT what answers', () => {
    const line = formatRepairServingLine('broken-gate', '/ws/resources/gates', '/ws/gates');

    expect(line).toContain('still served from /ws/gates, which outranks /ws/resources/gates');
    expect(line).toContain('is NOT what answers');
    // The two claims this row removed, in the branch that used to make them.
    expect(line).not.toContain('takes precedence');
    expect(line).not.toContain('serves your copy');
  });

  it('says nothing serves the id, rather than picking one of the other two', () => {
    const line = formatRepairServingLine('broken-gate', '/ws/resources/gates', undefined);

    expect(line).toContain('Nothing currently serves `broken-gate`');
    expect(line).not.toContain('outranks');
    expect(line).not.toContain('served from your copy');
  });

  it('compares roots by resolved path, so a trailing separator is not a different root', () => {
    const line = formatRepairServingLine(
      'broken-gate',
      '/ws/resources/gates/',
      '/ws/resources/gates'
    );

    expect(line).toContain('is served from your copy');
    expect(line).not.toContain('outranks');
  });
});

describe('the flat layouts gates and frameworks use (P4.15)', () => {
  const gateRecord: QuarantinedResource = {
    type: 'gate',
    id: 'broken-gate',
    root: '/ws/resources/gates',
    path: '/ws/resources/gates/broken-gate/gate.yaml',
    error: 'type: expected validation | guidance',
  };

  it('renders no category line for a record that carries none', () => {
    const text = formatQuarantinedInspect([gateRecord], 'gate');

    expect(text).toContain('/ws/resources/gates/broken-gate/gate.yaml');
    expect(text).not.toContain('Category');
    expect(text).not.toContain('undefined');
  });

  it('names the repaired thing by the caller\'s noun, not always "prompt"', () => {
    const section = formatQuarantineSection(summarizeQuarantine([gateRecord], []), 'gate');

    expect(section).toContain('the full gate body');
    expect(section).not.toContain('the full prompt body');
  });

  it('POSITIVE CONTROL — a record that DOES carry a category still renders one', () => {
    const text = formatQuarantinedInspect([record({ category: 'probecat' })], 'prompt');

    expect(text).toContain('**Category**: probecat');
  });
});

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

  it('says the repair will change what serves, when a valid definition is shadowing it', () => {
    const section = formatQuarantineSection(
      summarizeQuarantine([record()], [{ id: 'minimal_prompt', sourceRoot: '/pkg/prompts' }]),
      'prompt'
    );

    expect(section).toContain('shadowed');
    expect(section).toContain('/pkg/prompts');
    expect(section).toContain('will change what serves');
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

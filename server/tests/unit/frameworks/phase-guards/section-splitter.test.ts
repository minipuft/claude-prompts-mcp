import { splitBySectionHeaders } from '../../../../src/engine/frameworks/phase-guards/section-splitter.js';

describe('splitBySectionHeaders', () => {
  it('returns empty map for empty output', () => {
    const result = splitBySectionHeaders('', ['## Context']);
    expect(result.size).toBe(0);
  });

  it('returns empty map for empty section headers array', () => {
    const result = splitBySectionHeaders('Some output text', []);
    expect(result.size).toBe(0);
  });

  it('splits output by single section header', () => {
    const output = `## Context\nThis is the context section.\nWith multiple lines.`;
    const result = splitBySectionHeaders(output, ['## Context']);

    expect(result.size).toBe(1);
    const section = result.get('## Context');
    expect(section).toBeDefined();
    expect(section!.section_header).toBe('## Context');
    expect(section!.content).toBe('This is the context section.\nWith multiple lines.');
  });

  it('splits output by multiple section headers', () => {
    const output = [
      '## Context',
      'Context content here.',
      '',
      '## Analysis',
      'Analysis content here.',
      'More analysis.',
      '',
      '## Goals',
      'Goal content.',
    ].join('\n');

    const result = splitBySectionHeaders(output, ['## Context', '## Analysis', '## Goals']);

    expect(result.size).toBe(3);
    expect(result.get('## Context')!.content).toBe('Context content here.');
    expect(result.get('## Analysis')!.content).toBe('Analysis content here.\nMore analysis.');
    expect(result.get('## Goals')!.content).toBe('Goal content.');
  });

  it('handles section headers not present in output', () => {
    const output = '## Context\nSome content.';
    const result = splitBySectionHeaders(output, ['## Context', '## Missing']);

    expect(result.size).toBe(1);
    expect(result.has('## Context')).toBe(true);
    expect(result.has('## Missing')).toBe(false);
  });

  it('matches section headers case-insensitively', () => {
    const output = '## context\nContent here.';
    const result = splitBySectionHeaders(output, ['## Context']);

    expect(result.size).toBe(1);
    expect(result.get('## Context')!.content).toBe('Content here.');
  });

  it('trims whitespace from section header matching', () => {
    const output = '  ## Context  \nContent here.';
    const result = splitBySectionHeaders(output, ['## Context']);

    expect(result.size).toBe(1);
    expect(result.get('## Context')!.content).toBe('Content here.');
  });

  it('takes first match when section header appears multiple times', () => {
    const output = [
      '## Context',
      'First context.',
      '## Analysis',
      'Analysis content.',
      '## Context',
      'Second context (ignored).',
    ].join('\n');

    const result = splitBySectionHeaders(output, ['## Context', '## Analysis']);

    expect(result.size).toBe(2);
    // First ## Context extends to ## Analysis
    expect(result.get('## Context')!.content).toBe('First context.');
  });

  it('handles content before first section header', () => {
    const output = ['Some preamble text.', '', '## Context', 'Context content.'].join('\n');

    const result = splitBySectionHeaders(output, ['## Context']);

    expect(result.size).toBe(1);
    expect(result.get('## Context')!.content).toBe('Context content.');
  });

  it('handles markers in different order than input array', () => {
    // Markers requested in one order, appear in output in a different order
    const output = ['## Goals', 'Goal content.', '', '## Context', 'Context content.'].join('\n');

    const result = splitBySectionHeaders(output, ['## Context', '## Goals']);

    expect(result.size).toBe(2);
    // Content between section headers should be based on document order
    expect(result.get('## Goals')!.content).toBe('Goal content.');
    expect(result.get('## Context')!.content).toBe('Context content.');
  });

  it('trims content of each section', () => {
    const output = ['## Context', '', '  Content with leading/trailing whitespace.  ', ''].join(
      '\n'
    );

    const result = splitBySectionHeaders(output, ['## Context']);
    expect(result.get('## Context')!.content).toBe('Content with leading/trailing whitespace.');
  });

  it('returns empty content for marker with no content before next section header', () => {
    const output = ['## Context', '## Analysis', 'Analysis content.'].join('\n');

    const result = splitBySectionHeaders(output, ['## Context', '## Analysis']);

    expect(result.get('## Context')!.content).toBe('');
    expect(result.get('## Analysis')!.content).toBe('Analysis content.');
  });

  // Tolerant header matching (hardening 2026-06-22): the model rarely reproduces the exact
  // configured header string. Heading level, trailing colon, and bold wrapping must still match,
  // so a correct-but-not-byte-identical header isn't reported "missing" → no unsatisfiable loop.
  it('matches a different heading level (### vs ##)', () => {
    const result = splitBySectionHeaders('### Context\nContent here.', ['## Context']);
    expect(result.get('## Context')!.content).toBe('Content here.');
  });

  it('matches a header with a trailing colon', () => {
    const result = splitBySectionHeaders('## Context:\nContent here.', ['## Context']);
    expect(result.get('## Context')!.content).toBe('Content here.');
  });

  it('matches a bold-wrapped header', () => {
    const result = splitBySectionHeaders('## **Context**\nContent here.', ['## Context']);
    expect(result.get('## Context')!.content).toBe('Content here.');
  });

  it('matches a header that combines variants (### **Context:**)', () => {
    const result = splitBySectionHeaders('### **Context:**\nContent here.', ['## Context']);
    expect(result.get('## Context')!.content).toBe('Content here.');
  });

  it('does NOT match prose that merely contains the header word', () => {
    const result = splitBySectionHeaders('Context of the work is broad.\nMore.', ['## Context']);
    expect(result.has('## Context')).toBe(false);
  });
});

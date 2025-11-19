import { describe, expect, test } from '@jest/globals';

import { renderPromptEngineGuide } from '../../../../src/mcp-tools/prompt-engine/utils/guide.js';

describe('Prompt Engine guide renderer', () => {
  test('includes key sections with default guidance', () => {
    const output = renderPromptEngineGuide();
    expect(output).toContain('Prompt Engine Guide');
    expect(output).toContain('Key Parameters');
    expect(output).toContain('Built-in Commands');
    expect(output).toContain('Usage Patterns');
    expect(output).toContain('Full Parameter Catalog');
  });

  test('highlights gate-related parameters when goal mentions gates', () => {
    const output = renderPromptEngineGuide('gate validation');
    expect(output).toContain('api_validation');
    expect(output).toContain('quality_gates');
    expect(output).toContain('gate_scope');
  });

  test('surfaces usage pattern details with sample commands', () => {
    const output = renderPromptEngineGuide();
    expect(output).toContain('Gate Controls + Temporary Gates');
    expect(output).toContain('```json');
    expect(output).toContain('"temporary_gates"');
  });
});

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
    expect(output).toContain('gates'); // Unified gates parameter
    expect(output).toContain('gate_verdict'); // Gate review response parameter
  });

  test('surfaces usage pattern details with sample commands and unified gates parameter', () => {
    const output = renderPromptEngineGuide();
    expect(output).toContain('Unified Gates Parameter'); // New usage pattern name
    expect(output).toContain('```json');
    expect(output).toContain('"gates"'); // New unified parameter
  });
});

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { GateGuidanceRenderer } from '../../../../src/engine/gates/guidance/GateGuidanceRenderer.js';

const logger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const createMockLoader = () => ({
  loadGate: jest.fn(),
  isGateActive: jest.fn(),
  listAvailableGates: jest.fn(),
});

describe('GateGuidanceRenderer (loader integration)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('renders guidance via the injected GateLoader without hitting the filesystem fallback', async () => {
    const loader = createMockLoader();
    (loader.loadGate as jest.Mock).mockResolvedValue({
      id: 'gate.alpha',
      name: 'Alpha Gate',
      type: 'guidance',
      description: '',
      guidance: '- Alpha instructions',
      activation: {},
    });
    (loader.isGateActive as jest.Mock).mockReturnValue(true);

    const renderer = new GateGuidanceRenderer(logger as any, {
      gateLoader: loader as any,
    });

    const guidance = await renderer.renderGuidance(['gate.alpha'], {
      framework: 'ReACT',
    });

    expect(loader.loadGate).toHaveBeenCalledWith('gate.alpha');
    expect(loader.isGateActive).toHaveBeenCalled();
    expect(guidance).toContain('Alpha Gate');
  });

  test('getAvailableGates delegates to the provided loader when available', async () => {
    const loader = createMockLoader();
    (loader.listAvailableGates as jest.Mock).mockResolvedValue(['gate.alpha']);

    const renderer = new GateGuidanceRenderer(logger as any, {
      gateLoader: loader as any,
    });

    const gates = await renderer.getAvailableGates();

    expect(loader.listAvailableGates).toHaveBeenCalled();
    expect(gates).toEqual(['gate.alpha']);
  });

  test('renders inline guidance sections before framework guidance', async () => {
    const loader = createMockLoader();
    (loader.loadGate as jest.Mock).mockImplementation(async (gateId: string) => {
      if (gateId === 'inline_gate_clarity') {
        return {
          id: gateId,
          name: 'Inline Clarity Gate',
          type: 'guidance',
          guidance: '- Ensure the response is clear and concise.',
          activation: {},
        };
      }

      if (gateId === 'framework_quality') {
        return {
          id: gateId,
          name: 'Framework Excellence',
          type: 'framework',
          guidance: '- Follow framework expectations.',
          activation: { categories: ['analysis'] },
        };
      }

      return null;
    });
    (loader.isGateActive as jest.Mock).mockReturnValue(true);

    const renderer = new GateGuidanceRenderer(logger as any, {
      gateLoader: loader as any,
    });

    const guidance = await renderer.renderGuidance(['inline_gate_clarity', 'framework_quality'], {
      framework: 'CAGEERF',
      category: 'analysis',
    });

    expect(guidance).toContain('## Inline Gates');
    expect(guidance).toContain('Inline Clarity Gate');
    expect(guidance).toContain('Framework Excellence');
    expect(guidance).toContain('**Post-Execution Review Guidelines:**');
  });

  test('filters framework guidance down to the active framework', async () => {
    const loader = createMockLoader();
    (loader.loadGate as jest.Mock).mockResolvedValue({
      id: 'framework-compliance',
      name: 'Framework Compliance',
      type: 'framework',
      guidance:
        '- CAGEERF: Provide context, analysis, goals, execution, evaluation, refinement\n' +
        '- ReACT: Show reasoning/acting phases clearly',
      activation: { framework_context: ['CAGEERF', 'ReACT'] },
    });
    (loader.isGateActive as jest.Mock).mockReturnValue(true);

    const renderer = new GateGuidanceRenderer(logger as any, {
      gateLoader: loader as any,
      frameworkIdentifierProvider: () => ['CAGEERF', 'REACT'],
    });

    const guidance = await renderer.renderGuidance(['framework-compliance'], {
      framework: 'CAGEERF',
    });

    expect(guidance).toContain('CAGEERF Framework Guidelines');
    expect(guidance).toContain(
      'Provide context, analysis, goals, execution, evaluation, refinement'
    );
    expect(guidance).not.toContain('ReACT');
  });

  test('loads temporary gates via GateLoader (no direct registry fallback)', async () => {
    const loader = createMockLoader();
    // GateLoader is responsible for checking temporary registry internally
    // So we mock it to return the gate as if it found it in the registry
    (loader.loadGate as jest.Mock).mockResolvedValue({
      id: 'custom_quality_gate',
      name: 'Custom Quality Gate',
      type: 'validation',
      description: 'Custom guidance',
      guidance: '- Ensure custom output guidelines.',
    });
    (loader.isGateActive as jest.Mock).mockReturnValue(true);

    const renderer = new GateGuidanceRenderer(logger as any, {
      gateLoader: loader as any,
    });

    const guidance = await renderer.renderGuidance(['custom_quality_gate'], {
      framework: 'CAGEERF',
    });

    // Renderer should only call GateLoader, not temporary registry directly
    expect(loader.loadGate).toHaveBeenCalledWith('custom_quality_gate');
    expect(guidance).toContain('Custom Quality Gate');
    expect(guidance).toContain('Ensure custom output guidelines');
  });

  test('renders explicit-request gates when context marks them explicit', async () => {
    const loader = createMockLoader();
    (loader.loadGate as jest.Mock).mockResolvedValue({
      id: 'code-quality',
      name: 'Code Quality Gate',
      type: 'validation',
      guidance: '- Ensure code passes linting.',
      activation: { explicit_request: true },
    });
    (loader.isGateActive as jest.Mock).mockImplementation((_gate, ctx) =>
      Boolean(ctx.explicitRequest)
    );

    const renderer = new GateGuidanceRenderer(logger as any, {
      gateLoader: loader as any,
    });

    const guidance = await renderer.renderGuidance(['code-quality'], {
      framework: 'CAGEERF',
      explicitGateIds: ['code-quality'],
    });

    expect(guidance).toContain('Code Quality Gate');
    expect(guidance).toContain('Ensure code passes linting.');
  });

  /**
   * Tutorial-rework B.18 follow-up: `GateDefinitionLoader` now inlines
   * `guidance.md` verbatim (no `.trim()`), so `gate.guidance` on a real, Prettier-formatted gate
   * ends with `\n`. This is the ONE reachable render site (`.guidanceText` in `gate-loader.ts`
   * and `gate-provider-adapter.ts` is built but never read by anything — verified via
   * `rg -n "\.guidanceText\b" src` finding only its own definition). Guards that a trailing
   * newline on the loaded value does not widen the blank line between rendered gate sections.
   */
  describe('trailing-newline guidance stays a single blank line between sections', () => {
    function loaderWithTrailingNewlineGuidance() {
      const loader = createMockLoader();
      // `as any`: matches this file's existing untyped-mock pattern (see the other
      // `mockImplementation`/`mockResolvedValue` calls above) — `createMockLoader()` returns
      // bare `jest.fn()`s, so a typed callback is never assignable without it.
      (loader.loadGate as jest.Mock).mockImplementation((async (gateId: string) => {
        if (gateId === 'framework_gate_one') {
          return {
            id: gateId,
            name: 'Framework Gate One',
            type: 'framework',
            // Trailing `\n` — what `GateDefinitionLoader` now returns for a real guidance.md.
            guidance: '- Do the first thing.\n',
            activation: {},
          };
        }
        if (gateId === 'framework_gate_two') {
          return {
            id: gateId,
            name: 'Framework Gate Two',
            type: 'framework',
            guidance: '- Do the second thing.\n',
            activation: {},
          };
        }
        return null;
      }) as any);
      (loader.isGateActive as jest.Mock).mockReturnValue(true);
      return loader;
    }

    test('two framework gates stay separated by exactly one blank line', async () => {
      const loader = loaderWithTrailingNewlineGuidance();
      const renderer = new GateGuidanceRenderer(logger as any, { gateLoader: loader as any });

      const guidance = await renderer.renderGuidance(['framework_gate_one', 'framework_gate_two'], {
        framework: 'CAGEERF',
      });

      // MUTATION KILLED: dropping the `.trim()` in `formatGateGuidance` makes this fail — three
      // gate one's trailing `\n` plus the `\n\n` join separator produce a second blank line.
      // Confirmed by reverting the trim, re-running this file (red), and restoring it.
      expect(guidance).toContain('Do the first thing.\n\n### Framework Gate Two');
      expect(guidance).not.toContain('Do the first thing.\n\n\n');
    });

    test('the Post-Execution Review section stays one blank line after the last gate', async () => {
      const loader = loaderWithTrailingNewlineGuidance();
      const renderer = new GateGuidanceRenderer(logger as any, { gateLoader: loader as any });

      const guidance = await renderer.renderGuidance(['framework_gate_two'], {
        framework: 'CAGEERF',
      });

      expect(guidance).toContain('Do the second thing.\n\n**Post-Execution Review Guidelines:**');
      expect(guidance).not.toContain('Do the second thing.\n\n\n');
    });
  });
});

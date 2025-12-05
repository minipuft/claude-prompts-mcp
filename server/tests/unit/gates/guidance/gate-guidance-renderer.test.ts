import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { GateGuidanceRenderer } from '../../../../src/gates/guidance/GateGuidanceRenderer.js';

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
          guidance: '- Follow methodology expectations.',
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

  test('filters framework guidance down to the active methodology', async () => {
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

    expect(guidance).toContain('CAGEERF Methodology Guidelines');
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
});

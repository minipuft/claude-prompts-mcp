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
    expect(guidance).toContain(
      "Attest reminders in the verdict's `reminders` field; checks are recorded by the engine."
    );
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

    test('the closing attestation line stays one blank line after the last gate', async () => {
      const loader = loaderWithTrailingNewlineGuidance();
      const renderer = new GateGuidanceRenderer(logger as any, { gateLoader: loader as any });

      const guidance = await renderer.renderGuidance(['framework_gate_two'], {
        framework: 'CAGEERF',
      });

      expect(guidance).toContain('Do the second thing.\n\nAttest reminders in the verdict');
      expect(guidance).not.toContain('Do the second thing.\n\n\n');
    });
  });
});

/**
 * Row 0.4 (gate-checks-and-reminders): the renderer partitions loaded gates by
 * `deriveGateTier` — a check gets one line naming what it runs, a reminder gets its guidance,
 * subject to `gates.harnessCovers` suppression (ruling B2) and `gates.reminderTokenBudget`
 * degradation (ruling B10, degrade never drop).
 */
describe('GateGuidanceRenderer tier partition, harnessCovers, and reminder budget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /** Fake loader over a fixed map of gate definitions, matching this file's untyped-mock style. */
  const loaderFor = (gates: Record<string, unknown>) => {
    const loader = createMockLoader();
    (loader.loadGate as jest.Mock).mockImplementation((async (gateId: string) => {
      return gates[gateId] ?? null;
    }) as any);
    (loader.isGateActive as jest.Mock).mockReturnValue(true);
    return loader;
  };

  const reminderGate = (
    id: string,
    overrides: Record<string, unknown> = {}
  ): Record<string, unknown> => ({
    id,
    name: `${id} Gate`,
    type: 'guidance',
    description: `${id} description`,
    guidance: `- ${id} guidance body.`,
    activation: {},
    ...overrides,
  });

  describe('harnessCovers suppresses reminders by subject', () => {
    const gates = {
      'sec-reminder': reminderGate('sec-reminder', {
        name: 'Security Reminder',
        subject: 'security',
        guidance: '- Check for injection.',
      }),
    };

    test('a reminder whose subject is covered by the harness is absent entirely', async () => {
      const renderer = new GateGuidanceRenderer(logger as any, {
        gateLoader: loaderFor(gates) as any,
        gatesConfigProvider: () => ({ harnessCovers: ['security'] }),
      });

      const guidance = await renderer.renderGuidance(['sec-reminder'], {});

      // MUTATION KILLED: deleting the `gate.subject && harnessCovers.includes(gate.subject)`
      // suppression branch in `renderGuidance` makes THIS line go red —
      // `expect(guidance).toBe('')` instead receives the full `### Security Reminder` section.
      // Confirmed by removing the branch, re-running this file (red), and restoring it.
      expect(guidance).toBe('');
    });

    test('the same reminder renders when harnessCovers is empty', async () => {
      const renderer = new GateGuidanceRenderer(logger as any, {
        gateLoader: loaderFor(gates) as any,
        gatesConfigProvider: () => ({ harnessCovers: [] }),
      });

      const guidance = await renderer.renderGuidance(['sec-reminder'], {});

      expect(guidance).toContain('### Reminders');
      expect(guidance).toContain('Security Reminder');
      expect(guidance).toContain('Check for injection.');
    });

    test('config outranks the prompt author: an explicitly requested reminder is still suppressed', async () => {
      const renderer = new GateGuidanceRenderer(logger as any, {
        gateLoader: loaderFor(gates) as any,
        gatesConfigProvider: () => ({ harnessCovers: ['security'] }),
      });

      const guidance = await renderer.renderGuidance(['sec-reminder'], {
        explicitGateIds: ['sec-reminder'],
      });

      expect(guidance).toBe('');
    });

    test('a reminder with no subject is never suppressed', async () => {
      const renderer = new GateGuidanceRenderer(logger as any, {
        gateLoader: loaderFor({ plain: reminderGate('plain') }) as any,
        gatesConfigProvider: () => ({ harnessCovers: ['security', 'plain'] }),
      });

      const guidance = await renderer.renderGuidance(['plain'], {});

      expect(guidance).toContain('plain guidance body.');
    });
  });

  describe('checks render as one line naming what they run, never their guidance', () => {
    test('a shell_verify gate lists its command and drops its guidance', async () => {
      const renderer = new GateGuidanceRenderer(logger as any, {
        gateLoader: loaderFor({
          'suite-check': {
            id: 'suite-check',
            name: 'Test Suite',
            type: 'validation',
            description: 'Runs the suite',
            subject: 'testing',
            guidance: '- SECRET GUIDANCE BODY that must not reach the prompt.',
            pass_criteria: [{ type: 'shell_verify', shell_command: ['npm', 'test'] }],
            activation: {},
          },
        }) as any,
        gatesConfigProvider: () => ({ harnessCovers: [], reminderTokenBudget: 800 }),
      });

      const guidance = await renderer.renderGuidance(['suite-check'], {});

      expect(guidance).toContain('### Checks');
      expect(guidance).toContain('- **Test Suite** — check: runs `npm test`');
      expect(guidance).not.toContain('SECRET GUIDANCE BODY');
      expect(guidance).not.toContain('### Reminders');
    });

    test('a check is not suppressed even when its subject is in harnessCovers', async () => {
      const renderer = new GateGuidanceRenderer(logger as any, {
        gateLoader: loaderFor({
          'tool-check': {
            id: 'tool-check',
            name: 'Lint Tool',
            type: 'validation',
            description: 'Runs the lint tool',
            subject: 'testing',
            guidance: '- lint guidance',
            pass_criteria: [{ type: 'script_tool', script_tool_id: 'lint-runner' }],
            activation: {},
          },
        }) as any,
        gatesConfigProvider: () => ({ harnessCovers: ['testing'] }),
      });

      const guidance = await renderer.renderGuidance(['tool-check'], {});

      expect(guidance).toContain('- **Lint Tool** — check: runs tool `lint-runner`');
    });
  });

  describe('reminderTokenBudget degrades, never drops', () => {
    const threeGates = {
      low: reminderGate('low', {
        name: 'Low Gate',
        severity: 'low',
        description: 'low summary',
        guidance: `- ${'l'.repeat(200)}`,
      }),
      high: reminderGate('high', {
        name: 'High Gate',
        severity: 'high',
        description: 'high summary',
        guidance: `- ${'h'.repeat(200)}`,
      }),
      critical: reminderGate('critical', {
        name: 'Critical Gate',
        severity: 'critical',
        description: 'critical summary',
        guidance: `- ${'c'.repeat(200)}`,
      }),
    };

    test('budget 0 renders every reminder as one line', async () => {
      const renderer = new GateGuidanceRenderer(logger as any, {
        gateLoader: loaderFor(threeGates) as any,
        gatesConfigProvider: () => ({ reminderTokenBudget: 0 }),
      });

      const guidance = await renderer.renderGuidance(['low', 'high', 'critical'], {});

      expect(guidance).toContain('- **Low Gate** — low summary');
      expect(guidance).toContain('- **High Gate** — high summary');
      expect(guidance).toContain('- **Critical Gate** — critical summary');
      // Degrade, never drop: all three are still present, none of them in full.
      expect(guidance).not.toContain('lll');
      expect(guidance).not.toContain('hhh');
      expect(guidance).not.toContain('ccc');
    });

    test('a large budget renders every reminder in full', async () => {
      const renderer = new GateGuidanceRenderer(logger as any, {
        gateLoader: loaderFor(threeGates) as any,
        gatesConfigProvider: () => ({ reminderTokenBudget: 100000 }),
      });

      const guidance = await renderer.renderGuidance(['low', 'high', 'critical'], {});

      expect(guidance).toContain('### Low Gate');
      expect(guidance).toContain('lll');
      expect(guidance).toContain('hhh');
      expect(guidance).toContain('ccc');
      expect(guidance).not.toContain('- **Low Gate** — low summary');
    });

    test('severity ordering decides which reminder overflows into one line', async () => {
      // Each rendered section is ~220 chars → ~55 tokens. A 120-token budget fits two.
      const renderer = new GateGuidanceRenderer(logger as any, {
        gateLoader: loaderFor(threeGates) as any,
        gatesConfigProvider: () => ({ reminderTokenBudget: 120 }),
      });

      const guidance = await renderer.renderGuidance(['low', 'high', 'critical'], {});

      // Input order is low, high, critical — severity desc reorders to critical, high, low,
      // so `low` is the one that overflows despite being requested first.
      expect(guidance).toContain('ccc');
      expect(guidance).toContain('hhh');
      expect(guidance).not.toContain('lll');
      expect(guidance).toContain('- **Low Gate** — low summary');
      expect(guidance.indexOf('Critical Gate')).toBeLessThan(guidance.indexOf('High Gate'));
    });

    test('an explicitly requested reminder keeps full guidance ahead of a more severe one', async () => {
      const renderer = new GateGuidanceRenderer(logger as any, {
        gateLoader: loaderFor(threeGates) as any,
        gatesConfigProvider: () => ({ reminderTokenBudget: 60 }),
      });

      const guidance = await renderer.renderGuidance(['low', 'high', 'critical'], {
        explicitGateIds: ['low'],
      });

      expect(guidance).toContain('lll');
      expect(guidance).toContain('- **Critical Gate** — critical summary');
    });

    test('absent gatesConfigProvider falls back to the config.schema.json defaults', async () => {
      const renderer = new GateGuidanceRenderer(logger as any, {
        gateLoader: loaderFor(threeGates) as any,
      });

      const guidance = await renderer.renderGuidance(['critical'], {});

      // Default budget 800 tokens comfortably fits one ~55-token reminder, and the default
      // harnessCovers of [] suppresses nothing.
      expect(guidance).toContain('ccc');
    });
  });

  test('the retired Post-Execution Review pair is gone from the rendered output', async () => {
    const renderer = new GateGuidanceRenderer(logger as any, {
      gateLoader: loaderFor({ plain: reminderGate('plain') }) as any,
    });

    const guidance = await renderer.renderGuidance(['plain'], {});

    expect(guidance).not.toContain('Post-Execution Review Guidelines');
    expect(guidance).not.toContain(
      'Review your output against these quality standards before finalizing your response.'
    );
    expect(guidance).toContain(
      "Attest reminders in the verdict's `reminders` field; checks are recorded by the engine."
    );
  });
});

/**
 * B13, the render half. The renderer re-runs activation per gate, so an artifact-scoped gate the
 * resolver selected at rank 20 would be dropped here if the render context did not carry the same
 * artifact list — the gate would attach to the run and render nothing, which is the silent
 * failure shape B13 exists to remove.
 */
describe('GateGuidanceRenderer — B13 artifacts reach the activation check', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const artifactGate = {
    id: 'test-coverage',
    name: 'Test Coverage Gate',
    type: 'guidance',
    description: '',
    guidance: '- Cover the new branch',
    activation: { artifacts: ['test'] },
  };

  test('the declared artifacts are forwarded onto the activation context, and the gate renders', async () => {
    const loader = createMockLoader();
    (loader.loadGate as jest.Mock).mockResolvedValue(artifactGate as never);
    (loader.isGateActive as jest.Mock).mockImplementation((_gate: unknown, context: any) =>
      (context.artifacts ?? []).includes('test')
    );

    const renderer = new GateGuidanceRenderer(logger as any, { gateLoader: loader as any });
    const guidance = await renderer.renderGuidance(['test-coverage'], {
      category: 'development',
      artifacts: ['test', 'readme'],
    });

    expect((loader.isGateActive as jest.Mock).mock.calls[0]?.[1]).toMatchObject({
      promptCategory: 'development',
      artifacts: ['test', 'readme'],
    });
    expect(guidance).toContain('Test Coverage Gate');
  });

  test('positive control: the same gate with no artifacts in the render context renders nothing', async () => {
    const loader = createMockLoader();
    (loader.loadGate as jest.Mock).mockResolvedValue(artifactGate as never);
    (loader.isGateActive as jest.Mock).mockImplementation((_gate: unknown, context: any) =>
      (context.artifacts ?? []).includes('test')
    );

    const renderer = new GateGuidanceRenderer(logger as any, { gateLoader: loader as any });
    const guidance = await renderer.renderGuidance(['test-coverage'], {
      category: 'development',
    });

    expect((loader.isGateActive as jest.Mock).mock.calls[0]?.[1]).not.toHaveProperty('artifacts');
    expect(guidance).not.toContain('Test Coverage Gate');
  });
});

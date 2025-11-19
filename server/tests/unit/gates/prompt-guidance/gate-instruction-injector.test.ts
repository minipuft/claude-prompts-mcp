import { describe, expect, test, jest, beforeEach } from '@jest/globals';

import { GateInstructionInjector } from '../../../../dist/frameworks/prompt-guidance/gate-instruction-injector.js';

import type { ConvertedPrompt } from '../../../../dist/types/index.js';

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const basePrompt: ConvertedPrompt = {
  id: 'prompt-',
  name: 'Test Prompt',
  description: 'Testing prompt',
  category: 'quality',
  userMessageTemplate: 'Original template body',
  arguments: [],
};

const createPrompt = (overrides: Partial<ConvertedPrompt> = {}): ConvertedPrompt => ({
  ...basePrompt,
  ...overrides,
});

describe('GateInstructionInjector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('appends rendered guidance without adding redundant footer', async () => {
    const renderer = {
      renderGuidance: jest.fn().mockResolvedValue('\n\n Guidance\n- Respect structure'),
    };

    const injector = new GateInstructionInjector(mockLogger as any, renderer as any);
    const result = await injector.injectGateInstructions(createPrompt(), ['quality.structure'], {
      framework: 'CAGEERF',
    });

    expect(renderer.renderGuidance).toHaveBeenCalledWith(['quality.structure'], {
      framework: 'CAGEERF',
      category: 'quality',
      promptId: 'prompt-',
    });
    expect(result.userMessageTemplate).toContain('Original template body');
    expect(result.userMessageTemplate).toContain(' Guidance');
    expect(result.gateInstructionsInjected).toBe(true);
    expect(result.injectedGateIds).toEqual(['quality.structure']);
  });

  test('returns prompt unchanged when renderer produces empty text', async () => {
    const renderer = {
      renderGuidance: jest.fn().mockResolvedValue(''),
    };

    const injector = new GateInstructionInjector(mockLogger as any, renderer as any);
    const prompt = createPrompt();
    const result = await injector.injectGateInstructions(prompt, ['inline_gate_']);

    expect(result).toBe(prompt);
    expect(result.gateInstructionsInjected).toBeUndefined();
  });

  test('skips injection when no gate ids provided', async () => {
    const renderer = {
      renderGuidance: jest.fn(),
    };

    const injector = new GateInstructionInjector(mockLogger as any, renderer as any);
    const prompt = createPrompt();
    const result = await injector.injectGateInstructions(prompt, []);

    expect(renderer.renderGuidance).not.toHaveBeenCalled();
    expect(result).toBe(prompt);
  });

  test('gracefully handles renderer errors and returns original prompt', async () => {
    const renderer = {
      renderGuidance: jest.fn().mockRejectedValue(new Error('boom')),
    };

    const injector = new GateInstructionInjector(mockLogger as any, renderer as any);
    const prompt = createPrompt();
    const result = await injector.injectGateInstructions(prompt, ['quality.structure']);

    expect(renderer.renderGuidance).toHaveBeenCalled();
    expect(result).toBe(prompt);
    expect(mockLogger.error).toHaveBeenCalled();
  });
});

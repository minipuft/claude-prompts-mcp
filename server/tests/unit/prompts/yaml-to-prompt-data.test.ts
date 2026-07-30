import { yamlToPromptData } from '../../../src/modules/prompts/yaml-prompt-loader';
import type { PromptYaml } from '../../../src/modules/prompts/prompt-schema';

function makeMinimalYaml(overrides: Partial<PromptYaml> = {}): PromptYaml {
  return {
    id: 'test_prompt',
    name: 'Test Prompt',
    description: 'A test prompt',
    arguments: [],
    ...overrides,
  } as PromptYaml;
}

describe('yamlToPromptData', () => {
  it('passes through simple fields', () => {
    const yaml = makeMinimalYaml({
      registerWithMcp: false,
      tools: ['csv_tool'],
      subagentModel: 'fast',
    });

    const result = yamlToPromptData(yaml);

    expect(result.id).toBe('test_prompt');
    expect(result.name).toBe('Test Prompt');
    expect(result.description).toBe('A test prompt');
    expect(result.registerWithMcp).toBe(false);
    expect(result.tools).toEqual(['csv_tool']);
    expect(result.subagentModel).toBe('fast');
  });

  it('defaults category to general', () => {
    const result = yamlToPromptData(makeMinimalYaml());
    expect(result.category).toBe('general');
  });

  it('preserves explicit category', () => {
    const result = yamlToPromptData(makeMinimalYaml({ category: 'workflow' }));
    expect(result.category).toBe('workflow');
  });

  it('computes file path for directory format', () => {
    const result = yamlToPromptData(makeMinimalYaml());
    expect(result.file).toBe('test_prompt/prompt.yaml');
  });

  it('uses filePath override for single-file format', () => {
    const result = yamlToPromptData(makeMinimalYaml(), 'test_prompt.yaml');
    expect(result.file).toBe('test_prompt.yaml');
  });

  it('normalizes arguments with required default', () => {
    const yaml = makeMinimalYaml({
      arguments: [
        { name: 'url', type: 'string', required: true, description: 'The URL' },
        { name: 'count', type: 'number', required: false },
      ],
    });

    const result = yamlToPromptData(yaml);

    expect(result.arguments).toHaveLength(2);
    expect(result.arguments[0]).toEqual({
      name: 'url',
      type: 'string',
      required: true,
      description: 'The URL',
    });
    expect(result.arguments[1]).toEqual({
      name: 'count',
      type: 'number',
      required: false,
    });
  });

  it('normalizes argument validation', () => {
    const yaml = makeMinimalYaml({
      arguments: [
        {
          name: 'url',
          type: 'string',
          required: false,
          validation: { pattern: '^https://', minLength: 5 },
        },
      ],
    });

    const result = yamlToPromptData(yaml);

    expect(result.arguments[0].validation).toEqual({
      pattern: '^https://',
      minLength: 5,
    });
  });

  it('normalizes chain steps with subagentModel', () => {
    const yaml = makeMinimalYaml({
      chainSteps: [
        { promptId: 'fetch', stepName: 'Fetch', retries: 2, subagentModel: 'fast' as const },
        { promptId: 'analyze', stepName: 'Analyze', subagentModel: 'heavy' as const },
      ],
    });

    const result = yamlToPromptData(yaml);

    expect(result.chainSteps).toHaveLength(2);
    expect(result.chainSteps![0]).toEqual({
      promptId: 'fetch',
      stepName: 'Fetch',
      retries: 2,
      subagentModel: 'fast',
    });
    expect(result.chainSteps![1]).toEqual({
      promptId: 'analyze',
      stepName: 'Analyze',
      subagentModel: 'heavy',
    });
  });

  it('normalizes gate configuration', () => {
    const yaml = makeMinimalYaml({
      gateConfiguration: {
        include: ['accuracy'],
        exclude: ['creative'],
        framework_gates: false,
      },
    });

    const result = yamlToPromptData(yaml);

    expect(result.gateConfiguration).toEqual({
      include: ['accuracy'],
      exclude: ['creative'],
      framework_gates: false,
    });
  });

  it('excludes YAML-only fields from output', () => {
    const yaml = makeMinimalYaml({
      systemMessageFile: 'system-message.md',
      userMessageTemplateFile: 'user-message.md',
      systemMessage: 'system prompt',
      userMessageTemplate: 'user template',
    });

    const result = yamlToPromptData(yaml);

    expect(result).not.toHaveProperty('systemMessageFile');
    expect(result).not.toHaveProperty('userMessageTemplateFile');
    expect(result).not.toHaveProperty('systemMessage');
    expect(result).not.toHaveProperty('userMessageTemplate');
  });

  it('automatically passes through new fields via spread', () => {
    // Simulates a future field addition — any field on PromptYaml that isn't
    // destructured out flows through without needing a loader change.
    const yaml = makeMinimalYaml();
    (yaml as Record<string, unknown>)['futureField'] = 'should-pass-through';

    const result = yamlToPromptData(yaml);

    expect((result as unknown as Record<string, unknown>)['futureField']).toBe(
      'should-pass-through'
    );
  });

  describe('injection block normalization', () => {
    it('normalizes a declared injection block onto PromptData', () => {
      const yaml = makeMinimalYaml({
        injection: {
          'system-prompt': { enabled: false },
          'style-guidance': { frequency: { mode: 'first-only' }, target: 'steps' },
        },
      });

      const result = yamlToPromptData(yaml);

      expect(result.injection).toEqual({
        'system-prompt': { enabled: false },
        'style-guidance': { frequency: { mode: 'first-only' }, target: 'steps' },
      });
    });

    it('preserves enabled: true rather than dropping it as falsy-adjacent', () => {
      const yaml = makeMinimalYaml({ injection: { 'gate-guidance': { enabled: true } } });

      const result = yamlToPromptData(yaml);

      expect(result.injection?.['gate-guidance']?.enabled).toBe(true);
    });

    it('normalizes an empty block to undefined so it cannot shadow the chain tier', () => {
      // A present-but-empty rule would register as a hierarchy match while contributing no
      // fields, silently suppressing the chain and category tiers below it.
      expect(yamlToPromptData(makeMinimalYaml({ injection: {} })).injection).toBeUndefined();
      expect(
        yamlToPromptData(makeMinimalYaml({ injection: { 'system-prompt': {} } })).injection
      ).toBeUndefined();
    });

    it('leaves injection undefined when the prompt declares none', () => {
      expect(yamlToPromptData(makeMinimalYaml()).injection).toBeUndefined();
    });

    it('does not let the raw YAML block bypass normalization via the passthrough spread', () => {
      // `injection` must be destructured out of the spread. If it were not, an all-empty block
      // would arrive as `{}` instead of undefined — normalized on one path, raw on the other.
      const yaml = makeMinimalYaml({ injection: { 'system-prompt': {} } });

      const result = yamlToPromptData(yaml);

      expect(result.injection).not.toEqual({ 'system-prompt': {} });
    });
  });
});

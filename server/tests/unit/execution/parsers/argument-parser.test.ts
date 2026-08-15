import { describe, expect, test, jest } from '@jest/globals';

import { ArgumentParser } from '../../../../src/engine/execution/parsers/argument-parser.js';

import type { ConvertedPrompt } from '../../../../src/shared/types/index.js';

const createLogger = () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
});

describe('ArgumentParser schema enforcement', () => {
  test('reports validation errors when schema validation fails', async () => {
    const parser = new ArgumentParser(createLogger());
    const promptData: ConvertedPrompt = {
      id: 'test',
      name: 'Test',
      description: '',
      category: 'general',
      userMessageTemplate: 'Hello {{iterations}}',
      arguments: [
        {
          name: 'iterations',
          required: true,
          type: 'number',
        },
      ],
    };

    const result = await parser.parseArguments('', promptData, {});
    expect(result.validationResults).toHaveLength(1);
    expect(result.validationResults[0].valid).toBe(false);
    expect(result.validationResults[0].errors?.[0]?.code).toBe('REQUIRED_ARGUMENT_MISSING');
  });
});

describe('ArgumentParser quoted-value escape handling', () => {
  const createPrompt = (): ConvertedPrompt => ({
    id: 'quote-test',
    name: 'Quote Test',
    description: '',
    category: 'general',
    userMessageTemplate: '{{theme}} {{mode}}',
    arguments: [
      { name: 'theme', required: false, type: 'string' },
      { name: 'mode', required: false, type: 'string' },
    ],
  });

  test('decodes escaped quotes inside a double-quoted value', async () => {
    const parser = new ArgumentParser(createLogger());
    const command = `theme:${JSON.stringify('it\'s a "test" value')} mode:"refine"`;

    const result = await parser.parseArguments(command, createPrompt(), {});

    expect(result.processedArgs.theme).toBe('it\'s a "test" value');
    expect(result.processedArgs.mode).toBe('refine');
  });

  test('does not emit arguments the prompt never declared', async () => {
    const parser = new ArgumentParser(createLogger());
    const command = `theme:${JSON.stringify('ground lifted. Target: dark ground.')}`;

    const result = await parser.parseArguments(command, createPrompt(), {});

    expect(result.processedArgs.theme).toBe('ground lifted. Target: dark ground.');
    expect(result.processedArgs).not.toHaveProperty('Target');
  });

  // Backwards-compat lock: commands written before the escape convention existed
  // contain no backslashes and must parse exactly as they did previously.
  test('legacy unescaped commands parse unchanged', async () => {
    const parser = new ArgumentParser(createLogger());

    const doubleQuoted = await parser.parseArguments(
      'theme:"a plain value" mode:"refine"',
      createPrompt(),
      {}
    );
    expect(doubleQuoted.processedArgs.theme).toBe('a plain value');
    expect(doubleQuoted.processedArgs.mode).toBe('refine');

    const singleQuoted = await parser.parseArguments(
      "theme:'a plain value' mode:'refine'",
      createPrompt(),
      {}
    );
    expect(singleQuoted.processedArgs.theme).toBe('a plain value');
    expect(singleQuoted.processedArgs.mode).toBe('refine');

    const unquoted = await parser.parseArguments('mode:refine', createPrompt(), {});
    expect(unquoted.processedArgs.mode).toBe('refine');
  });
});

describe('ArgumentParser multi-argument parsing', () => {
  const createMultiArgPrompt = (): ConvertedPrompt => ({
    id: 'multi-arg-test',
    name: 'Multi Arg Test',
    description: '',
    category: 'general',
    userMessageTemplate: '{{input}} {{data}} {{format}}',
    arguments: [
      { name: 'input', required: false },
      { name: 'data', required: false },
      { name: 'format', required: false },
    ],
  });

  test('parses multiple arguments with equals delimiter', async () => {
    const parser = new ArgumentParser(createLogger());
    const result = await parser.parseArguments(
      'input="value1" data="value2"',
      createMultiArgPrompt(),
      {}
    );
    expect(result.processedArgs.input).toBe('value1');
    expect(result.processedArgs.data).toBe('value2');
  });

  test('parses multiple arguments with colon delimiter', async () => {
    const parser = new ArgumentParser(createLogger());
    const result = await parser.parseArguments(
      'input:"value1" data:"value2"',
      createMultiArgPrompt(),
      {}
    );
    expect(result.processedArgs.input).toBe('value1');
    expect(result.processedArgs.data).toBe('value2');
  });

  test('parses mixed delimiter syntax', async () => {
    const parser = new ArgumentParser(createLogger());
    const result = await parser.parseArguments(
      'input="value1" format:"json"',
      createMultiArgPrompt(),
      {}
    );
    expect(result.processedArgs.input).toBe('value1');
    expect(result.processedArgs.format).toBe('json');
  });

  test('parses three or more arguments', async () => {
    const parser = new ArgumentParser(createLogger());
    const result = await parser.parseArguments(
      'input:"first" data:"second" format:"third"',
      createMultiArgPrompt(),
      {}
    );
    expect(result.processedArgs.input).toBe('first');
    expect(result.processedArgs.data).toBe('second');
    expect(result.processedArgs.format).toBe('third');
  });

  test('handles single-quoted values with colon delimiter', async () => {
    const parser = new ArgumentParser(createLogger());
    const result = await parser.parseArguments(
      "input:'Quarterly metrics' data:'Sales report'",
      createMultiArgPrompt(),
      {}
    );
    expect(result.processedArgs.input).toBe('Quarterly metrics');
    expect(result.processedArgs.data).toBe('Sales report');
  });

  test('handles values with special characters', async () => {
    const parser = new ArgumentParser(createLogger());
    const result = await parser.parseArguments(
      'input:"/home/user/file.ts" data:"https://example.com?param=value"',
      createMultiArgPrompt(),
      {}
    );
    expect(result.processedArgs.input).toBe('/home/user/file.ts');
    expect(result.processedArgs.data).toBe('https://example.com?param=value');
  });
});

describe('ArgumentParser dashed argument names', () => {
  const createDashedPrompt = (): ConvertedPrompt => ({
    id: 'dashed-test',
    name: 'Dashed Test',
    description: '',
    category: 'general',
    userMessageTemplate: '{{output-format}} {{file-path}}',
    arguments: [
      { name: 'output-format', required: false },
      { name: 'file-path', required: false },
    ],
  });

  test('parses argument names with dashes', async () => {
    const parser = new ArgumentParser(createLogger());
    const result = await parser.parseArguments(
      'output-format:"json" file-path:"/src/main.ts"',
      createDashedPrompt(),
      {}
    );
    expect(result.processedArgs['output-format']).toBe('json');
    expect(result.processedArgs['file-path']).toBe('/src/main.ts');
  });

  test('parses dashed names with equals delimiter', async () => {
    const parser = new ArgumentParser(createLogger());
    const result = await parser.parseArguments('output-format="xml"', createDashedPrompt(), {});
    expect(result.processedArgs['output-format']).toBe('xml');
  });
});

// Routing freeform text to a declared argument is the behavior that makes
// `>>initial_scan some topic` work at all — without it the text is parsed as
// nothing and every argument falls back to a default. It had no direct coverage:
// every other case in this file supplies `key:"value"` pairs.
describe('ArgumentParser freeform text routing', () => {
  const createPrompt = (args: ConvertedPrompt['arguments']): ConvertedPrompt => ({
    id: 'freeform-test',
    name: 'Freeform Test',
    description: '',
    category: 'general',
    userMessageTemplate: '{{topic}}',
    arguments: args,
  });

  test('routes freeform text to the sole declared argument', async () => {
    const parser = new ArgumentParser(createLogger());
    const prompt = createPrompt([{ name: 'topic', required: true, type: 'string' }]);

    const result = await parser.parseArguments('quote-aware operator parsing', prompt, {});

    expect(result.processedArgs.topic).toBe('quote-aware operator parsing');
    expect(result.metadata.contextSources.topic).toBe('user_provided');
  });

  // Priority is "first REQUIRED argument", not "first argument" — an optional
  // argument declared ahead of the required one must not capture the text.
  test('prefers the first required argument over an earlier optional one', async () => {
    const parser = new ArgumentParser(createLogger());
    const prompt = createPrompt([
      { name: 'purpose', required: false, type: 'string' },
      { name: 'topic', required: true, type: 'string' },
      { name: 'constraints', required: false, type: 'string' },
    ]);

    const result = await parser.parseArguments('MCP command parsers', prompt, {});

    expect(result.processedArgs.topic).toBe('MCP command parsers');
    expect(result.metadata.contextSources.topic).toBe('user_provided');
    expect(result.processedArgs.purpose).not.toBe('MCP command parsers');
  });

  test('falls back to the first argument when none are required', async () => {
    const parser = new ArgumentParser(createLogger());
    const prompt = createPrompt([
      { name: 'topic', required: false, type: 'string' },
      { name: 'purpose', required: false, type: 'string' },
    ]);

    const result = await parser.parseArguments('no required args here', prompt, {});

    expect(result.processedArgs.topic).toBe('no required args here');
    expect(result.metadata.contextSources.topic).toBe('user_provided');
  });

  test('leaves the remaining arguments defaulted rather than unset', async () => {
    const parser = new ArgumentParser(createLogger());
    const prompt = createPrompt([
      { name: 'topic', required: true, type: 'string' },
      { name: 'purpose', required: false, type: 'string' },
    ]);

    const result = await parser.parseArguments('a topic', prompt, {});

    expect(result.processedArgs.topic).toBe('a topic');
    expect(result.processedArgs).toHaveProperty('purpose');
  });
});

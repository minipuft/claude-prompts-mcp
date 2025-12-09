import { describe, expect, test, jest } from '@jest/globals';

import { ArgumentParser } from '../../../../dist/execution/parsers/argument-parser.js';

import type { ConvertedPrompt } from '../../../../dist/types/index.js';

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

import { describe, expect, test } from '@jest/globals';

import {
  detectToolRoutingCommand,
  type ToolRoutingResult,
} from '../../../dist/mcp-tools/prompt-engine/utils/tool-routing.js';

function route(command: string): ToolRoutingResult {
  return detectToolRoutingCommand(command);
}

describe('tool routing detection', () => {
  test('routes listprompts variations to prompt_manager with optional filters', () => {
    // Bug fix regression test: >>listprompts without trailing space should not include search_query
    const bareCommand = route('>>listprompts');
    expect(bareCommand.targetTool).toBe('prompt_manager');
    expect(bareCommand.translatedParams).toEqual({
      action: 'list',
    });

    // With search filter
    expect(route('/listprompts category:analysis').translatedParams).toEqual({
      action: 'list',
      search_query: 'category:analysis',
    });

    // Trailing whitespace should also not create search_query
    expect(route('listprompts  ').translatedParams).toEqual({
      action: 'list',
    });
  });

  test('routes guide command to prompt engine metadata helper', () => {
    const result = route('>>guide gate controls');
    expect(result).toMatchObject({
      requiresRouting: true,
      targetTool: 'prompt_engine_guide',
      translatedParams: { goal: 'gate controls' },
    });
  });

  test('routes help and status commands to system_control', () => {
    expect(route('>>help frameworks').translatedParams).toEqual({
      action: 'guide',
      topic: 'frameworks',
    });
    expect(route('status').translatedParams).toEqual({
      action: 'status',
    });
  });

  test('routes framework switch commands with extracted framework name', () => {
    const result = route('framework switch CAGEERF');
    expect(result.requiresRouting).toBe(true);
    expect(result.targetTool).toBe('system_control');
    expect(result.translatedParams).toEqual({
      action: 'framework',
      operation: 'switch',
      framework: 'CAGEERF',
    });
  });

  test('routes analytics commands to system_control', () => {
    const result = route('>>analytics');
    expect(result.requiresRouting).toBe(true);
    expect(result.targetTool).toBe('system_control');
    expect(result.translatedParams).toEqual({ action: 'analytics' });
  });

  test('rejects leading >> without a plausible prompt id', () => {
    // ">> " followed by nothing is rejected
    const emptyResult = route('>> ');
    expect(emptyResult.requiresRouting).toBe(true);
    expect(emptyResult.targetTool).toBe('prompt_engine_invalid_command');

    // ">> 123invalid" (starts with digit then invalid char) is rejected
    const invalidResult = route('>> !@#$');
    expect(invalidResult.requiresRouting).toBe(true);
    expect(invalidResult.targetTool).toBe('prompt_engine_invalid_command');

    // ">> what is mcp?" passes because "what" is a plausible prompt id
    const plausibleResult = route('>> what is mcp?');
    expect(plausibleResult.requiresRouting).toBe(false);
  });

  test('returns passthrough result when no routing is required', () => {
    expect(route('>>write_proposal topic="AI"').requiresRouting).toBe(false);
  });
});

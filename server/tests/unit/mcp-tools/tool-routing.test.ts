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
    expect(route('>>listprompts').targetTool).toBe('prompt_manager');
    expect(route('/listprompts category:analysis').translatedParams).toEqual({
      action: 'list',
      search_query: 'category:analysis',
    });
    expect(route('listprompts  ')).toMatchObject({
      requiresRouting: true,
      targetTool: 'prompt_manager',
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

  test('returns passthrough result when no routing is required', () => {
    expect(route('>>write_proposal topic="AI"').requiresRouting).toBe(false);
  });
});

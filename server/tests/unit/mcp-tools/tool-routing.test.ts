import { describe, expect, test } from '@jest/globals';

import {
  detectToolRoutingCommand,
  type RoutedToolCall,
} from '../../../src/mcp/tools/prompt-engine/utils/tool-routing.js';

/**
 * Routes a command and asserts it required routing, narrowing the result to `RoutedToolCall` so
 * `targetTool`/`translatedParams` are readable without an inline guard per call site.
 *
 * `ToolRoutingResult` is a discriminated union on `requiresRouting` since row B.61 — the same
 * change that lets `PromptExecutor.routeToTool` narrow `translatedParams` off `targetTool` also
 * means the `{ requiresRouting: false }` variant carries neither field, so a caller has to check
 * the tag before reading them, exactly like `RequestNormalizationStage.tryRouteCommand` does.
 */
function route(command: string): RoutedToolCall {
  const result = detectToolRoutingCommand(command);
  if (!result.requiresRouting) {
    throw new Error(`expected "${command}" to require routing`);
  }
  return result;
}

describe('tool routing detection', () => {
  test('routes listprompts variations to resource_manager prompt list with optional filters', () => {
    // Bug fix regression test: >>listprompts without trailing space should not include search_query
    const bareCommand = route('>>listprompts');
    expect(bareCommand.targetTool).toBe('resource_manager');
    expect(bareCommand.translatedParams).toEqual({
      resource_type: 'prompt',
      action: 'list',
    });

    // With search filter
    expect(route('/listprompts category:analysis').translatedParams).toEqual({
      resource_type: 'prompt',
      action: 'list',
      search_query: 'category:analysis',
    });

    // Trailing whitespace should also not create search_query
    expect(route('listprompts  ').translatedParams).toEqual({
      resource_type: 'prompt',
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

    // ">> what is mcp?" passes because "what" is a plausible prompt id — not routed, so read
    // straight off `detectToolRoutingCommand` rather than the throwing `route()` helper.
    const plausibleResult = detectToolRoutingCommand('>> what is mcp?');
    expect(plausibleResult.requiresRouting).toBe(false);
  });

  test('returns passthrough result when no routing is required', () => {
    expect(detectToolRoutingCommand('>>write_proposal topic="AI"').requiresRouting).toBe(false);
  });
});

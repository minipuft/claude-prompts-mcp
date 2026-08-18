import { describe, expect, test } from '@jest/globals';

import { DelegationRenderer } from '../../../src/engine/execution/delegation/renderer.js';
import {
  ClaudeCodeStrategy,
  CodexStrategy,
  CursorStrategy,
  GeminiStrategy,
  NeutralStrategy,
  OpenCodeStrategy,
  getHandoffFooterInstruction,
  getHandoffFooterPrefix,
  getHandoffProfileStatus,
  resolveDelegationStrategy,
} from '../../../src/engine/execution/delegation/strategy.js';

import type { DelegationPayload } from '../../../src/engine/execution/delegation/types.js';
import type { DelegationStrategy } from '../../../src/engine/execution/delegation/strategy.js';

/**
 * R-1/S7 retarget (2026-08-18): `render()` and the ExecutionEnvelope were the retired handoff
 * path (envelope content now travels in the operator-rendered EXECUTION BRIEF). These tests
 * exercise the two surviving render modes: the current-step handoff that points at the brief,
 * and the next-step one-line advisory.
 */
describe('DelegationRenderer', () => {
  const basePayload: DelegationPayload = {
    stepNumber: 2,
    totalSteps: 3,
    promptName: 'research',
    agentType: 'chain-executor',
    gateCount: 0,
    hasGates: false,
  };

  test('current-step handoff renders header, instructions, and the brief pointer', () => {
    const renderer = new DelegationRenderer();
    const result = renderer.renderCurrentStepHandoff(basePayload);

    expect(result).toContain('HANDOFF: Execute Step 2 ("research")');
    expect(result).toContain('subagent_type: "claude-prompts:chain-executor"');
    expect(result).toContain('HANDOFF INSTRUCTIONS');
    expect(result).toContain('Pass the EXECUTION BRIEF above');
    expect(result).not.toContain('Pass ALL content above');
    expect(result).toContain('CONSTRAINT');
    expect(result).toContain('BLOCKED');
  });

  test('includes model from strategy in tool call', () => {
    const renderer = new DelegationRenderer();
    const result = renderer.renderCurrentStepHandoff({ ...basePayload, subagentModel: 'heavy' });

    expect(result).toContain('model: "opus"');
  });

  test('subagentModel fast renders model haiku in the handoff', () => {
    const renderer = new DelegationRenderer();
    const result = renderer.renderCurrentStepHandoff({ ...basePayload, subagentModel: 'fast' });

    expect(result).toContain('model: "haiku"');
    expect(result).not.toContain('model: "sonnet"');
    expect(result).not.toContain('model: "opus"');
  });

  test('verdict review line renders only when the brief carries gates (R-2)', () => {
    const renderer = new DelegationRenderer();
    const gated = renderer.renderCurrentStepHandoff({
      ...basePayload,
      gateCount: 2,
      hasGates: true,
    });
    const ungated = renderer.renderCurrentStepHandoff(basePayload);

    expect(gated).toContain('Proposed Gate Review');
    expect(gated).toContain('INPUT to your gate_verdict');
    expect(ungated).not.toContain('Proposed Gate Review');
  });

  test('ratified gate_verdict hint renders when gateGuidanceEnabled and hasGates', () => {
    const renderer = new DelegationRenderer();
    const result = renderer.renderCurrentStepHandoff(
      { ...basePayload, gateCount: 1, hasGates: true },
      { gateGuidanceEnabled: true, frameworkInjectionEnabled: false }
    );

    expect(result).toContain('ratified gate_verdict');
  });

  test('selects codex strategy from payload client profile', () => {
    const renderer = new DelegationRenderer();
    const result = renderer.renderCurrentStepHandoff({
      ...basePayload,
      clientProfile: {
        clientFamily: 'codex',
        clientId: 'codex-cli',
        clientVersion: '1.0.0',
        delegationProfile: 'spawn_agent_v1',
      },
    });

    expect(result).toContain('Tool: spawn_agent');
    expect(result).not.toContain('Tool: Task');
  });

  test('selects neutral strategy from payload client profile', () => {
    const renderer = new DelegationRenderer();
    const result = renderer.renderCurrentStepHandoff({
      ...basePayload,
      clientProfile: {
        clientFamily: 'unknown',
        clientId: 'mystery-client',
        clientVersion: 'unknown',
        delegationProfile: 'neutral_v1',
      },
    });

    expect(result).toContain('Handoff: Use your client');
    expect(result).not.toContain('Tool: Task');
  });

  test('next-step advisory is one line naming the delegated step, never instructions', () => {
    const renderer = new DelegationRenderer();
    const result = renderer.renderNextStepAdvisory(basePayload);

    expect(result).toContain('Note: Step 2 ("research")');
    expect(result).toContain('EXECUTION BRIEF');
    expect(result).not.toContain('HANDOFF INSTRUCTIONS');
    expect(result.split('\n')).toHaveLength(1);
  });
});

const basePayloadForStrategy: DelegationPayload = {
  stepNumber: 2,
  totalSteps: 3,
  promptName: 'research',
  agentType: 'chain-executor',
  gateCount: 0,
  hasGates: false,
};

describe('ClaudeCodeStrategy', () => {
  const strategy = new ClaudeCodeStrategy();

  test('resolves heavy to opus', () => {
    const payload: DelegationPayload = {
      stepNumber: 2,
      totalSteps: 3,
      promptName: 'test',
      agentType: 'chain-executor',
      subagentModel: 'heavy',
      gateCount: 0,
      hasGates: false,
    };
    expect(strategy.resolveModel(payload)).toBe('opus');
  });

  test('resolves standard to sonnet', () => {
    const payload: DelegationPayload = {
      stepNumber: 2,
      totalSteps: 3,
      promptName: 'test',
      agentType: 'chain-executor',
      subagentModel: 'standard',
      gateCount: 0,
      hasGates: false,
    };
    expect(strategy.resolveModel(payload)).toBe('sonnet');
  });

  test('resolves fast to haiku', () => {
    const payload: DelegationPayload = {
      stepNumber: 2,
      totalSteps: 3,
      promptName: 'test',
      agentType: 'chain-executor',
      subagentModel: 'fast',
      gateCount: 0,
      hasGates: false,
    };
    expect(strategy.resolveModel(payload)).toBe('haiku');
  });

  test('falls back to opus when gateCount >= 3', () => {
    const payload: DelegationPayload = {
      stepNumber: 2,
      totalSteps: 3,
      promptName: 'test',
      agentType: 'chain-executor',
      gateCount: 3,
      hasGates: true,
    };
    expect(strategy.resolveModel(payload)).toBe('opus');
  });

  test('defaults to sonnet without capability hint or high gate count', () => {
    const payload: DelegationPayload = {
      stepNumber: 2,
      totalSteps: 3,
      promptName: 'test',
      agentType: 'chain-executor',
      gateCount: 1,
      hasGates: true,
    };
    expect(strategy.resolveModel(payload)).toBe('sonnet');
  });

  test('formatToolCall namespaces bare agent type', () => {
    const result = strategy.formatToolCall('chain-executor', 'sonnet');
    expect(result).toContain('Tool: Task');
    expect(result).toContain('subagent_type: "claude-prompts:chain-executor"');
    expect(result).toContain('model: "sonnet"');
  });

  test('formatToolCall preserves already-namespaced agent type', () => {
    const result = strategy.formatToolCall('custom-plugin:my-agent', 'sonnet');
    expect(result).toContain('subagent_type: "custom-plugin:my-agent"');
  });

  test('formatToolCall omits model when undefined', () => {
    const result = strategy.formatToolCall('chain-executor', undefined);
    expect(result).toContain('subagent_type: "claude-prompts:chain-executor"');
    expect(result).not.toContain('model:');
  });

  test('accepts custom pluginNamespace', () => {
    const customStrategy = new ClaudeCodeStrategy('my-plugin');
    const result = customStrategy.formatToolCall('chain-executor', undefined);
    expect(result).toContain('subagent_type: "my-plugin:chain-executor"');
  });

  test('formatConstraints includes DO NOT and BLOCKED warnings', () => {
    const result = strategy.formatConstraints();
    expect(result).toContain('DO NOT');
    expect(result).toContain('BLOCKED');
  });

  test('accepts custom strategy via constructor', () => {
    const customStrategy: DelegationStrategy = {
      clientId: 'test-client',
      resolveModel: () => 'custom-model',
      formatToolCall: (agentType, model) => `custom: ${agentType} ${model}`,
      formatConstraints: () => 'custom constraints',
    };
    const renderer = new DelegationRenderer(customStrategy);
    const result = renderer.renderCurrentStepHandoff(basePayloadForStrategy); // (S7) render() retired with the envelope path

    expect(result).toContain('custom: chain-executor custom-model');
    expect(result).toContain('custom constraints');
  });
});

describe('additional delegation strategies', () => {
  test('CodexStrategy formats spawn_agent call', () => {
    const strategy = new CodexStrategy();
    const result = strategy.formatToolCall('worker', 'codex-standard');
    expect(result).toContain('Tool: spawn_agent (preferred)');
    expect(result).toContain('agent_type: "worker"');
  });

  test('CodexStrategy includes fallback guidance when spawn_agent is unavailable', () => {
    const strategy = new CodexStrategy();
    const result = strategy.formatConstraints();
    expect(result).toContain('FALLBACK');
    expect(result).toContain('spawn_agent is unavailable');
  });

  test('NeutralStrategy omits fixed tool name and model', () => {
    const strategy = new NeutralStrategy();
    const result = strategy.formatToolCall('worker', undefined);
    expect(result).toContain('Handoff: Use your client');
    expect(result).toContain('agent_type: "worker"');
  });

  test('GeminiStrategy renders Gemini-specific delegation guidance', () => {
    const strategy = new GeminiStrategy();
    const result = strategy.formatToolCall('worker', undefined);
    expect(result).toContain("Gemini's sub-agent/handoff");
    expect(result).toContain('agent_type: "worker"');
  });

  test('OpenCodeStrategy renders OpenCode-specific delegation guidance', () => {
    const strategy = new OpenCodeStrategy();
    const result = strategy.formatToolCall('worker', undefined);
    expect(result).toContain("OpenCode's agent");
    expect(result).toContain('Handoff:');
    expect(result).toContain('agent_type: "worker"');
  });

  test('CursorStrategy renders Cursor-specific delegation guidance', () => {
    const strategy = new CursorStrategy();
    const result = strategy.formatToolCall('worker', undefined);
    expect(result).toContain("Cursor's agent");
    expect(result).toContain('Handoff (experimental/testing)');
    expect(result).toContain('experimental/testing');
    expect(result).toContain('agent_type: "worker"');
  });

  test('delegation profile metadata reports footer prefixes + experimental cursor status', () => {
    expect(getHandoffFooterPrefix('spawn_agent_v1')).toContain('Codex agent capability');
    expect(getHandoffFooterInstruction('spawn_agent_v1')).toContain('Codex agent capability');
    expect(getHandoffProfileStatus('spawn_agent_v1')).toBe('canonical');
    expect(getHandoffFooterPrefix('cursor_agent_v1')).toBe('Handoff via Cursor agent capability');
    expect(getHandoffFooterInstruction('cursor_agent_v1')).toContain('experimental/testing');
    expect(getHandoffProfileStatus('cursor_agent_v1')).toBe('experimental');
  });

  test('resolveDelegationStrategy routes by delegation profile', () => {
    expect(
      resolveDelegationStrategy({
        clientFamily: 'claude-code',
        clientId: 'claude-code',
        clientVersion: '1.0.0',
        delegationProfile: 'task_tool_v1',
      }).clientId
    ).toBe('claude-code');
    expect(
      resolveDelegationStrategy({
        clientFamily: 'codex',
        clientId: 'codex',
        clientVersion: '1.0.0',
        delegationProfile: 'spawn_agent_v1',
      }).clientId
    ).toBe('codex');
    expect(
      resolveDelegationStrategy({
        clientFamily: 'gemini',
        clientId: 'gemini',
        clientVersion: '1.0.0',
        delegationProfile: 'gemini_subagent_v1',
      }).clientId
    ).toBe('gemini');
    expect(
      resolveDelegationStrategy({
        clientFamily: 'opencode',
        clientId: 'opencode',
        clientVersion: '1.0.0',
        delegationProfile: 'opencode_agent_v1',
      }).clientId
    ).toBe('opencode');
    expect(
      resolveDelegationStrategy({
        clientFamily: 'cursor',
        clientId: 'cursor',
        clientVersion: '1.0.0',
        delegationProfile: 'cursor_agent_v1',
      }).clientId
    ).toBe('cursor');
    expect(
      resolveDelegationStrategy({
        clientFamily: 'unknown',
        clientId: 'unknown',
        clientVersion: 'unknown',
        delegationProfile: 'neutral_v1',
      }).clientId
    ).toBe('unknown');
  });
});

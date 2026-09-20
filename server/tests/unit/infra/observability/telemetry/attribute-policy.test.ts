import { describe, expect, test } from '@jest/globals';

import {
  AttributePolicyEnforcer,
  redactAttributes,
} from '../../../../../src/infra/observability/telemetry/attribute-policy.js';
import type { TelemetryAttributePolicy } from '../../../../../src/shared/types/index.js';

const defaultPolicy: TelemetryAttributePolicy = {
  businessContext: true,
  rawCommands: false,
  rawResponses: false,
};

describe('AttributePolicyEnforcer', () => {
  describe('excluded attributes (always blocked)', () => {
    const enforcer = new AttributePolicyEnforcer(defaultPolicy);

    test('blocks raw command text', () => {
      const result = enforcer.sanitize({ 'cpm.command.raw': 'secret command' });
      expect(result).not.toHaveProperty('cpm.command.raw');
    });

    test('blocks raw user response', () => {
      const result = enforcer.sanitize({ 'cpm.user_response.raw': 'user said something' });
      expect(result).not.toHaveProperty('cpm.user_response.raw');
    });

    test('blocks prompt body', () => {
      const result = enforcer.sanitize({ 'cpm.prompt.body': 'template content' });
      expect(result).not.toHaveProperty('cpm.prompt.body');
    });

    test('blocks rendered prompt', () => {
      const result = enforcer.sanitize({ 'cpm.prompt.rendered': 'rendered content' });
      expect(result).not.toHaveProperty('cpm.prompt.rendered');
    });

    test('blocks model output', () => {
      const result = enforcer.sanitize({ 'cpm.model.output': 'model response' });
      expect(result).not.toHaveProperty('cpm.model.output');
    });

    test('blocks template body', () => {
      const result = enforcer.sanitize({ 'cpm.template.body': 'template' });
      expect(result).not.toHaveProperty('cpm.template.body');
    });
  });

  describe('safe business-context attributes', () => {
    test('allows safe attributes when businessContext is true', () => {
      const enforcer = new AttributePolicyEnforcer({ ...defaultPolicy, businessContext: true });
      const result = enforcer.sanitize({
        'cpm.prompt.id': 'my-prompt',
        'cpm.execution.mode': 'single',
        'cpm.command.type': 'execute',
        'cpm.framework.id': 'cageerf',
        'cpm.framework.enabled': true,
        'cpm.gates.applied_count': 3,
        'cpm.chain.current_step': 2,
        'cpm.chain.total_steps': 5,
        'cpm.operator.types': 'chain,gate',
        'cpm.gates.temporary_count': 1,
        'cpm.scope.continuity_source': 'workspace',
      });

      expect(result['cpm.prompt.id']).toBe('my-prompt');
      expect(result['cpm.execution.mode']).toBe('single');
      expect(result['cpm.command.type']).toBe('execute');
      expect(result['cpm.framework.id']).toBe('cageerf');
      expect(result['cpm.framework.enabled']).toBe(true);
      expect(result['cpm.gates.applied_count']).toBe(3);
      expect(result['cpm.chain.current_step']).toBe(2);
      expect(result['cpm.chain.total_steps']).toBe(5);
      expect(result['cpm.scope.continuity_source']).toBe('workspace');
    });

    test('drops safe attributes when businessContext is false', () => {
      const enforcer = new AttributePolicyEnforcer({ ...defaultPolicy, businessContext: false });
      const result = enforcer.sanitize({
        'cpm.prompt.id': 'my-prompt',
        'cpm.execution.mode': 'single',
      });

      expect(result).not.toHaveProperty('cpm.prompt.id');
      expect(result).not.toHaveProperty('cpm.execution.mode');
    });
  });

  describe('raw data opt-in', () => {
    test('blocks raw commands by default', () => {
      const enforcer = new AttributePolicyEnforcer(defaultPolicy);
      const result = enforcer.sanitize({ 'cpm.command.raw': 'secret' });
      expect(result).not.toHaveProperty('cpm.command.raw');
    });

    test('allows raw commands when explicitly enabled', () => {
      const enforcer = new AttributePolicyEnforcer({ ...defaultPolicy, rawCommands: true });
      const result = enforcer.sanitize({ 'cpm.command.raw': 'my command' });
      expect(result['cpm.command.raw']).toBe('my command');
    });

    test('blocks raw responses by default', () => {
      const enforcer = new AttributePolicyEnforcer(defaultPolicy);
      const result = enforcer.sanitize({ 'cpm.user_response.raw': 'user input' });
      expect(result).not.toHaveProperty('cpm.user_response.raw');
    });

    test('allows raw responses when explicitly enabled', () => {
      const enforcer = new AttributePolicyEnforcer({ ...defaultPolicy, rawResponses: true });
      const result = enforcer.sanitize({ 'cpm.user_response.raw': 'user input' });
      expect(result['cpm.user_response.raw']).toBe('user input');
    });
  });

  describe('custom allowlist', () => {
    test('allows custom attributes via allowlist', () => {
      const enforcer = new AttributePolicyEnforcer({
        ...defaultPolicy,
        allowlist: ['cpm.custom.field'],
      });
      const result = enforcer.sanitize({ 'cpm.custom.field': 'custom-value' });
      expect(result['cpm.custom.field']).toBe('custom-value');
    });

    test('allowlist overrides businessContext=false for listed keys', () => {
      const enforcer = new AttributePolicyEnforcer({
        businessContext: false,
        rawCommands: false,
        rawResponses: false,
        allowlist: ['cpm.prompt.id'],
      });
      const result = enforcer.sanitize({
        'cpm.prompt.id': 'allowed-by-list',
        'cpm.execution.mode': 'blocked-by-flag',
      });
      expect(result['cpm.prompt.id']).toBe('allowed-by-list');
      expect(result).not.toHaveProperty('cpm.execution.mode');
    });
  });

  describe('non-cpm attributes pass through', () => {
    test('allows OTel semantic convention attributes', () => {
      const enforcer = new AttributePolicyEnforcer(defaultPolicy);
      const result = enforcer.sanitize({
        'http.method': 'POST',
        'rpc.system': 'mcp',
        'service.name': 'test',
      });
      expect(result['http.method']).toBe('POST');
      expect(result['rpc.system']).toBe('mcp');
      expect(result['service.name']).toBe('test');
    });
  });

  describe('unknown cpm.* attributes dropped', () => {
    test('drops unknown cpm attributes not in safe list or allowlist', () => {
      const enforcer = new AttributePolicyEnforcer(defaultPolicy);
      const result = enforcer.sanitize({
        'cpm.unknown.field': 'unknown',
        'cpm.prompt.id': 'known',
      });
      expect(result).not.toHaveProperty('cpm.unknown.field');
      expect(result['cpm.prompt.id']).toBe('known');
    });
  });

  describe('value coercion', () => {
    const enforcer = new AttributePolicyEnforcer(defaultPolicy);

    test('handles null and undefined values', () => {
      const result = enforcer.sanitize({
        'cpm.prompt.id': null,
        'cpm.execution.mode': undefined,
      });
      expect(result).not.toHaveProperty('cpm.prompt.id');
      expect(result).not.toHaveProperty('cpm.execution.mode');
    });

    test('coerces objects to strings', () => {
      const result = enforcer.sanitize({ 'service.name': { nested: 'object' } });
      expect(typeof result['service.name']).toBe('string');
    });

    test('passes arrays of primitives through', () => {
      const result = enforcer.sanitize({ 'service.tags': ['a', 'b', 'c'] });
      expect(result['service.tags']).toEqual(['a', 'b', 'c']);
    });
  });

  describe('isAllowed', () => {
    const enforcer = new AttributePolicyEnforcer(defaultPolicy);

    test('returns true for allowed safe attribute', () => {
      expect(enforcer.isAllowed('cpm.prompt.id')).toBe(true);
    });

    test('returns false for excluded attribute', () => {
      expect(enforcer.isAllowed('cpm.prompt.body')).toBe(false);
    });

    test('returns true for non-cpm attribute', () => {
      expect(enforcer.isAllowed('http.method')).toBe(true);
    });

    test('returns false for unknown cpm attribute', () => {
      expect(enforcer.isAllowed('cpm.unknown')).toBe(false);
    });
  });

  describe('wide-event enrichment attributes', () => {
    const enforcer = new AttributePolicyEnforcer(defaultPolicy);

    test('allows all wide-event performance attributes', () => {
      const result = enforcer.sanitize({
        'cpm.stages.executed_count': 19,
        'cpm.stages.skipped': 'script,shell-verify',
        'cpm.stages.slowest': 'StepExecution',
        'cpm.stages.slowest_ms': 312,
        'cpm.duration.total_ms': 847,
        'cpm.had_early_exit': false,
      });

      expect(result['cpm.stages.executed_count']).toBe(19);
      expect(result['cpm.stages.skipped']).toBe('script,shell-verify');
      expect(result['cpm.stages.slowest']).toBe('StepExecution');
      expect(result['cpm.stages.slowest_ms']).toBe(312);
      expect(result['cpm.duration.total_ms']).toBe(847);
      expect(result['cpm.had_early_exit']).toBe(false);
    });

    test('allows all wide-event gate attributes', () => {
      const result = enforcer.sanitize({
        'cpm.gates.names': 'quality,safety',
        'cpm.gates.passed_count': 2,
        'cpm.gates.failed_count': 0,
        'cpm.gates.blocked': false,
        'cpm.gates.retry_exhausted': false,
        'cpm.gates.enforcement_mode': 'strict',
      });

      expect(result['cpm.gates.names']).toBe('quality,safety');
      expect(result['cpm.gates.passed_count']).toBe(2);
      expect(result['cpm.gates.failed_count']).toBe(0);
      expect(result['cpm.gates.blocked']).toBe(false);
      expect(result['cpm.gates.enforcement_mode']).toBe('strict');
    });

    test('allows chain, scope, and error attributes', () => {
      const result = enforcer.sanitize({
        'cpm.chain.is_chain': true,
        'cpm.chain.step_index': 3,
        'cpm.chain.id': 'chain-abc',
        'cpm.scope.source': 'workspace',
        'cpm.scope.continuity_source': 'header',
        'cpm.error.type': 'ValidationError',
      });

      expect(result['cpm.chain.is_chain']).toBe(true);
      expect(result['cpm.chain.step_index']).toBe(3);
      expect(result['cpm.chain.id']).toBe('chain-abc');
      expect(result['cpm.scope.source']).toBe('workspace');
      expect(result['cpm.scope.continuity_source']).toBe('header');
      expect(result['cpm.error.type']).toBe('ValidationError');
    });
  });
});

describe('redactAttributes', () => {
  test('replaces excluded attributes with [REDACTED]', () => {
    const result = redactAttributes({
      'cpm.prompt.body': 'secret template',
      'cpm.prompt.id': 'safe-id',
    });
    expect(result['cpm.prompt.body']).toBe('[REDACTED]');
    expect(result['cpm.prompt.id']).toBe('safe-id');
  });
});

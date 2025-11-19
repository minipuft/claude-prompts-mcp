import { describe, beforeEach, expect, test, jest } from '@jest/globals';

import { FrameworkValidator } from '../../../dist/frameworks/framework-validator.js';
import { FrameworkRegistry } from '../../../dist/frameworks/methodology/framework-registry.js';
import { ValidationError } from '../../../dist/utils/index.js';

import type { FrameworkDefinition } from '../../../dist/frameworks/types/index.js';
import type { Logger } from '../../../dist/logging/index.js';

describe('FrameworkValidator', () => {
  let validator: FrameworkValidator;
  let registry: FrameworkRegistry;
  let logger: Logger;

  const createDefinition = (
    id: string,
    overrides: Partial<FrameworkDefinition> = {}
  ): FrameworkDefinition => ({
    id,
    name: `${id} Framework`,
    description: 'test framework',
    systemPromptTemplate: 'Prompt',
    executionGuidelines: [],
    applicableTypes: [],
    priority: 1,
    enabled: true,
    ...overrides,
  });

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    registry = new FrameworkRegistry(logger, { defaultFrameworkId: 'CAGEERF' });
    registry.registerDefinition(createDefinition('CAGEERF'));
    registry.registerDefinition(createDefinition('REACT', { enabled: false }));

    validator = new FrameworkValidator(registry, logger);
  });

  test('validateAndNormalize returns normalized identifier and definition', () => {
    const result = validator.validateAndNormalize('cageerf');

    expect(result.normalizedId).toBe('CAGEERF');
    expect(result.definition.name).toBe('CAGEERF Framework');
  });

  test('validateAndNormalize enforces enabled requirement when requested', () => {
    expect(() => validator.validateAndNormalize('react', { requireEnabled: true })).toThrow(
      /is currently disabled/i
    );
  });

  test('validateAndNormalize throws ValidationError for unknown frameworks', () => {
    expect(() => validator.validateAndNormalize('unknown')).toThrow(ValidationError);
    expect(() => validator.validateAndNormalize('unknown')).toThrow(/not found/i);
  });

  test('exists reflects presence and enabled state', () => {
    expect(validator.exists('react')).toBe(true);
    expect(validator.exists('react', { enabledOnly: true })).toBe(false);
    expect(validator.exists('cageerf', { enabledOnly: true })).toBe(true);
  });

  test('tryNormalize returns null for missing or invalid identifiers', () => {
    expect(validator.tryNormalize('react')).toBe('REACT');
    expect(validator.tryNormalize('')).toBeNull();
    expect(validator.tryNormalize('unknown')).toBeNull();
  });
});

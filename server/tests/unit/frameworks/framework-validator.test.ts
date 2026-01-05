import { describe, beforeEach, expect, test, jest } from '@jest/globals';

import { FrameworkValidator } from '../../../dist/frameworks/framework-validator.js';
import { ValidationError } from '../../../dist/utils/index.js';

import type { FrameworkManager } from '../../../dist/frameworks/framework-manager.js';
import type { FrameworkDefinition } from '../../../dist/frameworks/types/index.js';
import type { Logger } from '../../../dist/logging/index.js';

describe('FrameworkValidator', () => {
  let validator: FrameworkValidator;
  let mockFrameworkManager: jest.Mocked<FrameworkManager>;
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

  const frameworks: Record<string, FrameworkDefinition> = {
    CAGEERF: createDefinition('CAGEERF'),
    REACT: createDefinition('REACT', { enabled: false }),
  };

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    // Create mock FrameworkManager with the methods FrameworkValidator uses
    mockFrameworkManager = {
      getFramework: jest.fn((id: string) => frameworks[id.toUpperCase()]),
      isFrameworkEnabled: jest.fn((id: string) => {
        const fw = frameworks[id.toUpperCase()];
        return fw?.enabled ?? false;
      }),
      getFrameworkIds: jest.fn((enabledOnly: boolean) => {
        const ids = Object.keys(frameworks);
        return enabledOnly ? ids.filter((id) => frameworks[id].enabled) : ids;
      }),
      validateIdentifier: jest.fn((id: string) => {
        const normalizedId = id.trim().toUpperCase();
        const framework = frameworks[normalizedId];
        if (framework) {
          return { valid: true, normalizedId: framework.id };
        }
        return {
          valid: false,
          error: `Framework '${id}' not found`,
          suggestions: Object.keys(frameworks),
        };
      }),
    } as unknown as jest.Mocked<FrameworkManager>;

    validator = new FrameworkValidator(mockFrameworkManager, logger);
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

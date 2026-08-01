/**
 * Integration test for category-aware gate selection.
 *
 * Tests that:
 * 1. selectGates() returns gates based on YAML activation.prompt_categories
 * 2. Framework gates (gate_type: 'framework') require BOTH category AND framework match
 * 3. Regular gates activate based on category matching only
 */

import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GateManager, createGateManager } from '../../../src/engine/gates/gate-manager.js';
import type { Logger } from '../../../src/infra/logging/index.js';

// Set up server root for gate loader to find resources
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '../../..');

describe('Gate Category Selection Integration', () => {
  let gateManager: GateManager;
  let originalServerRoot: string | undefined;

  beforeAll(async () => {
    // Save and set MCP_SERVER_ROOT for gate loader
    originalServerRoot = process.env.MCP_SERVER_ROOT;
    process.env.MCP_SERVER_ROOT = serverRoot;

    const logger: Logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    gateManager = await createGateManager(logger, { debug: false });
  });

  afterAll(() => {
    // Restore original MCP_SERVER_ROOT
    if (originalServerRoot !== undefined) {
      process.env.MCP_SERVER_ROOT = originalServerRoot;
    } else {
      delete process.env.MCP_SERVER_ROOT;
    }
  });

  /**
   * Category-gate activation, queried the way production queries it:
   * `GateSetResolver.registryGateIds()` — the ADR-0001 owner of registry auto-assignment —
   * issues exactly the call below, so this is the path that decides a category's gates.
   *
   * Two semantics worth stating, because neither is visible at this call site:
   *   - Case folding belongs to `gate-activation.ts`; `checkRegularGateActivation` lowercases
   *     both the context category and the declared ones, so callers need not normalize.
   *   - Framework gates are excluded here by their own declared `framework_context` failing to
   *     match an absent framework — not by any test on `gate_type`. A framework gate that
   *     declared no `framework_context` would therefore activate on category alone.
   */
  describe('category gate selection — the query GateSetResolver issues', () => {
    const categoryGates = (promptCategory: string): string[] =>
      gateManager.selectGates({ promptCategory, enabledOnly: true }).selectedIds;

    test('returns code-quality gate for development category', () => {
      const gates = categoryGates('development');
      expect(gates).toContain('code-quality');
    });

    test('does NOT return code-quality gate for research category', () => {
      const gates = categoryGates('research');
      expect(gates).not.toContain('code-quality');
    });

    test('excludes gates with explicit_request: true from auto-assignment', () => {
      // technical-accuracy and research-quality have explicit_request: true
      const devGates = categoryGates('development');
      expect(devGates).not.toContain('technical-accuracy');

      const researchGates = categoryGates('research');
      expect(researchGates).not.toContain('research-quality');
    });

    test('returns security-awareness for development category', () => {
      // security-awareness has development in categories and explicit_request: false
      const gates = categoryGates('development');
      expect(gates).toContain('security-awareness');
    });

    test('excludes framework gates when no framework is in context', () => {
      // framework-compliance declares framework_context, so category alone cannot activate it
      const devGates = categoryGates('development');
      expect(devGates).not.toContain('framework-compliance');

      const researchGates = categoryGates('research');
      expect(researchGates).not.toContain('framework-compliance');
    });

    test('handles case-insensitive category matching', () => {
      const upperGates = categoryGates('DEVELOPMENT');
      const lowerGates = categoryGates('development');
      expect(upperGates).toEqual(lowerGates);
    });

    test('returns an array for an unknown category', () => {
      const gates = categoryGates('unknown_category_xyz');
      // Gates with no category restriction still activate; gates with specific categories do not.
      expect(Array.isArray(gates)).toBe(true);
    });
  });

  describe('selectGates() - framework gate AND logic', () => {
    test('framework-compliance activates with BOTH category AND framework', () => {
      const result = gateManager.selectGates({
        promptCategory: 'development',
        framework: 'CAGEERF',
        enabledOnly: true,
      });

      expect(result.selectedIds).toContain('framework-compliance');
    });

    test('framework-compliance does NOT activate with category only (no framework)', () => {
      const result = gateManager.selectGates({
        promptCategory: 'development',
        // No framework specified
        enabledOnly: true,
      });

      expect(result.selectedIds).not.toContain('framework-compliance');
      expect(result.skippedIds).toContain('framework-compliance');
    });

    test('framework-compliance does NOT activate with framework only (no matching category)', () => {
      const result = gateManager.selectGates({
        promptCategory: 'greeting', // Not in framework-compliance's prompt_categories
        framework: 'CAGEERF',
        enabledOnly: true,
      });

      expect(result.selectedIds).not.toContain('framework-compliance');
      expect(result.skippedIds).toContain('framework-compliance');
    });

    test('framework-compliance requires matching framework from list', () => {
      const result = gateManager.selectGates({
        promptCategory: 'development',
        framework: 'UNKNOWN_FRAMEWORK',
        enabledOnly: true,
      });

      expect(result.selectedIds).not.toContain('framework-compliance');
    });

    test('framework-compliance accepts all configured frameworks', () => {
      const frameworks = ['CAGEERF', 'ReACT', '5W1H', 'SCAMPER'];

      for (const framework of frameworks) {
        const result = gateManager.selectGates({
          promptCategory: 'analysis', // In framework-compliance's categories
          framework,
          enabledOnly: true,
        });

        expect(result.selectedIds).toContain('framework-compliance');
      }
    });
  });

  describe('selectGates() - explicit gate requests', () => {
    test('includes explicitly requested gates regardless of activation rules', () => {
      const result = gateManager.selectGates({
        promptCategory: 'greeting', // Doesn't match any gate categories
        explicitGateIds: ['code-quality', 'research-quality'],
        enabledOnly: true,
      });

      expect(result.selectedIds).toContain('code-quality');
      expect(result.selectedIds).toContain('research-quality');
    });
  });

  describe('selection metadata', () => {
    test('tracks selection method for category-based selection', () => {
      const result = gateManager.selectGates({
        promptCategory: 'development',
        enabledOnly: true,
      });

      expect(result.metadata.selectionMethod).toBe('category');
      expect(typeof result.metadata.selectionTime).toBe('number');
    });

    test('tracks selection method for framework-based selection', () => {
      const result = gateManager.selectGates({
        framework: 'CAGEERF',
        enabledOnly: true,
      });

      expect(result.metadata.selectionMethod).toBe('framework');
    });

    test('tracks selection method for combined selection', () => {
      const result = gateManager.selectGates({
        promptCategory: 'development',
        framework: 'CAGEERF',
        enabledOnly: true,
      });

      expect(result.metadata.selectionMethod).toBe('combined');
    });
  });
});

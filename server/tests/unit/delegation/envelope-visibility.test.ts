import { describe, expect, test } from '@jest/globals';

import { applyVisibilityToEnvelope } from '../../../src/engine/execution/delegation/envelope-visibility.js';
import { DelegationRenderer } from '../../../src/engine/execution/delegation/renderer.js';

import type { DelegationPayload } from '../../../src/engine/execution/delegation/types.js';
import type { ExecutionEnvelope } from '../../../src/engine/execution/delegation/types.js';
import type { DelegationProfile } from '../../../src/shared/types/core-config.js';

/**
 * P5 Tier 3.2. Two claims are tested here, and they are separable:
 *   1. `applyVisibilityToEnvelope` removes withheld items and attaches the manifest.
 *   2. `DelegationRenderer` prints that manifest for EVERY delegation profile — the envelope is
 *      strategy-independent, so one code path must serve all six clients.
 */

const FULL_ENVELOPE: ExecutionEnvelope = {
  chainHistory: '### Chain Context\nStep 1 said: SECRET_HISTORY_VALUE',
  frameworkGuidance: '### Framework\nCAGEERF',
  gateInstructions: '### Quality Gates\nCode quality criteria',
};

describe('applyVisibilityToEnvelope', () => {
  test('returns the envelope untouched when nothing is withheld and nothing is manifested', () => {
    const result = applyVisibilityToEnvelope(FULL_ENVELOPE, { withheld: [], manifest: [] });

    // Reference equality, not deep equality: the no-declarations path must not even rebuild the
    // object, which is the cheapest possible proof that it cannot perturb the rendered bytes.
    expect(result).toBe(FULL_ENVELOPE);
  });

  test('null envelope with no decision stays null (no empty envelope conjured)', () => {
    expect(applyVisibilityToEnvelope(null, { withheld: [], manifest: [] })).toBeNull();
  });

  test('withholding chain_history removes the value and names it on the manifest', () => {
    const result = applyVisibilityToEnvelope(FULL_ENVELOPE, {
      withheld: ['chain_history'],
      manifest: ['chain_history'],
    });

    expect(result?.chainHistory).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('SECRET_HISTORY_VALUE');
    expect(result?.withheldManifest).toEqual(['chain_history']);
    // Items with no envelope field of their own leave the rest of the envelope intact.
    expect(result?.frameworkGuidance).toBe(FULL_ENVELOPE.frameworkGuidance);
    expect(result?.gateInstructions).toBe(FULL_ENVELOPE.gateInstructions);
  });

  test('a manifest alone produces an envelope from nothing to carry it', () => {
    const result = applyVisibilityToEnvelope(null, {
      withheld: ['previous_step_output'],
      manifest: ['previous_step_output'],
    });

    expect(result).toEqual({ withheldManifest: ['previous_step_output'] });
  });

  test('withheld drives filtering, manifest drives reporting — they are read separately', () => {
    // v1 aliases the two, so the discriminating case is a decision where they differ: the
    // envelope must lose chain_history (from `withheld`) yet report only what `manifest` names.
    const result = applyVisibilityToEnvelope(FULL_ENVELOPE, {
      withheld: ['chain_history'],
      manifest: ['unknowns_ledger'],
    });

    expect(result?.chainHistory).toBeUndefined();
    expect(result?.withheldManifest).toEqual(['unknowns_ledger']);
  });
});

describe('DelegationRenderer withheld manifest, per delegation profile', () => {
  const PROFILES: readonly DelegationProfile[] = [
    'task_tool_v1',
    'spawn_agent_v1',
    'gemini_subagent_v1',
    'opencode_agent_v1',
    'cursor_agent_v1',
    'neutral_v1',
  ];

  const payloadFor = (delegationProfile: DelegationProfile): DelegationPayload => ({
    stepNumber: 2,
    totalSteps: 3,
    promptName: 'research',
    agentType: 'chain-executor',
    clientProfile: {
      // Family is deliberately `unknown`: the profile alone must select the strategy, so a
      // family/profile pair that agrees would hide a renderer keying off the wrong field.
      clientFamily: 'unknown',
      clientId: 'test-client',
      clientVersion: '1.0.0',
      delegationProfile,
    },
    gateCount: 0,
    hasGates: false,
  });

  test.each(PROFILES)('%s renders the manifest line', (profile) => {
    const result = new DelegationRenderer().render(payloadFor(profile), {
      withheldManifest: ['previous_step_output', 'unknowns_ledger'],
    });

    expect(result).toContain('EXECUTION CONTEXT');
    expect(result).toContain(
      'CONTEXT WITHHELD (names only, values not provided): previous_step_output, unknowns_ledger'
    );
  });

  test.each(PROFILES)('%s renders no manifest line when nothing is withheld', (profile) => {
    const result = new DelegationRenderer().render(payloadFor(profile), {});

    expect(result).not.toContain('CONTEXT WITHHELD');
    expect(result).not.toContain('EXECUTION CONTEXT');
  });

  test('manifest names items but never carries a withheld value', () => {
    const envelope = applyVisibilityToEnvelope(FULL_ENVELOPE, {
      withheld: ['chain_history'],
      manifest: ['chain_history'],
    });
    const result = new DelegationRenderer().render(payloadFor('task_tool_v1'), envelope ?? {});

    expect(result).toContain('CONTEXT WITHHELD (names only, values not provided): chain_history');
    expect(result).not.toContain('SECRET_HISTORY_VALUE');
    // Non-withheld envelope content still renders — the manifest is additive, not a replacement.
    expect(result).toContain('CAGEERF');
  });
});

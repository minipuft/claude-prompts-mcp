import { describe, expect, test } from '@jest/globals';

import {
  BRIEF_END,
  BRIEF_START,
  QUALITY_GATES_HEADING,
  buildChainHistorySection,
  buildQualityGatesSection,
  buildResultContractSection,
  buildWithheldManifestLine,
} from '../../../../src/engine/execution/delegation/brief.js';

import type { BriefHistoryEntry } from '../../../../src/engine/execution/delegation/brief.js';

describe('delegation brief builders', () => {
  describe('BRIEF_START / BRIEF_END', () => {
    test('are non-empty, distinct delimiter strings', () => {
      expect(BRIEF_START.length).toBeGreaterThan(0);
      expect(BRIEF_END.length).toBeGreaterThan(0);
      expect(BRIEF_START).not.toEqual(BRIEF_END);
      expect(BRIEF_START).toContain('EXECUTION BRIEF');
      expect(BRIEF_END).toContain('END EXECUTION BRIEF');
    });
  });

  describe('buildQualityGatesSection', () => {
    test('returns null for undefined gate text', () => {
      expect(buildQualityGatesSection(undefined)).toBeNull();
    });

    test('returns null for empty/whitespace-only gate text', () => {
      expect(buildQualityGatesSection('')).toBeNull();
      expect(buildQualityGatesSection('   \n  ')).toBeNull();
    });

    test('renders the exact heading string with trimmed gate text', () => {
      const section = buildQualityGatesSection('  Gate: coverage >= 80%  ');
      expect(section).not.toBeNull();
      expect(QUALITY_GATES_HEADING).toBe('### Quality Gates');
      expect(section).toContain(QUALITY_GATES_HEADING);
      expect(section).toContain('Gate: coverage >= 80%');
      expect(section?.startsWith(QUALITY_GATES_HEADING)).toBe(true);
    });
  });

  describe('buildChainHistorySection', () => {
    test('returns null for an empty entries array', () => {
      expect(buildChainHistorySection([])).toBeNull();
    });

    test('renders each entry under its own Step heading, in order', () => {
      const entries: BriefHistoryEntry[] = [
        { stepNumber: 1, stepName: 'Research', output: 'found X' },
        { stepNumber: 2, stepName: 'Draft', output: 'wrote Y' },
      ];
      const section = buildChainHistorySection(entries);
      expect(section).not.toBeNull();
      expect(section).toContain('### Chain History (prior step outputs)');
      expect(section).toContain('#### Step 1: Research');
      expect(section).toContain('found X');
      expect(section).toContain('#### Step 2: Draft');
      expect(section).toContain('wrote Y');
      // order preserved
      expect(section!.indexOf('Step 1')).toBeLessThan(section!.indexOf('Step 2'));
    });
  });

  describe('buildResultContractSection', () => {
    test('with gates: includes the Proposed Gate Review block and PROPOSED framing', () => {
      const section = buildResultContractSection(true);
      expect(section).toContain('### Result Contract');
      expect(section).toContain('Proposed Gate Review:');
      expect(section).toContain('PROPOSED only');
      expect(section).toContain('the orchestrating agent reviews and may override');
    });

    test('without gates: omits the Proposed Gate Review block', () => {
      const section = buildResultContractSection(false);
      expect(section).toContain('### Result Contract');
      expect(section).not.toContain('Proposed Gate Review');
      expect(section).not.toContain('PROPOSED only');
    });
  });

  describe('buildWithheldManifestLine', () => {
    test('returns null for an empty manifest', () => {
      expect(buildWithheldManifestLine([])).toBeNull();
    });

    test('joins manifest entries with the fixed prefix', () => {
      const line = buildWithheldManifestLine(['chain_history', 'unknowns_ledger']);
      expect(line).toBe(
        'CONTEXT WITHHELD (names only, values not provided): chain_history, unknowns_ledger'
      );
    });
  });
});

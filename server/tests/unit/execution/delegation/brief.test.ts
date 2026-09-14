import { describe, expect, test } from '@jest/globals';

import {
  BRIEF_END,
  BRIEF_START,
  QUALITY_GATES_HEADING,
  assembleBriefBody,
  buildChainHistorySection,
  buildQualityGatesSection,
  buildWithheldManifestLine,
} from '../../../../src/engine/execution/delegation/brief.js';
import { HANDOFF_RESULT_HEADING } from '../../../../src/engine/execution/delegation/handoff-contract.js';

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

  describe('assembleBriefBody handoff result section', () => {
    const baseInputs = {
      workerLines: ['worker instructions'],
      stepGateText: undefined,
      historyEntries: [],
      manifest: [],
      nodeToken: 'n2',
    };

    test('ends with the HANDOFF RESULT section carrying the node token, after every other section', () => {
      const body = assembleBriefBody({
        ...baseInputs,
        stepGateText: '## Quality Gates\n\n- step-quality: output must name its evidence',
      });
      expect(body.trim().endsWith('```')).toBe(true);
      expect(body).toContain(HANDOFF_RESULT_HEADING);
      expect(body).toContain('node: n2');
      expect(body.indexOf(QUALITY_GATES_HEADING)).toBeLessThan(
        body.indexOf(HANDOFF_RESULT_HEADING)
      );
    });

    test('with gates: includes the Proposed Gate Review block and PROPOSED framing', () => {
      const body = assembleBriefBody({
        ...baseInputs,
        stepGateText: '## Quality Gates\n\n- step-quality: output must name its evidence',
      });
      expect(body).toContain('### Result Contract');
      expect(body).toContain('Proposed Gate Review:');
      expect(body).toContain('PROPOSED only');
      expect(body).toContain('the orchestrating agent reviews and may override');
    });

    test('without gates: omits the Proposed Gate Review block', () => {
      const body = assembleBriefBody(baseInputs);
      expect(body).toContain('### Result Contract');
      expect(body).not.toContain('Proposed Gate Review');
      expect(body).not.toContain('PROPOSED only');
    });

    test('states the worker boundary with and without gates', () => {
      // Replaces the tool restriction the shipped chain-executor agent used to carry for Claude
      // Code alone: every host renders this line, so the worker is told it owns one step and no
      // chain tool regardless of which agent the client spawned.
      for (const stepGateText of [undefined, '## Quality Gates\n\n- step-quality: ok']) {
        const body = assembleBriefBody({ ...baseInputs, stepGateText });
        expect(body).toContain('Do not call `prompt_engine`');
        expect(body).toContain('the orchestrating agent owns the run');
      }
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

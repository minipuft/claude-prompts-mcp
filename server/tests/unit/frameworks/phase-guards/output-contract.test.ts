import {
  getOutputContract,
  renderOutputContractSkeleton,
} from '../../../../src/engine/frameworks/phase-guards/output-contract.js';

import type { ProcessingStep } from '../../../../src/engine/frameworks/types/methodology-types.js';

const cageerfPhases: ProcessingStep[] = [
  {
    id: 'context_establishment',
    name: 'Context Establishment',
    description: 'Establish situational context',
    methodologyBasis: 'CAGEERF',
    order: 1,
    required: true,
    section_header: '## Context',
    guards: {
      required: true,
      min_length: 100,
      forbidden_terms: ['TODO', 'TBD'],
    },
  },
  {
    id: 'systematic_analysis',
    name: 'Systematic Analysis',
    description: 'Apply structured analysis',
    methodologyBasis: 'CAGEERF',
    order: 2,
    required: true,
    section_header: '## Analysis',
    guards: {
      required: true,
      min_length: 100,
      contains_any: ['systematic', 'methodical'],
    },
  },
  {
    id: 'refinement_preparation',
    name: 'Refinement Preparation',
    description: 'Establish iteration process',
    methodologyBasis: 'CAGEERF',
    order: 6,
    required: false,
    section_header: '## Refinement',
    guards: {
      min_length: 50,
    },
  },
];

describe('getOutputContract', () => {
  it('extracts headers from guarded phases', () => {
    const contract = getOutputContract(cageerfPhases);
    expect(contract).not.toBeNull();
    expect(contract?.headers).toHaveLength(3);
    expect(contract?.headers[0].header).toBe('## Context');
    expect(contract?.headers[0].required).toBe(true);
    expect(contract?.headers[0].minLength).toBe(100);
    expect(contract?.headers[0].forbiddenTerms).toEqual(['TODO', 'TBD']);
  });

  it('marks optional phases as not required', () => {
    const contract = getOutputContract(cageerfPhases);
    const refinement = contract?.headers.find((h) => h.header === '## Refinement');
    expect(refinement?.required).toBe(false);
    expect(refinement?.minLength).toBe(50);
  });

  it('skips phases without section_header', () => {
    const phases: ProcessingStep[] = [
      {
        id: 'no-header',
        name: 'No Header',
        description: 'Phase without section_header',
        methodologyBasis: 'test',
        order: 1,
        required: true,
        guards: { required: true, min_length: 50 },
      },
    ];
    expect(getOutputContract(phases)).toBeNull();
  });

  it('skips phases without guards', () => {
    const phases: ProcessingStep[] = [
      {
        id: 'no-guards',
        name: 'No Guards',
        description: 'Phase without guards',
        methodologyBasis: 'test',
        order: 1,
        required: true,
        section_header: '## Loose',
      },
    ];
    expect(getOutputContract(phases)).toBeNull();
  });

  it('returns null for empty or undefined phases', () => {
    expect(getOutputContract([])).toBeNull();
    expect(getOutputContract(undefined)).toBeNull();
  });

  it('preserves contains_any and contains_all from guards', () => {
    const contract = getOutputContract(cageerfPhases);
    const analysis = contract?.headers.find((h) => h.header === '## Analysis');
    expect(analysis?.containsAny).toEqual(['systematic', 'methodical']);
  });
});

describe('renderOutputContractSkeleton', () => {
  it('produces a markdown skeleton naming each required section', () => {
    const contract = getOutputContract(cageerfPhases)!;
    const skeleton = renderOutputContractSkeleton(contract);

    expect(skeleton).toContain('## Required Output Structure');
    expect(skeleton).toContain('## Context');
    expect(skeleton).toContain('## Analysis');
    expect(skeleton).toContain('## Refinement');
  });

  it('marks required vs optional sections', () => {
    const contract = getOutputContract(cageerfPhases)!;
    const skeleton = renderOutputContractSkeleton(contract);

    const contextLine = skeleton.split('\n').find((l) => l.includes('## Context'));
    expect(contextLine).toContain('required');

    const refinementLine = skeleton.split('\n').find((l) => l.includes('## Refinement'));
    expect(refinementLine).toContain('optional');
  });

  it('surfaces length constraints', () => {
    const contract = getOutputContract(cageerfPhases)!;
    const skeleton = renderOutputContractSkeleton(contract);
    expect(skeleton).toContain('min 100 chars');
    expect(skeleton).toContain('min 50 chars');
  });

  it('surfaces forbidden terms', () => {
    const contract = getOutputContract(cageerfPhases)!;
    const skeleton = renderOutputContractSkeleton(contract);
    expect(skeleton).toContain('do not use:');
    expect(skeleton).toContain('`TODO`');
    expect(skeleton).toContain('`TBD`');
  });

  it('surfaces contains_any keyword hints', () => {
    const contract = getOutputContract(cageerfPhases)!;
    const skeleton = renderOutputContractSkeleton(contract);
    expect(skeleton).toContain('must mention at least one of:');
    expect(skeleton).toContain('`systematic`');
    expect(skeleton).toContain('`methodical`');
  });

  it('returns empty string for empty contract', () => {
    expect(renderOutputContractSkeleton({ headers: [] })).toBe('');
  });
});

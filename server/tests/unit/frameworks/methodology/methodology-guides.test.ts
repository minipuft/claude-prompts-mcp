import { describe, expect, test } from '@jest/globals';

import { CAGEERFMethodologyGuide } from '../../../../src/frameworks/methodology/guides/cageerf-guide.js';
import { ReACTMethodologyGuide } from '../../../../src/frameworks/methodology/guides/react-guide.js';
import { SCAMPERMethodologyGuide } from '../../../../src/frameworks/methodology/guides/scamper-guide.js';
import { FiveW1HMethodologyGuide } from '../../../../src/frameworks/methodology/guides/5w1h-guide.js';

const guides = [
  { name: 'CAGEERF', guide: new CAGEERFMethodologyGuide() },
  { name: 'ReACT', guide: new ReACTMethodologyGuide() },
  { name: '5W1H', guide: new FiveW1HMethodologyGuide() },
  { name: 'SCAMPER', guide: new SCAMPERMethodologyGuide() },
];

describe('Methodology guides', () => {
  test.each(guides)('%s guide exposes the required interface', ({ guide }) => {
    const requiredMethods = [
      'guidePromptCreation',
      'guideTemplateProcessing',
      'guideExecutionSteps',
      'enhanceWithMethodology',
      'validateMethodologyCompliance',
    ];

    for (const method of requiredMethods) {
      expect(typeof (guide as any)[method]).toBe('function');
    }
  });

  test.each(guides)('%s prompt guidance returns structured suggestions', ({ guide }) => {
    const result = guide.guidePromptCreation('Test use case', {
      useCase: 'Test use case',
      domain: 'testing',
      complexity: 'intermediate',
    });

    expect(result).toBeTruthy();
    expect(Array.isArray(result.structureGuidance?.systemPromptSuggestions)).toBe(true);
    expect(Array.isArray(result.structureGuidance?.userTemplateSuggestions)).toBe(true);
  });

  test.each(guides)('%s template processing provides actionable steps', ({ guide }) => {
    const processing = guide.guideTemplateProcessing(
      'Execute {{task}} with structured reasoning.',
      'template'
    );

    expect(processing).toBeTruthy();
    expect(Array.isArray(processing.processingSteps)).toBe(true);
    expect(processing.processingSteps.length).toBeGreaterThan(0);
  });
});

import { describe, expect, test } from '@jest/globals';

import {
  filterFrameworkGuidance,
  hasFrameworkSpecificContent,
  getFrameworksInGuidance,
} from '../../../../dist/gates/guidance/FrameworkGuidanceFilter.js';

const CUSTOM_GUIDANCE = `General tips\n- CUSTOM: Follow custom steps\nDetails\n- OTHER: Irrelevant block`;
const DEFAULT_GUIDANCE = `- CAGEERF: Use structured planning\n- REACT: Keep responses concise`;

describe('FrameworkGuidanceFilter', () => {
  test('filters guidance using provided framework list', () => {
    const filtered = filterFrameworkGuidance(CUSTOM_GUIDANCE, 'custom', ['CUSTOM', 'OTHER']);

    expect(filtered).toContain('CUSTOM');
    expect(filtered).not.toContain('OTHER: Irrelevant block');
  });

  test('detects framework specific content with dynamic frameworks', () => {
    expect(hasFrameworkSpecificContent(CUSTOM_GUIDANCE, ['CUSTOM'])).toBe(true);
    expect(hasFrameworkSpecificContent('no framework markers', ['CUSTOM'])).toBe(false);
  });

  test('returns frameworks discovered in guidance respecting custom list', () => {
    const frameworks = getFrameworksInGuidance(CUSTOM_GUIDANCE, ['CUSTOM', 'OTHER']);
    expect(frameworks).toEqual(['CUSTOM', 'OTHER']);
  });

  test('does not fallback to default frameworks when none are provided', () => {
    const filtered = filterFrameworkGuidance(DEFAULT_GUIDANCE, 'CAGEERF');
    expect(filtered).toBe(DEFAULT_GUIDANCE);
  });
});

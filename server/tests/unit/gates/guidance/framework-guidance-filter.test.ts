import { describe, expect, test } from '@jest/globals';

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  filterFrameworkGuidance,
  hasFrameworkSpecificContent,
  getFrameworksInGuidance,
} from '../../../../src/engine/gates/guidance/FrameworkGuidanceFilter.js';
import { parseYamlOrThrow } from '../../../../src/shared/utils/yaml/yaml-parser.js';

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

  test('heads the matched line whatever the casing of the identifier', () => {
    const filtered = filterFrameworkGuidance('- ReACT: Reason\n- CAGEERF: Plan', 'react', [
      'REACT',
      'CAGEERF',
    ]);
    expect(filtered).toBe('**ReACT Framework Guidelines:**\n- Reason');
  });

  test('does not fallback to default frameworks when none are provided', () => {
    const filtered = filterFrameworkGuidance(DEFAULT_GUIDANCE, 'CAGEERF');
    expect(filtered).toBe(DEFAULT_GUIDANCE);
  });
});

/**
 * P6.290 / R178. MEASURED 2026-10-04 on `ebe8936fb` (driven, Streamable HTTP): a gate whose
 * guidance names frameworks only in their authored casing (`- ReACT:`, `- Radiant:`) rendered both
 * lines unfiltered and unheaded under ReACT, because `hasFrameworkSpecificContent` compared the
 * upper-cased identifiers (`REACT`, `RADIANT`) case-sensitively and so never let the filter run.
 *
 * The filter now asks one case-insensitive question at every site. This table is the gate for the
 * class: every REGISTERED framework (read from `resources/frameworks`, never a list written here),
 * in the casing guidance authors and in both case-folded forms, through every public method. A
 * new case-sensitive comparison in any of them fails the folded rows.
 */
describe('FrameworkGuidanceFilter compares framework ids case-insensitively at every site (P6.290)', () => {
  const FRAMEWORKS_DIR = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '..',
    'resources',
    'frameworks'
  );
  /** Each registered framework's `type`, in the casing its definition authors. */
  const registered = readdirSync(FRAMEWORKS_DIR, { withFileTypes: true })
    .filter((entry) => existsSync(path.join(FRAMEWORKS_DIR, entry.name, 'framework.yaml')))
    .map((entry) => {
      const definition = parseYamlOrThrow<{ id: string; type: string }>(
        readFileSync(path.join(FRAMEWORKS_DIR, entry.name, 'framework.yaml'), 'utf8')
      );
      return definition.type;
    });
  const casings: Array<[string, (id: string) => string]> = [
    ['upper', (id) => id.toUpperCase()],
    ['lower', (id) => id.toLowerCase()],
  ];
  const line = (authored: string): string => `- ${authored}: LINE-${authored.toUpperCase()}`;
  const allLines = registered.map(line).join('\n');

  test('the table reads more than one registered framework, and one authored in mixed case', () => {
    expect(registered.length).toBeGreaterThan(1);
    expect(registered.some((id) => id !== id.toUpperCase() && id !== id.toLowerCase())).toBe(true);
  });

  const rows = registered.flatMap((authored) =>
    casings.map(([casing, fold]) => ({ authored, casing, fold }))
  );

  test.each(rows)(
    '$authored as $casing: filterFrameworkGuidance keeps and heads its line alone',
    ({ authored, fold }) => {
      const filtered = filterFrameworkGuidance(allLines, fold(authored), registered.map(fold));
      expect(filtered).toContain(
        `**${authored} Framework Guidelines:**\n- LINE-${authored.toUpperCase()}`
      );
      for (const other of registered.filter((id) => id !== authored)) {
        expect(filtered).not.toContain(`LINE-${other.toUpperCase()}`);
      }
    }
  );

  test.each(rows)(
    '$authored as $casing: hasFrameworkSpecificContent sees its line alone',
    ({ authored, fold }) => {
      expect(hasFrameworkSpecificContent(line(authored), [fold(authored)])).toBe(true);
    }
  );

  test.each(rows)(
    '$authored as $casing: getFrameworksInGuidance finds it',
    ({ authored, fold }) => {
      expect(getFrameworksInGuidance(allLines, [fold(authored)])).toEqual([fold(authored)]);
    }
  );
});

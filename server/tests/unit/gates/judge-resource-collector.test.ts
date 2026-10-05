// @lifecycle test - The judge's framework-prompt filter asks the live framework lookup
import { describe, expect, it, jest } from '@jest/globals';

import { JudgeResourceCollector } from '../../../src/engine/gates/judge/judge-resource-collector.js';

import type { Logger } from '../../../src/infra/logging/index.js';
import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

const guidancePrompt = (id: string): ConvertedPrompt =>
  ({
    id,
    name: id,
    description: '',
    category: 'guidance',
    userMessageTemplate: '',
    arguments: [],
  }) as ConvertedPrompt;

describe('JudgeResourceCollector styles without a StyleManager', () => {
  const prompts = [
    guidancePrompt('cageerf'),
    guidancePrompt('team-method'),
    guidancePrompt('tone'),
  ];

  it('treats a workspace-defined framework as a framework, not as a style', async () => {
    // `team-method` exists only in this workspace: no shipped id list contains it.
    const getFramework = jest.fn((id: string) => (id === 'team-method' ? { id } : undefined));
    const collector = new JudgeResourceCollector(
      () => prompts,
      null,
      logger,
      null,
      null,
      getFramework
    );

    const { styles } = await collector.collectAllResources();

    expect(styles.map((s) => s.id)).toEqual(['cageerf', 'tone']);
    expect(getFramework).toHaveBeenCalledWith('team-method');
  });

  it('does not exclude a shipped framework id the live lookup no longer knows', async () => {
    const collector = new JudgeResourceCollector(
      () => prompts,
      null,
      logger,
      null,
      null,
      () => undefined
    );

    const { styles } = await collector.collectAllResources();

    expect(styles.map((s) => s.id)).toEqual(['cageerf', 'team-method', 'tone']);
  });
});

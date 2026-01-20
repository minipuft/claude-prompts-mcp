import { afterAll, beforeAll, describe, expect, test, jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PromptLoader } from '../../../src/prompts/loader.js';
import type { Logger } from '../../../src/logging/index.js';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

describe('PromptLoader: Parent-Child Nested Prompt Discovery', () => {
  let tmpRoot: string;
  let promptsDir: string;

  beforeAll(() => {
    // Create temp directory structure mimicking the chain pattern
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nested-prompt-test-'));
    promptsDir = path.join(tmpRoot, 'examples');
    fs.mkdirSync(promptsDir, { recursive: true });

    // Create parent chain directory: examples/my_chain/
    const chainDir = path.join(promptsDir, 'my_chain');
    fs.mkdirSync(chainDir, { recursive: true });

    // Parent prompt.yaml (chain definition)
    fs.writeFileSync(
      path.join(chainDir, 'prompt.yaml'),
      `id: my_chain
name: My Chain
description: A test chain with nested steps
chainSteps:
  - promptId: my_chain/step_one
    stepName: Step One
  - promptId: my_chain/step_two
    stepName: Step Two
`
    );

    // Nested step prompts using directory pattern
    const step1Dir = path.join(chainDir, 'step_one');
    fs.mkdirSync(step1Dir, { recursive: true });
    fs.writeFileSync(
      path.join(step1Dir, 'prompt.yaml'),
      `id: step_one
name: Step One
description: First step of the chain
userMessageTemplate: Execute step one
`
    );

    const step2Dir = path.join(chainDir, 'step_two');
    fs.mkdirSync(step2Dir, { recursive: true });
    fs.writeFileSync(
      path.join(step2Dir, 'prompt.yaml'),
      `id: step_two
name: Step Two
description: Second step of the chain
userMessageTemplate: Execute step two
`
    );

    // Add a standalone prompt at same level as chain
    fs.writeFileSync(
      path.join(promptsDir, 'standalone.yaml'),
      `id: standalone
name: Standalone Prompt
description: A standalone prompt for testing
userMessageTemplate: A standalone prompt
`
    );
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test('discovers parent chain prompt AND nested step prompts', () => {
    const logger = createLogger();
    const loader = new PromptLoader(logger, {});

    const discovered = loader.discoverYamlPrompts(promptsDir, '');

    // Should find all 4 prompts:
    // - standalone.yaml
    // - my_chain/ (parent)
    // - my_chain/step_one/ (nested)
    // - my_chain/step_two/ (nested)
    expect(discovered).toHaveLength(4);
  });

  test('nested prompts are discovered alongside their parent', () => {
    const logger = createLogger();
    const loader = new PromptLoader(logger, {});

    const discovered = loader.discoverYamlPrompts(promptsDir, '');

    // Extract relative paths for easier assertion
    const relativePaths = discovered.map((p) => path.relative(promptsDir, p));

    // Should include the parent chain
    expect(relativePaths).toContainEqual('my_chain');

    // Should include nested step prompts
    expect(relativePaths).toContainEqual(path.join('my_chain', 'step_one'));
    expect(relativePaths).toContainEqual(path.join('my_chain', 'step_two'));

    // Should include standalone prompt
    expect(relativePaths).toContainEqual('standalone.yaml');
  });

  test('loadAllYamlPrompts produces correct prefixed IDs for nested prompts', () => {
    const logger = createLogger();
    const loader = new PromptLoader(logger, {});

    const prompts = loader.loadAllYamlPrompts(promptsDir);

    // Extract IDs
    const ids = prompts.map((p) => p.id);

    // Should have all prompts with correct IDs
    expect(ids).toContain('standalone');
    expect(ids).toContain('my_chain');
    expect(ids).toContain('my_chain/step_one');
    expect(ids).toContain('my_chain/step_two');
  });

  test('backward compatible: directories without prompt.yaml still recurse normally', () => {
    // Create a plain directory (no prompt.yaml) with nested prompts
    const plainDir = path.join(promptsDir, 'plain_folder');
    fs.mkdirSync(plainDir, { recursive: true });

    const nestedPromptDir = path.join(plainDir, 'nested_prompt');
    fs.mkdirSync(nestedPromptDir, { recursive: true });
    fs.writeFileSync(
      path.join(nestedPromptDir, 'prompt.yaml'),
      `id: nested_prompt
name: Nested Prompt
description: A nested prompt for testing
userMessageTemplate: Hello from nested prompt
`
    );

    const logger = createLogger();
    const loader = new PromptLoader(logger, {});

    const discovered = loader.discoverYamlPrompts(promptsDir, '');

    // Should find the nested prompt through plain directory
    expect(discovered.some((p) => p.includes('nested_prompt'))).toBe(true);
  });

  test('deep nesting works correctly (3+ levels)', () => {
    // Create deeply nested structure
    const level1 = path.join(promptsDir, 'level1');
    const level2 = path.join(level1, 'level2');
    const level3 = path.join(level2, 'level3');
    fs.mkdirSync(level3, { recursive: true });

    // Add prompt.yaml at each level
    fs.writeFileSync(
      path.join(level1, 'prompt.yaml'),
      `id: level1
name: Level 1
description: Level 1 prompt for testing deep nesting
userMessageTemplate: Level 1 prompt
`
    );

    fs.writeFileSync(
      path.join(level2, 'prompt.yaml'),
      `id: level2
name: Level 2
description: Level 2 prompt for testing deep nesting
userMessageTemplate: Level 2 prompt
`
    );

    fs.writeFileSync(
      path.join(level3, 'prompt.yaml'),
      `id: level3
name: Level 3
description: Level 3 prompt for testing deep nesting
userMessageTemplate: Level 3 prompt
`
    );

    const logger = createLogger();
    const loader = new PromptLoader(logger, {});

    const prompts = loader.loadAllYamlPrompts(promptsDir);
    const ids = prompts.map((p) => p.id);

    // All levels should be discovered with correct prefixed IDs
    expect(ids).toContain('level1');
    expect(ids).toContain('level1/level2');
    expect(ids).toContain('level1/level2/level3');
  });

  test('hidden directories (starting with .) are skipped', () => {
    const hiddenDir = path.join(promptsDir, '.hidden');
    fs.mkdirSync(hiddenDir, { recursive: true });
    fs.writeFileSync(
      path.join(hiddenDir, 'prompt.yaml'),
      `id: hidden
name: Hidden Prompt
userMessageTemplate: Should not be found
`
    );

    const logger = createLogger();
    const loader = new PromptLoader(logger, {});

    const prompts = loader.loadAllYamlPrompts(promptsDir);
    const ids = prompts.map((p) => p.id);

    // Hidden prompt should NOT be discovered
    expect(ids).not.toContain('hidden');
    expect(ids).not.toContain('.hidden');
  });

  test('underscore directories (starting with _) are skipped', () => {
    const underscoreDir = path.join(promptsDir, '_private');
    fs.mkdirSync(underscoreDir, { recursive: true });
    fs.writeFileSync(
      path.join(underscoreDir, 'prompt.yaml'),
      `id: private
name: Private Prompt
userMessageTemplate: Should not be found
`
    );

    const logger = createLogger();
    const loader = new PromptLoader(logger, {});

    const prompts = loader.loadAllYamlPrompts(promptsDir);
    const ids = prompts.map((p) => p.id);

    // Underscore-prefixed prompt should NOT be discovered
    expect(ids).not.toContain('private');
    expect(ids).not.toContain('_private');
  });
});

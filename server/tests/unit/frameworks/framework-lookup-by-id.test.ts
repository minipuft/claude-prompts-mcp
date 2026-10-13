/**
 * A framework is looked up by its id, never by its type.
 *
 * `type` is a free-form discriminator in `framework.yaml`, so a custom framework can carry an id
 * (`my-method`) its type (`custom`) does not resolve to. The state store's active-framework entry
 * and `FrameworkManager.selectFramework` both hand back that pair; a consumer that feeds the
 * `type` into `getFramework` / `getFrameworkGuide` finds nothing for such a framework.
 *
 * Every assertion here uses a framework whose type is not an id in the registry. A built-in
 * (id equals type) would pass whichever field the code reads.
 *
 * Source scan: the two framework services must not pass a `.type` to an id-taking lookup.
 *
 * Classification: Unit (real FrameworkManager + PromptGuidanceService over the bundled registry,
 * stub state store).
 */

import { readFileSync } from 'node:fs';

import { beforeAll, describe, expect, jest, test } from '@jest/globals';

import { GenericFrameworkGuide } from '../../../src/engine/frameworks/definitions/generic-framework-guide.js';
import { FrameworkManager } from '../../../src/engine/frameworks/framework-manager.js';
import { PromptGuidanceService } from '../../../src/engine/frameworks/prompt-guidance/service.js';

import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';

const CUSTOM_ID = 'my-method';
const CUSTOM_TYPE = 'custom';

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const prompt: ConvertedPrompt = {
  id: 'p',
  name: 'Prompt',
  description: 'd',
  category: 'general',
  userMessageTemplate: 'Hello',
  arguments: [],
};

/** A state store whose active framework is the custom one, as `FrameworkStateStore` returns it. */
function stateStoreActiveOn(manager: FrameworkManager) {
  return {
    isFrameworkSystemEnabled: () => true,
    getActiveFramework: () => manager.getFramework(CUSTOM_ID),
    switchFramework: async () => true,
    selectDefaultForRemovedFrameworks: async () => {},
  };
}

describe('framework lookup by id', () => {
  let manager: FrameworkManager;

  beforeAll(async () => {
    manager = new FrameworkManager(createLogger() as never);
    await manager.initialize();
    await manager.getFrameworkRegistry().registerGuide(
      new GenericFrameworkGuide({
        id: CUSTOM_ID,
        name: 'My Method',
        type: CUSTOM_TYPE,
        version: '1.0.0',
        enabled: true,
        systemPromptGuidance: 'custom guidance',
      })
    );
    await manager.reload(CUSTOM_ID);
    manager.setFrameworkStateStore(stateStoreActiveOn(manager));
  });

  test('the fixture is a framework whose type is not an id', () => {
    const framework = manager.getFramework(CUSTOM_ID);
    expect(framework?.type).toBe(CUSTOM_TYPE);
    expect(manager.getFramework(CUSTOM_TYPE)).toBeUndefined();
    expect(manager.getFrameworkGuide(CUSTOM_TYPE)).toBeUndefined();
  });

  test('selectFramework resolves the active-state entry by id', () => {
    expect(manager.selectFramework().id.toLowerCase()).toBe(CUSTOM_ID);
  });

  test('getStats names the active framework by id', () => {
    expect(manager.getStats().activeFramework?.toLowerCase()).toBe(CUSTOM_ID);
  });

  test('applyGuidance with no override renders the active custom framework', async () => {
    const service = new PromptGuidanceService(createLogger() as never);
    await service.initialize(manager);

    const result = await service.applyGuidance(prompt);

    expect(result.metadata.frameworkUsed).toBe(CUSTOM_TYPE);
    expect(result.executionStepGuidance).toBeDefined();
  });

  test('applyGuidance with an id override renders that framework', async () => {
    const service = new PromptGuidanceService(createLogger() as never);
    await service.initialize(manager);

    const result = await service.applyGuidance(prompt, { frameworkOverride: CUSTOM_ID });

    expect(result.metadata.frameworkUsed).toBe(CUSTOM_TYPE);
  });
});

describe('framework services never pass a type as an id', () => {
  const FILES = [
    'src/engine/frameworks/framework-manager.ts',
    'src/engine/frameworks/prompt-guidance/service.ts',
  ];
  // A lookup that takes an id, fed `.type` directly or via a `selectFramework(...)` result.
  const TYPE_AS_ID =
    /\b(?:getFramework|getFrameworkGuide|getGuide|get|has)\(\s*[\w.?]+\.type\b|selectFramework\([^)]*\)\.type\b|=\s*[\w.?]*[aA]ctive[\w.?]*\.type\b/;

  test('the scan matches the shapes it exists to forbid', () => {
    expect('this.getFramework(activeFramework.type)').toMatch(TYPE_AS_ID);
    expect('await this.getFrameworkGuide(activeFramework.type)').toMatch(TYPE_AS_ID);
    expect('this.frameworkManager.selectFramework({ scope }).type').toMatch(TYPE_AS_ID);
    expect('if (active) activeFramework = active.type;').toMatch(TYPE_AS_ID);
    expect('this.getFramework(activeFramework.id)').not.toMatch(TYPE_AS_ID);
  });

  test.each(FILES)('%s', (file) => {
    const offenders = readFileSync(file, 'utf8')
      .split('\n')
      .map((text, index) => ({ line: index + 1, text }))
      .filter(({ text }) => TYPE_AS_ID.test(text));
    expect(offenders).toEqual([]);
  });
});

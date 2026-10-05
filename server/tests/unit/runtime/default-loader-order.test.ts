// @lifecycle test - P6.6: the process-default framework and style loaders refuse config that arrives after a consumer took the unconfigured loader.
/**
 * `initializeModules` configures both process-default loaders with the directories `PathResolver`
 * resolved. A consumer that asks with no config gets whatever was established, and with nothing
 * established, a loader over the package's own directories. Measured 2026-10-05 on `4311d6841`:
 * when such a consumer ran first, the framework singleton silently REPLACED itself on the later
 * config (the consumer kept the package-tree loader it was handed), and the style singleton
 * silently DROPPED the later config. Directory resolution depended on call order with no signal.
 *
 * Each twin drives a real consumer: `FrameworkRegistry` (what `FrameworkManager` builds, holding
 * the loader it finds at construction) and the tool-description style overlay.
 */
import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createFrameworkRegistry,
  getDefaultRuntimeLoader,
  resetDefaultRuntimeLoader,
} from '../../../src/engine/frameworks/definitions/index.js';
import { preloadStyleDescriptions } from '../../../src/mcp/tools/tool-description-overlays.js';
import {
  getDefaultStyleDefinitionLoader,
  resetDefaultStyleDefinitionLoader,
} from '../../../src/modules/formatting/core/style-definition-loader.js';

import type { Logger } from '../../../src/infra/logging/index.js';

const silentLogger = (): Logger =>
  ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

const LATE = /Configured after a consumer already took the unconfigured default loader/;

describe('process-default definition loaders take their config before any consumer (P6.6)', () => {
  const dirs: string[] = [];
  const tempDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'default-loader-order-'));
    dirs.push(dir);
    return dir;
  };

  afterEach(() => {
    resetDefaultRuntimeLoader();
    resetDefaultStyleDefinitionLoader();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test('framework: config arriving after a registry took the unconfigured loader is refused', async () => {
    const registry = await createFrameworkRegistry(silentLogger());
    const handedOut = registry.getRuntimeLoader();

    expect(() => getDefaultRuntimeLoader({ frameworksDir: tempDir() })).toThrow(LATE);
    // Nothing was replaced: the consumer and the singleton still agree.
    expect(getDefaultRuntimeLoader()).toBe(handedOut);
  });

  test('framework control: configured first, the registry reads the configured loader', async () => {
    // Any supplied config is the composition root speaking; this one keeps the bundled frameworks
    // the registry requires at initialization.
    const configured = getDefaultRuntimeLoader({ enableCache: false });

    const registry = await createFrameworkRegistry(silentLogger());

    expect(registry.getRuntimeLoader()).toBe(configured);
  });

  test('style: config arriving after the overlay took the unconfigured loader is refused', () => {
    preloadStyleDescriptions(silentLogger());
    const handedOut = getDefaultStyleDefinitionLoader();

    expect(() => getDefaultStyleDefinitionLoader({ stylesDir: tempDir() })).toThrow(LATE);
    expect(getDefaultStyleDefinitionLoader()).toBe(handedOut);
  });

  test('style control: configured first, the overlay reads the configured loader', () => {
    const configured = getDefaultStyleDefinitionLoader({ stylesDir: tempDir() });

    preloadStyleDescriptions(silentLogger());

    expect(getDefaultStyleDefinitionLoader()).toBe(configured);
  });
});

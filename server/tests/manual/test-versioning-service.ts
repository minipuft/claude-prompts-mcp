/**
 * Manual Test: VersionHistoryService Integration
 *
 * Run with: npx tsx tests/manual/test-versioning-service.ts
 *
 * Tests the actual VersionHistoryService class end-to-end:
 * 1. Save versions
 * 2. Load history
 * 3. Get specific version
 * 4. Compare versions
 * 5. Delete history
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VersionHistoryService } from '../../src/modules/versioning/version-history-service.js';
import type { VersioningConfig } from '../../src/modules/versioning/types.js';
import type { Logger } from '../../src/infra/logging/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '../..');
const TEST_DIR = path.join(SERVER_ROOT, 'resources/prompts/examples/_version_test');

// Simple logger for testing
const logger: Logger = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  warn: (msg: string) => console.log(`[WARN] ${msg}`),
  error: (msg: string) => console.log(`[ERROR] ${msg}`),
  debug: (msg: string) => console.log(`[DEBUG] ${msg}`),
};

// Mock config provider
class TestConfigProvider {
  private config: VersioningConfig = {
    enabled: true,
    maxVersions: 5,
    autoVersion: true,
  };

  getVersioningConfig(): VersioningConfig {
    return this.config;
  }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  setMaxVersions(max: number): void {
    this.config.maxVersions = max;
  }
}

async function cleanup() {
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Ignore
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function main() {
  console.log('\n=== VersionHistoryService Integration Test ===\n');

  const configProvider = new TestConfigProvider();
  const service = new VersionHistoryService({
    logger,
    configManager: configProvider,
  });

  await cleanup();
  await fs.mkdir(TEST_DIR, { recursive: true });

  try {
    // Test 1: Save first version
    console.log('--- Test 1: Save first version ---');
    const v1Result = await service.saveVersion(
      TEST_DIR,
      'prompt',
      'test-prompt',
      { id: 'test-prompt', name: 'Test Prompt', template: 'Hello v1' },
      { description: 'Initial version' }
    );

    assert(v1Result.success, 'Save v1 should succeed');
    assert(v1Result.version === 1, 'First version should be 1');
    console.log('✓ Saved version 1\n');

    // Test 2: Save second version
    console.log('--- Test 2: Save second version ---');
    const v2Result = await service.saveVersion(
      TEST_DIR,
      'prompt',
      'test-prompt',
      { id: 'test-prompt', name: 'Test Prompt Updated', template: 'Hello v2' },
      { description: 'Added new feature' }
    );

    assert(v2Result.success, 'Save v2 should succeed');
    assert(v2Result.version === 2, 'Second version should be 2');
    console.log('✓ Saved version 2\n');

    // Test 3: Save third version
    console.log('--- Test 3: Save third version ---');
    const v3Result = await service.saveVersion(
      TEST_DIR,
      'prompt',
      'test-prompt',
      { id: 'test-prompt', name: 'Test Prompt Final', template: 'Hello v3' },
      { description: 'Final version' }
    );

    assert(v3Result.success, 'Save v3 should succeed');
    assert(v3Result.version === 3, 'Third version should be 3');
    console.log('✓ Saved version 3\n');

    // Test 4: Load history
    console.log('--- Test 4: Load history ---');
    const history = await service.loadHistory(TEST_DIR);

    assert(history !== null, 'History should exist');
    assert(history!.current_version === 3, 'Current version should be 3');
    assert(history!.versions.length === 3, 'Should have 3 versions');
    assert(history!.resource_type === 'prompt', 'Resource type should be prompt');

    console.log(`✓ Loaded history: ${history!.versions.length} versions`);
    console.log(`  Current version: ${history!.current_version}`);
    for (const v of history!.versions) {
      console.log(`  - v${v.version}: ${v.description}`);
    }
    console.log();

    // Test 5: Get specific version
    console.log('--- Test 5: Get specific version ---');
    const v1Entry = await service.getVersion(TEST_DIR, 1);
    const v2Entry = await service.getVersion(TEST_DIR, 2);
    const noEntry = await service.getVersion(TEST_DIR, 999);

    assert(v1Entry !== null, 'v1 entry should exist');
    assert(v1Entry!.snapshot.template === 'Hello v1', 'v1 template should match');
    assert(v2Entry !== null, 'v2 entry should exist');
    assert(v2Entry!.snapshot.template === 'Hello v2', 'v2 template should match');
    assert(noEntry === null, 'v999 should not exist');

    console.log('✓ Retrieved v1:', v1Entry!.snapshot.template);
    console.log('✓ Retrieved v2:', v2Entry!.snapshot.template);
    console.log('✓ v999 correctly returns null\n');

    // Test 6: Compare versions
    console.log('--- Test 6: Compare versions ---');
    const compareResult = await service.compareVersions(TEST_DIR, 1, 3);

    assert(compareResult.success, 'Compare should succeed');
    assert(compareResult.from !== undefined, 'From entry should exist');
    assert(compareResult.to !== undefined, 'To entry should exist');
    assert(compareResult.from!.snapshot.template === 'Hello v1', 'From should be v1');
    assert(compareResult.to!.snapshot.template === 'Hello v3', 'To should be v3');

    console.log('✓ Compared v1 → v3');
    console.log(`  From: ${compareResult.from!.snapshot.template}`);
    console.log(`  To: ${compareResult.to!.snapshot.template}\n`);

    // Test 7: Format history for display
    console.log('--- Test 7: Format history for display ---');
    const historyForFormat = await service.loadHistory(TEST_DIR);
    assert(historyForFormat !== null, 'History should exist for formatting');

    const formatted = service.formatHistoryForDisplay(historyForFormat!, 3);

    assert(formatted.includes('Version'), 'Should contain version header');
    assert(formatted.includes('History'), 'Should contain History header');

    console.log('✓ Formatted history:');
    console.log(formatted);
    console.log();

    // Test 8: Delete history
    console.log('--- Test 8: Delete history ---');
    const removedRows = await service.deleteHistory('prompt', TEST_DIR);

    assert(removedRows > 0, 'Delete should remove at least one row');

    const historyAfterDelete = await service.loadHistory(TEST_DIR);
    assert(historyAfterDelete === null, 'History should be deleted');

    console.log('✓ Deleted history\n');

    // Test 9: Config changes (hot-reload simulation)
    console.log('--- Test 9: Config hot-reload ---');

    // Re-create some versions
    await service.saveVersion(TEST_DIR, 'prompt', 'test', { v: 1 });
    await service.saveVersion(TEST_DIR, 'prompt', 'test', { v: 2 });

    assert(service.isEnabled(), 'Should be enabled');
    assert(service.isAutoVersionEnabled(), 'Auto-version should be enabled');

    // Disable via config provider
    configProvider.setEnabled(false);
    assert(!service.isEnabled(), 'Should now be disabled');

    // Try to save - should return version 0
    const disabledResult = await service.saveVersion(TEST_DIR, 'prompt', 'test', { v: 3 });
    assert(disabledResult.version === 0, 'Disabled save should return version 0');

    console.log('✓ Config hot-reload works correctly\n');

    console.log('=== All tests passed! ===\n');
  } finally {
    await cleanup();
    console.log('Cleaned up test directory');
  }
}

main().catch((err) => {
  console.error('\n✗ Test failed:', err.message);
  cleanup().finally(() => process.exit(1));
});

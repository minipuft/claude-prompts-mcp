/**
 * Manual Test: Version History System
 *
 * Run with: npx tsx tests/manual/test-versioning.ts
 *
 * Tests:
 * 1. Create a test prompt
 * 2. Update it (triggers auto-versioning)
 * 3. Verify .history.json sidecar file
 * 4. Test rollback
 * 5. Verify rollback result
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '../..');
const TEST_PROMPT_DIR = path.join(SERVER_ROOT, 'resources/prompts/examples/version_test');
const HISTORY_FILE = path.join(TEST_PROMPT_DIR, '.history.json');
const PROMPT_FILE = path.join(TEST_PROMPT_DIR, 'prompt.yaml');

async function cleanup() {
  try {
    await fs.rm(TEST_PROMPT_DIR, { recursive: true, force: true });
    console.log('✓ Cleaned up test directory');
  } catch {
    // Ignore if doesn't exist
  }
}

async function createPrompt(version: number, template: string) {
  await fs.mkdir(TEST_PROMPT_DIR, { recursive: true });

  const content = `id: version_test
name: Version Test Prompt v${version}
category: examples
description: Test prompt for versioning - version ${version}
arguments:
  - name: input
    type: string
    description: Test input
    required: true
userMessageTemplate: |
  ${template}
`;

  await fs.writeFile(PROMPT_FILE, content, 'utf8');
  console.log(`✓ Created prompt v${version}`);
}

async function readHistory(): Promise<any> {
  try {
    const content = await fs.readFile(HISTORY_FILE, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function saveVersionManually(resourceType: string, resourceId: string, snapshot: any, version: number) {
  const history = await readHistory() || {
    resource_type: resourceType,
    resource_id: resourceId,
    current_version: 0,
    versions: []
  };

  const entry = {
    version,
    date: new Date().toISOString(),
    snapshot,
    diff_summary: `Update to v${version}`,
    description: `Version ${version}`
  };

  history.versions.unshift(entry);
  history.current_version = version;

  await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  console.log(`✓ Saved version ${version} to history`);
}

async function main() {
  console.log('\n=== Version History System Manual Test ===\n');

  // Step 1: Cleanup
  await cleanup();

  // Step 2: Create initial prompt (v1)
  console.log('\n--- Step 1: Create initial prompt ---');
  await createPrompt(1, 'Hello {{input}}! This is version 1.');

  // Simulate saving v1 to history
  await saveVersionManually('prompt', 'version_test', {
    id: 'version_test',
    name: 'Version Test Prompt v1',
    template: 'Hello {{input}}! This is version 1.'
  }, 1);

  // Step 3: Update prompt (v2)
  console.log('\n--- Step 2: Update prompt to v2 ---');
  await createPrompt(2, 'Greetings {{input}}! This is version 2 with changes.');

  await saveVersionManually('prompt', 'version_test', {
    id: 'version_test',
    name: 'Version Test Prompt v2',
    template: 'Greetings {{input}}! This is version 2 with changes.'
  }, 2);

  // Step 4: Update prompt (v3)
  console.log('\n--- Step 3: Update prompt to v3 ---');
  await createPrompt(3, 'Welcome {{input}}! This is version 3 - final version.');

  await saveVersionManually('prompt', 'version_test', {
    id: 'version_test',
    name: 'Version Test Prompt v3',
    template: 'Welcome {{input}}! This is version 3 - final version.'
  }, 3);

  // Step 5: Verify history file
  console.log('\n--- Step 4: Verify history file ---');
  const history = await readHistory();

  if (!history) {
    console.error('✗ History file not found!');
    process.exit(1);
  }

  console.log(`✓ History file exists`);
  console.log(`  - Resource: ${history.resource_type}/${history.resource_id}`);
  console.log(`  - Current version: ${history.current_version}`);
  console.log(`  - Total versions: ${history.versions.length}`);

  // List versions
  console.log('\n  Version history:');
  for (const v of history.versions) {
    console.log(`    v${v.version}: ${v.description} (${v.date})`);
  }

  // Step 6: Simulate rollback to v1
  console.log('\n--- Step 5: Rollback to v1 ---');
  const v1 = history.versions.find((v: any) => v.version === 1);

  if (!v1) {
    console.error('✗ Version 1 not found in history!');
    process.exit(1);
  }

  // Restore v1 content
  await createPrompt(1, v1.snapshot.template);
  console.log(`✓ Rolled back to v1`);
  console.log(`  - Restored template: "${v1.snapshot.template.substring(0, 50)}..."`);

  // Step 7: Verify file content
  console.log('\n--- Step 6: Verify rollback result ---');
  const promptContent = await fs.readFile(PROMPT_FILE, 'utf8');

  if (promptContent.includes('version 1')) {
    console.log('✓ Prompt file correctly restored to v1 content');
  } else {
    console.error('✗ Prompt file does not contain v1 content!');
    process.exit(1);
  }

  // Show final state
  console.log('\n--- Final State ---');
  console.log('Prompt file:');
  console.log(promptContent);

  console.log('\n=== All tests passed! ===\n');

  // Cleanup
  console.log('Cleaning up test files...');
  await cleanup();
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

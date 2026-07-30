import { describe, expect, it } from '@jest/globals';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Verifies cli-shared has no transitive imports from runtime/infra/mcp modules.
 * This is the critical gate for Phase 0 — if cli-shared leaks runtime deps,
 * the CLI package cannot bundle independently.
 *
 * Uses dependency-cruiser to trace the actual import graph.
 */
describe('cli-shared import isolation', () => {
  const serverRoot = path.resolve(__dirname, '../../..');

  it('does not import from runtime, infra/config, infra/logging, mcp, or server modules', () => {
    // Run dependency-cruiser on cli-shared barrel to detect forbidden imports
    const result = execSync(
      `npx depcruise --config .dependency-cruiser.cjs --output-type err src/cli-shared/index.ts`,
      {
        cwd: serverRoot,
        encoding: 'utf-8',
        timeout: 30_000,
      }
    );

    // dependency-cruiser outputs "✔ no dependency violations found" on success,
    // or lists violations on failure. Check for the success marker.
    expect(result).toContain('no dependency violations found');
  });

  it('barrel file exports prompt schemas', async () => {
    const cliShared = await import('../../../src/cli-shared/index.js');
    expect(cliShared.PromptYamlSchema).toBeDefined();
    expect(cliShared.validatePromptYaml).toBeInstanceOf(Function);
  });

  it('barrel file exports gate schemas', async () => {
    const cliShared = await import('../../../src/cli-shared/index.js');
    expect(cliShared.GateDefinitionSchema).toBeDefined();
    expect(cliShared.validateGateSchema).toBeInstanceOf(Function);
  });

  it('barrel file exports methodology schemas', async () => {
    const cliShared = await import('../../../src/cli-shared/index.js');
    expect(cliShared.FrameworkSchema).toBeDefined();
    expect(cliShared.validateMethodologySchema).toBeInstanceOf(Function);
  });

  it('barrel file exports yaml utilities', async () => {
    const cliShared = await import('../../../src/cli-shared/index.js');
    expect(cliShared.parseYaml).toBeInstanceOf(Function);
    expect(cliShared.loadYamlFileSync).toBeInstanceOf(Function);
    expect(cliShared.discoverYamlDirectories).toBeInstanceOf(Function);
  });

  it('barrel file exports workspace init', async () => {
    const cliShared = await import('../../../src/cli-shared/index.js');
    expect(cliShared.initWorkspace).toBeInstanceOf(Function);
    expect(cliShared.STARTER_PROMPTS).toBeInstanceOf(Array);
    expect(cliShared.formatStarterPromptYaml).toBeInstanceOf(Function);
  });
});

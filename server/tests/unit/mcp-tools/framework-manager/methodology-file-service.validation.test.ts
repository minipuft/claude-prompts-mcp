import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FrameworkFileWriter } from '../../../../src/mcp/tools/framework-manager/services/index.js';

import type { ConfigManager, Logger } from '../../../../src/shared/types/index.js';

describe('FrameworkFileWriter canonical writes', () => {
  let workspaceDir: string;
  let logger: Logger;
  let configManager: ConfigManager;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-method-file-'));
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
    configManager = {
      getServerRoot: () => workspaceDir,
    } as unknown as ConfigManager;
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('rolls back id-only methodology payloads that fail schema validation', async () => {
    const service = new FrameworkFileWriter({ logger, configManager });
    const result = await service.writeMethodologyFiles({
      id: 'incomplete-method',
    });

    // id-only payload lacks required fields (name, methodology) — validation rejects and rolls back
    expect(result.success).toBe(false);
    expect(result.error).toContain('rolled back');
    const frameworkDir = service.getMethodologyDir('incomplete-method');
    expect(existsSync(frameworkDir)).toBe(false);
  });

  it('writes valid methodology payloads with all required fields', async () => {
    const service = new FrameworkFileWriter({ logger, configManager });
    const result = await service.writeMethodologyFiles({
      id: 'complete-method',
      name: 'Complete Method',
      type: 'COMPLETE',
      system_prompt_guidance: 'Apply complete principles.',
    });

    expect(result.success).toBe(true);
    const frameworkDir = service.getMethodologyDir('complete-method');
    const frameworkPath = join(frameworkDir, 'framework.yaml');
    expect(existsSync(frameworkPath)).toBe(true);

    const content = readFileSync(frameworkPath, 'utf8');
    expect(content).toContain('id: complete-method');
    expect(content).toContain('name: Complete Method');
    expect(content).toContain('enabled: true');
    expect(content).toMatch(/version:\s*["']?1\.0\.0["']?/);
  });

  it('writes phases and prompt files for rich methodology payloads', async () => {
    const service = new FrameworkFileWriter({ logger, configManager });
    const result = await service.writeMethodologyFiles({
      id: 'e2e-test',
      name: 'E2E Test Methodology',
      type: 'E2E_TEST',
      system_prompt_guidance: 'Apply E2E principles.',
      judge_prompt: 'Evaluate against E2E policy.',
      phases: [{ id: 'phase-1', name: 'Phase 1', description: 'First phase' }],
    });

    expect(result.success).toBe(true);
    const frameworkDir = service.getMethodologyDir('e2e-test');
    expect(existsSync(join(frameworkDir, 'framework.yaml'))).toBe(true);
    expect(existsSync(join(frameworkDir, 'system-prompt.md'))).toBe(true);
    expect(existsSync(join(frameworkDir, 'judge-prompt.md'))).toBe(true);
    expect(existsSync(join(frameworkDir, 'phases.yaml'))).toBe(true);
  });

  it('merges updates onto existing methodology data instead of overwriting', async () => {
    const service = new FrameworkFileWriter({ logger, configManager });
    await service.writeMethodologyFiles({
      id: 'merge-test',
      name: 'Merge Test',
      type: 'MERGE_BASE',
      system_prompt_guidance: 'Original guidance.',
    });

    const existing = await service.loadExistingMethodology('merge-test');
    expect(existing).not.toBeNull();

    const result = await service.writeMethodologyFiles(
      {
        id: 'merge-test',
        name: 'Merge Test Updated',
      },
      existing
    );
    expect(result.success).toBe(true);

    const frameworkDir = service.getMethodologyDir('merge-test');
    const yamlContent = readFileSync(join(frameworkDir, 'framework.yaml'), 'utf8');
    const promptContent = readFileSync(join(frameworkDir, 'system-prompt.md'), 'utf8');
    expect(yamlContent).toContain('name: Merge Test Updated');
    expect(yamlContent).toContain('type: MERGE_BASE');
    expect(promptContent).toBe('Original guidance.');
  });
});

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ResourceMutationTransaction,
  ResourceVerificationError,
  type ResourceVerificationResult,
} from '../../../src/modules/resources/services/index.js';

describe('ResourceMutationTransaction', () => {
  let tempDir: string;
  let transaction: ResourceMutationTransaction;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cpm-rmt-'));
    transaction = new ResourceMutationTransaction();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('rolls back newly created directories when post-mutation validation fails', async () => {
    const targetDir = join(tempDir, 'prompt-a');
    const promptYaml = join(targetDir, 'prompt.yaml');

    const invalidResult: ResourceVerificationResult = {
      valid: false,
      resourceType: 'prompts',
      resourceId: 'prompt-a',
      filePath: promptYaml,
      errors: [{ code: 'schema_validation_error', path: 'name', message: 'Required' }],
      warnings: [],
    };

    const result = await transaction.run({
      targets: [{ path: targetDir, kind: 'directory' }],
      mutate: async () => {
        mkdirSync(targetDir, { recursive: true });
        writeFileSync(promptYaml, 'id: prompt-a\nname:\n', 'utf8');
        return { written: true };
      },
      validate: () => invalidResult,
    });

    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(existsSync(targetDir)).toBe(false);
  });

  /**
   * G3: the reject path computes a fully specific `ResourceVerificationResult` and used to return
   * a fixed string, so the one sentence a caller needs — which field, and what was expected — was
   * computed and dropped. Generic over every resource type, so this covers prompts, gates,
   * frameworks, styles and tools alike.
   *
   * FALSIFICATION: restore `error: 'Mutation produced invalid resource state; restored previous
   * files.'` with nothing appended and every field assertion below reds while the rollback
   * assertions in the test above stay green.
   */
  it('names the failing field and expectation in the rollback error, not just that state was invalid', async () => {
    const targetDir = join(tempDir, 'framework-a');
    const frameworkYaml = join(targetDir, 'framework.yaml');

    const invalidResult: ResourceVerificationResult = {
      valid: false,
      resourceType: 'frameworks',
      resourceId: 'framework-a',
      filePath: frameworkYaml,
      errors: [
        {
          code: 'schema_validation_error',
          path: 'frameworkGates.0.name',
          message: 'Invalid input: expected string, received undefined',
        },
      ],
      warnings: [],
    };

    const result = await transaction.run({
      targets: [{ path: targetDir, kind: 'directory' }],
      mutate: async () => {
        mkdirSync(targetDir, { recursive: true });
        writeFileSync(frameworkYaml, 'id: framework-a\n', 'utf8');
        return { written: true };
      },
      validate: () => invalidResult,
    });

    expect(result.success).toBe(false);
    // Still says what happened to the files — the detail is added, not substituted.
    expect(result.error).toContain('restored previous files.');
    expect(result.error).toContain('frameworkGates.0.name');
    expect(result.error).toContain('expected string, received undefined');
    expect(result.error).toContain(frameworkYaml);

    // Structured detail too, so a caller can render it rather than re-parse the message. This is
    // the same payload the throw path already produced; the reject path used to produce none.
    expect(result.verificationFailure?.resourceType).toBe('frameworks');
    expect(result.verificationFailure?.rolledBack).toBe(true);
    expect(result.verificationFailure?.errors[0]?.path).toBe('frameworkGates.0.name');
  });

  it('rolls back existing files when mutate throws ResourceVerificationError', async () => {
    const stylePath = join(tempDir, 'style.yaml');
    writeFileSync(stylePath, 'id: analytical\nname: Analytical\ndescription: ok\n', 'utf8');

    const result = await transaction.run({
      targets: [{ path: stylePath, kind: 'file' }],
      mutate: async () => {
        writeFileSync(stylePath, 'id:\n', 'utf8');
        throw new ResourceVerificationError({
          resourceType: 'styles',
          resourceId: 'analytical',
          filePath: stylePath,
          errors: [{ code: 'schema_validation_error', path: 'id', message: 'Required' }],
          warnings: [],
          rolledBack: false,
        });
      },
    });

    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(result.verificationFailure?.resourceType).toBe('styles');
    expect(readFileSync(stylePath, 'utf8')).toContain('id: analytical');
  });
});

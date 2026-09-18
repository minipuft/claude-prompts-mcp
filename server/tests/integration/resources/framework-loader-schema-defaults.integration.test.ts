// @lifecycle test - P4.51 falsifier: a loaded framework carries its phases schema defaults.
/**
 * `RuntimeFrameworkLoader` had the same defect P4.49 fixed in `StyleDefinitionLoader`: on the
 * phases side, it validated `definition.phases` but then kept the RAW inlined phases object
 * instead of `validatePhasesSchema`'s output, so `ExecutionStepSchema.dependencies` — the only
 * `.default(` in `framework-schema.ts` — was simply `undefined` on any execution step that did
 * not author it, even though the schema defaults it to `[]`.
 *
 * THIS WAS NOT OBSERVABLE DOWNSTREAM BEFORE THE FIX, and that is itself the finding: the only
 * reader of `.dependencies`, `step-generator.ts`'s `generateExecutionSteps`, already guards with
 * `step.dependencies || []`. The schema's own default was still computed and thrown away — this
 * test asserts the loader now hands back what the schema promises, not merely what one guarded
 * reader tolerates.
 *
 * The top-level `FrameworkSchema` carries zero `.default(` fields, so `definition` itself is
 * still the raw parse after this fix — only `definition.phases` changes shape. Both
 * `FrameworkSchema` and `PhasesFileSchema` are `.passthrough()`, so no authored top-level or
 * phases-level field is dropped; only fields un-declared on an individual step object would be,
 * and nothing reads those.
 *
 * WHY THE TWO FIXTURES DIFFER IN ONLY THE FIELD UNDER TEST. `defaults_framework` and
 * `authored_framework` share an identical `step1` (never authors `dependencies`, in either
 * fixture — not the field under test) and an identical `step2` shape, except `step2.dependencies`
 * is omitted in `defaults_framework` and authored as `[step1]` in `authored_framework`. `step2`
 * must depend on an existing step id (`validatePhasesSchema` checks execution-step dependency
 * references), which is why the control cannot simply omit vs. author an empty array — `[step1]`
 * is the schema's simplest non-default value that still passes validation.
 *
 * Classification: Integration (real filesystem, real `RuntimeFrameworkLoader`, real Zod schema).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { RuntimeFrameworkLoader } from '../../../src/engine/frameworks/definitions/runtime-framework-loader.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

const TEST_DIR = testScratchPath('framework-loader-schema-defaults');

function frameworkYaml(id: string, step2DependenciesLine: string): string {
  return [
    `id: ${id}`,
    `name: Schema Defaults Framework`,
    `type: ${id.toUpperCase()}`,
    `version: 1.0.0`,
    `enabled: true`,
    `systemPromptGuidance: A framework that never authored step2's dependencies.`,
    `phases:`,
    `  executionSteps:`,
    `    - id: step1`,
    `      name: Step One`,
    `      action: do_step_one`,
    `      frameworkPhase: phase1`,
    `      expected_output: output one`,
    `    - id: step2`,
    `      name: Step Two`,
    `      action: do_step_two`,
    `      frameworkPhase: phase2`,
    ...(step2DependenciesLine ? [step2DependenciesLine] : []),
    `      expected_output: output two`,
    '',
  ].join('\n');
}

/** Omits `dependencies` on `step2` entirely — the schema must supply `[]`. */
const DEFAULTS_FRAMEWORK_YAML = frameworkYaml('defaults_framework', '');

/** Authors `step2.dependencies` with a non-default value, as a control. */
const AUTHORED_FRAMEWORK_YAML = frameworkYaml('authored_framework', '      dependencies: [step1]');

async function writeFramework(id: string, body: string): Promise<void> {
  const dir = path.join(TEST_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'framework.yaml'), body, 'utf-8');
}

describe('a loaded framework carries its phases schema defaults', () => {
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let warnSpy: ReturnType<typeof jest.spyOn>;

  beforeAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
    await writeFramework('defaults_framework', DEFAULTS_FRAMEWORK_YAML);
    await writeFramework('authored_framework', AUTHORED_FRAMEWORK_YAML);
  });

  afterEach(() => {
    errorSpy?.mockRestore();
    warnSpy?.mockRestore();
  });

  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it("fills step2's dependencies with the schema default when unauthored", () => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const loader = new RuntimeFrameworkLoader({ frameworksDir: TEST_DIR, enableCache: false });
    const framework = loader.loadFramework('defaults_framework');

    expect(framework).toBeDefined();
    const step2 = framework?.phases?.executionSteps?.find((step) => step.id === 'step2');
    expect(step2).toBeDefined();
    expect(step2?.dependencies).toEqual([]);
  });

  it("keeps step2's authored, non-default dependencies untouched (control)", () => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const loader = new RuntimeFrameworkLoader({ frameworksDir: TEST_DIR, enableCache: false });
    const framework = loader.loadFramework('authored_framework');

    expect(framework).toBeDefined();
    const step2 = framework?.phases?.executionSteps?.find((step) => step.id === 'step2');
    expect(step2).toBeDefined();
    expect(step2?.dependencies).toEqual(['step1']);
  });
});

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, test } from '@jest/globals';

import { GateManager } from '../../../../src/engine/gates/gate-manager.js';
import { GateSetResolver } from '../../../../src/engine/gates/services/gate-set-resolver.js';
import { resolveDeclaredArtifacts } from '../../../../src/engine/gates/utils/artifact-kinds.js';
import { loadYamlPrompt } from '../../../../src/modules/prompts/yaml-prompt-loader.js';

import type {
  ArtifactDeclaration,
  ArtifactKind,
} from '../../../../src/engine/gates/utils/artifact-kinds.js';
import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';
import type { Logger } from '../../../../src/infra/logging/index.js';
import type { YamlLoadContext } from '../../../../src/modules/prompts/yaml-prompt-loader.js';

/**
 * B13, row 1.2: proves activation for the real `strategic_worker` prompt against the REAL
 * registry files on disk — not a fake gate manager and not a hand-rolled activation table. The
 * gate-set-resolver.test.ts fakes exist to isolate the resolver's own ranking/veto logic; this
 * file exists to catch the other failure mode, where the resolver's logic is right but a
 * gate.yaml's `activation.artifacts` (or the prompt's `artifacts:` block) drifts from what the
 * table above claims — a fake registry can never observe that drift because it never reads the
 * YAML.
 */

const createLogger = (): Logger =>
  ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }) as unknown as Logger;

const __dirname = dirname(fileURLToPath(import.meta.url));

const STRATEGIC_WORKER_DIR = join(
  __dirname,
  '../../../../resources/prompts/development/strategic_worker'
);

/** Loads the real `strategic_worker/prompt.yaml` through the real loader + schema validator. */
function loadStrategicWorkerArtifacts(): {
  category: string;
  artifacts: ArtifactDeclaration | undefined;
} {
  const logger = createLogger();
  const ctx: YamlLoadContext = {
    logger,
    cache: new Map(),
    stats: { cacheHits: 0, cacheMisses: 0, loadErrors: 0 },
    enableCache: false,
    debug: false,
  };

  const loaded = loadYamlPrompt(STRATEGIC_WORKER_DIR, undefined, ctx);
  if (loaded === null) {
    throw new Error(
      `Failed to load the real strategic_worker prompt.yaml from ${STRATEGIC_WORKER_DIR} — ` +
        'this test asserts against that file, so a load failure here means the fixture path or ' +
        'the file itself is broken, not that the assertions below are wrong.'
    );
  }

  return {
    category: loaded.promptData.category ?? 'development',
    artifacts: loaded.loadedContent.artifacts,
  };
}

/** The declared artifacts a run would carry for one `files` argument value, the way the planner derives them (`ExecutionPlanner` → `resolveDeclaredArtifacts`). */
function declaredArtifactsFor(
  artifacts: ArtifactDeclaration | undefined,
  files: string
): ArtifactKind[] {
  return resolveDeclaredArtifacts(artifacts, { files });
}

describe('Artifact-based gate activation — real registry, real strategic_worker prompt (row 1.2)', () => {
  let gateManager: GateManager;
  let resolver: GateSetResolver;
  let strategicWorker: { category: string; artifacts: ArtifactDeclaration | undefined };

  beforeAll(async () => {
    const logger = createLogger();
    gateManager = new GateManager(logger);
    await gateManager.initialize();
    resolver = new GateSetResolver(logger, gateManager);
    strategicWorker = loadStrategicWorkerArtifacts();
  });

  test('strategic_worker declares artifacts.fromArgument: files', () => {
    // Guards every case below: if this drifts, every other assertion in this file would be
    // exercising the wrong declaration and passing for the wrong reason.
    expect(strategicWorker.artifacts).toEqual({ fromArgument: 'files' });
  });

  const resolveFor = async (files: string) => {
    const declaredArtifacts = declaredArtifactsFor(strategicWorker.artifacts, files);
    const prompt = {
      id: 'strategic_worker',
      name: 'Strategic Worker',
      description: 'worker brief',
      category: strategicWorker.category,
      userMessageTemplate: '',
      gateConfiguration: { framework_gates: false },
    } as unknown as ConvertedPrompt;

    const result = await resolver.resolve({
      prompt,
      category: strategicWorker.category,
      frameworkInjected: true,
      declaredArtifacts,
    });
    return result.gateIds;
  };

  test('a declared test file activates test-coverage and withholds code-quality', async () => {
    const gateIds = await resolveFor('server/tests/x.test.ts');

    expect(gateIds).toContain('test-coverage');
    expect(gateIds).not.toContain('code-quality');
  });

  test('a declared source file activates code-quality and security-awareness, withholds test-coverage', async () => {
    const gateIds = await resolveFor('server/src/x.ts');

    expect(gateIds).toContain('code-quality');
    expect(gateIds).toContain('security-awareness');
    expect(gateIds).not.toContain('test-coverage');
  });

  test('a declared docs file activates information-placement and prose-hygiene', async () => {
    const gateIds = await resolveFor('docs/guide.md');

    expect(gateIds).toContain('information-placement');
    expect(gateIds).toContain('prose-hygiene');
  });
});

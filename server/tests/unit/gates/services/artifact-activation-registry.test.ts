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

const README_IMPROVER_DIR = join(
  __dirname,
  '../../../../resources/prompts/documentation/readme_improver'
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

/** Loads the real bundled `readme_improver/prompt.yaml` through the real loader + schema validator. */
function loadReadmeImproverArtifacts(): {
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

  const loaded = loadYamlPrompt(README_IMPROVER_DIR, undefined, ctx);
  if (loaded === null) {
    throw new Error(
      `Failed to load the real readme_improver prompt.yaml from ${README_IMPROVER_DIR} — ` +
        'this test asserts against that file, so a load failure here means the fixture path or ' +
        'the file itself is broken, not that the assertions below are wrong.'
    );
  }

  return {
    category: loaded.promptData.category ?? 'documentation',
    artifacts: loaded.loadedContent.artifacts,
  };
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

/**
 * B44: a documentation-category prompt that declares no `artifacts:` gets none of the four
 * artifact-scoped documentation gates (B13 attaches by artifact, not by category) — exactly the
 * regression that dropped these gates from `readme_improver`. This proves the restored
 * declaration against the REAL bundled prompt and the REAL gate registry, the same shape
 * `strategic_worker`'s suite above uses.
 */
describe('Artifact-based gate activation — real registry, real readme_improver prompt (B44)', () => {
  let gateManager: GateManager;
  let resolver: GateSetResolver;
  let readmeImprover: { category: string; artifacts: ArtifactDeclaration | undefined };

  beforeAll(async () => {
    const logger = createLogger();
    gateManager = new GateManager(logger);
    await gateManager.initialize();
    resolver = new GateSetResolver(logger, gateManager);
    readmeImprover = loadReadmeImproverArtifacts();
  });

  test('readme_improver declares artifacts.produces: [docs, readme]', () => {
    // Guards the case below: if this drifts, the resolution test would exercise the wrong
    // declaration and pass for the wrong reason.
    expect(readmeImprover.artifacts).toEqual({ produces: ['docs', 'readme'] });
  });

  test('the declared artifacts activate all four documentation gates', async () => {
    const declaredArtifacts = resolveDeclaredArtifacts(readmeImprover.artifacts, {});
    const prompt = {
      id: 'readme_improver',
      name: 'Documentation Writer (Diátaxis)',
      description: 'documentation writer',
      category: readmeImprover.category,
      userMessageTemplate: '',
    } as unknown as ConvertedPrompt;

    const result = await resolver.resolve({
      prompt,
      category: readmeImprover.category,
      frameworkInjected: true,
      declaredArtifacts,
    });

    expect(result.gateIds).toContain('information-placement');
    expect(result.gateIds).toContain('product-positioning-fidelity');
    expect(result.gateIds).toContain('prose-hygiene');
    expect(result.gateIds).toContain('semantic-discoverability');
  });
});

/**
 * B44 round 2: `code-quality` shipped `activation.artifacts` AND `activation.prompt_categories`
 * together, and `isGateActiveForContext` (`gate-activation.ts`) returns on the artifacts branch
 * before `prompt_categories` is ever read whenever `artifacts` is non-empty — for every
 * `gate_type`, framework included. That makes `prompt_categories` provably dead the moment a gate
 * also declares `artifacts`, not merely redundant-looking. `api-documentation`,
 * `workflow-changelog`, `plan-quality`, `pr-performance`, `pr-security`, `security-awareness`,
 * and `test-coverage` carried the identical shape and were fixed alongside `code-quality`.
 *
 * This enumerates every REAL bundled gate the manager loads, so the class stays closed: a new
 * gate authored with both fields set fails here the day it lands, without anyone updating a
 * hand-maintained list of ids.
 */
describe('No bundled gate declares both artifacts and prompt_categories (B44 round 2)', () => {
  let gateManager: GateManager;

  beforeAll(async () => {
    gateManager = new GateManager(createLogger());
    await gateManager.initialize();
  });

  test('the bundled gate catalog is non-empty', () => {
    // Guards every case below: an empty catalog would make the enumeration below vacuously pass.
    const guides = gateManager.getGateRegistry().getAllGuides(false);
    expect(guides.length).toBeGreaterThan(20);
  });

  test('no gate combines non-empty artifacts with non-empty prompt_categories', () => {
    const guides = gateManager.getGateRegistry().getAllGuides(false);

    const offenders = guides
      .map((guide) => ({ gateId: guide.gateId, rules: guide.getActivationRules() }))
      .filter(
        ({ rules }) =>
          Array.isArray(rules.artifacts) &&
          rules.artifacts.length > 0 &&
          Array.isArray(rules.prompt_categories) &&
          rules.prompt_categories.length > 0
      )
      .map(({ gateId }) => gateId);

    expect(offenders).toEqual([]);
  });
});

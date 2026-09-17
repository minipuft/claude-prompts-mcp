/**
 * Legacy config key migration.
 *
 * The methodology -> framework vocabulary sweep renamed two config sections and one key. All
 * fail SILENTLY when absent: the old key is read as undefined and the default takes over, so a
 * user who had deliberately turned something off finds it back on with no error emitted. These
 * tests pin the 4.x -> 5.0 translation because `tsc` cannot see it — the shape is only bound at
 * load time.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { ConfigLoader } from '../../../../src/infra/config/index.js';

// Same resolution pattern as config-schema-warning.test.ts — the schema ships beside the server
// root, one directory shallower than this test file.
const __filename = fileURLToPath(import.meta.url);
const SERVER_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');
const SCHEMA_PATH = path.join(SERVER_ROOT, 'config.schema.json');

async function loadConfigFrom(raw: Record<string, unknown>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cfg-migration-'));
  const configPath = path.join(dir, 'config.json');
  await writeFile(configPath, JSON.stringify(raw), 'utf8');
  const manager = new ConfigLoader(configPath);
  const config = await manager.loadConfig();
  return { config, manager, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Same, but hands back an unloaded manager so a spy can be installed before the first load. */
async function managerFor(raw: Record<string, unknown>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cfg-deprecation-'));
  const configPath = path.join(dir, 'config.json');
  await writeFile(configPath, JSON.stringify(raw), 'utf8');
  return {
    manager: new ConfigLoader(configPath),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

describe('legacy config key migration', () => {
  /**
   * The three pre-rename config folds were retired in plan row 5.7 (their retirement condition —
   * "the first major release after the rename" — was met by v3.0.0).
   *
   * These assert the folds are GONE rather than deleting the cases, because a config key that is
   * no longer read and a config key that is still read look identical from the outside: both load
   * without error. Only an assertion on the resulting value separates them. This is the same
   * silent-default failure the folds originally existed to prevent, now running in reverse — so
   * the behaviour change is pinned in the direction it actually ships.
   *
   * NEGATIVE-VERIFY TARGET: reinstate any fold in `ConfigLoader` and the matching case fails.
   */
  describe('retired pre-rename folds', () => {
    it('no longer adopts a top-level `methodologies` section', async () => {
      const { config, cleanup } = await loadConfigFrom({
        methodologies: { enabled: false, systemPromptFrequency: 7 },
      });

      expect(config.frameworks?.enabled).toBe(true);
      expect(config.frameworks?.injection?.systemPrompt?.frequency).not.toBe(7);

      await cleanup();
    });

    it('no longer adopts `resources.methodologies`', async () => {
      const { config, cleanup } = await loadConfigFrom({
        resources: { registerWithMcp: true, methodologies: { enabled: false } },
      });

      expect(config.resources?.frameworks?.enabled).not.toBe(false);
      expect(config.resources?.registerWithMcp).toBe(true);

      await cleanup();
    });

    it('no longer reads `gates.methodologyGates`', async () => {
      const { manager, cleanup } = await loadConfigFrom({
        gates: { enabled: true, methodologyGates: false },
      });

      expect(manager.getGatesConfig().enableFrameworkGates).toBe(true);

      await cleanup();
    });
  });

  describe('canonical config keys', () => {
    it('keeps a canonical `frameworks` section', async () => {
      const { config, cleanup } = await loadConfigFrom({ frameworks: { enabled: true } });

      expect(config.frameworks?.enabled).toBe(true);

      await cleanup();
    });

    it('reads `resources.frameworks`', async () => {
      const { config, cleanup } = await loadConfigFrom({
        resources: { frameworks: { enabled: false } },
      });

      expect(config.resources?.frameworks?.enabled).toBe(false);

      await cleanup();
    });

    it('reads the canonical gates key', async () => {
      const { manager, cleanup } = await loadConfigFrom({
        gates: { enabled: true, frameworkGates: false },
      });

      expect(manager.getGatesConfig().enableFrameworkGates).toBe(false);

      await cleanup();
    });

    it('defaults to enabled when the key is absent', async () => {
      const { manager, cleanup } = await loadConfigFrom({ gates: { enabled: true } });

      expect(manager.getGatesConfig().enableFrameworkGates).toBe(true);

      await cleanup();
    });
  });

  // Guards the defect found while renaming: `persistFrameworkConfig` wrote key paths that
  // `validateConfigInput` rejects as unknown, and it returns on first failure — so
  // `system_control` framework enable/disable with persist:true wrote nothing at all.
  describe('persistFrameworkConfig key paths', () => {
    it('names only keys the config validator accepts', async () => {
      const { CONFIG_VALID_KEYS, validateConfigInput } =
        await import('../../../../src/cli-shared/config-input-validator.js');

      for (const key of [
        'frameworks.enabled',
        'frameworks.dynamicToolDescriptions',
        'gates.frameworkGates',
      ]) {
        expect(CONFIG_VALID_KEYS).toContain(key);
        expect(validateConfigInput(key, 'false')).toMatchObject({ valid: true });
      }
    });
  });

  // The inert `mode` spelling, now a 4.x FILE spelling. `cpm enable gates` wrote
  // `gates.mode: "on"` while every runtime reader consulted `gates.enabled`, so the command
  // reported success and changed nothing. The write path assigns dot-keys verbatim
  // (config-operations.ts applyConfigChange), so there was never a translation step — the two
  // spellings simply never met.
  //
  // Every fixture below deliberately omits `version`: that is what makes it a 4.x file, and the
  // only thing that makes it translated. Each asserts the RESOLVED runtime value, which is the
  // only thing that separates "translated" from "accepted and ignored".
  describe('a 4.x `mode` spelling translates to its canonical boolean', () => {
    it('translates a deliberate disable written as gates.mode', async () => {
      const { config, cleanup } = await loadConfigFrom({ gates: { mode: 'off' } });

      expect(config.gates?.enabled).toBe(false);
      expect((config.gates as unknown as Record<string, unknown>).mode).toBeUndefined();

      await cleanup();
    });

    // The twin that makes every case in this block evidence about the VERSION key: the same
    // fixture under `version: 5` is not a 4.x file, so nothing is translated and `gates.mode`
    // reaches no reader.
    it('leaves the same spelling alone in a `version: 5` file', async () => {
      const { config, cleanup } = await loadConfigFrom({ version: 5, gates: { mode: 'off' } });

      // `gates.mode` reaches no reader under version 5 (nothing translates it) — the loader
      // still resolves `enabled` to its own default, true, rather than leaving it unset.
      expect(config.gates.enabled).toBe(true);

      await cleanup();
    });

    it('maps resources.mode onto registerWithMcp, which is that section’s real switch', async () => {
      const { config, cleanup } = await loadConfigFrom({ resources: { mode: 'off' } });

      expect(config.resources?.registerWithMcp).toBe(false);

      await cleanup();
    });

    it('carries a nested resource disable', async () => {
      const { config, cleanup } = await loadConfigFrom({
        resources: { registerWithMcp: true, logs: { mode: 'off' } },
      });

      expect(config.resources?.logs?.enabled).toBe(false);

      await cleanup();
    });

    it('prefers the canonical key when both are present', async () => {
      const { config, cleanup } = await loadConfigFrom({
        gates: { enabled: true, mode: 'off' },
      });

      expect(config.gates?.enabled).toBe(true);
      expect((config.gates as unknown as Record<string, unknown>).mode).toBeUndefined();

      await cleanup();
    });

    it('leaves the three real modes alone', async () => {
      const { config, cleanup } = await loadConfigFrom({
        telemetry: { mode: 'off' },
        phaseGuards: { mode: 'warn', maxRetries: 2 },
        identity: { mode: 'strict' },
      });

      expect(config.telemetry?.mode).toBe('off');
      expect(config.phaseGuards?.mode).toBe('warn');
      expect((config.identity as unknown as Record<string, unknown>).mode).toBe('strict');

      await cleanup();
    });
  });

  // Same class, different spelling axis — and the direction flipped at 5.0. The 4.x FILE spelled
  // this pair snake_case (which was the RUNTIME `VersioningConfig` name it happened to share);
  // the 5.0 file spells it camelCase, and the loader maps between the two shapes.
  describe('a 4.x snake_case versioning pair translates to camelCase', () => {
    it('translates max_versions and auto_version', async () => {
      const { manager, cleanup } = await loadConfigFrom({
        versioning: { enabled: true, max_versions: 42, auto_version: false },
      });

      expect(manager.getVersioningConfig().maxVersions).toBe(42);
      expect(manager.getVersioningConfig().autoVersion).toBe(false);

      await cleanup();
    });

    it('reads the 5.0 spelling as written, translated or not', async () => {
      const { manager, cleanup } = await loadConfigFrom({
        version: 5,
        versioning: { enabled: true, maxVersions: 42, autoVersion: false },
      });

      expect(manager.getVersioningConfig().maxVersions).toBe(42);
      expect(manager.getVersioningConfig().autoVersion).toBe(false);

      await cleanup();
    });

    it('prefers the canonical 5.0 spelling when both are present', async () => {
      const { manager, cleanup } = await loadConfigFrom({
        versioning: { enabled: true, max_versions: 7, maxVersions: 42 },
      });

      // The 4.x key is consumed and reported, but an explicit 5.0 value is the newer intent and
      // the 4.x one never reached a reader anyway.
      expect(manager.getVersioningConfig().maxVersions).toBe(42);

      await cleanup();
    });
  });

  // The CLI surface itself. Nine `*.mode` keys had a canonical twin already listed beside them in
  // CONFIG_VALID_KEYS, so the dead half is deleted rather than folded. The three real modes stay.
  //
  // The versioning half of this block flipped spelling at 5.0. `CONFIG_VALID_KEYS` is no longer a
  // hand-kept list: it is generated from `ConfigFile`, where the members are `versioning.maxVersions`
  // and `versioning.autoVersion`. The snake_case spellings this block used to assert as canonical
  // were the RUNTIME (`VersioningConfig`) names, which a 4.x file surface happened to share; the
  // file surface and the runtime shape are separate types now, and the loader maps between them.
  describe('CLI settable-key surface', () => {
    it('no longer offers the inert mode spellings', async () => {
      const { CONFIG_VALID_KEYS } =
        await import('../../../../src/cli-shared/config-input-validator.js');

      for (const dead of [
        'gates.mode',
        'frameworks.mode',
        'resources.mode',
        'resources.prompts.mode',
        'resources.gates.mode',
        'resources.frameworks.mode',
        'resources.observability.mode',
        'resources.logs.mode',
        'verification.isolation.mode',
        'analysis.semanticAnalysis.llmIntegration.mode',
        'versioning.mode',
      ]) {
        expect(CONFIG_VALID_KEYS).not.toContain(dead);
      }
    });

    // The positive control for the case above: an assertion that a list does not contain N keys
    // passes just as well against an EMPTY list, so this block would go green if the generated
    // table lost every key. These are the live spellings the same surface must still accept.
    it('offers a canonical replacement for every key it dropped', async () => {
      const { CONFIG_VALID_KEYS, validateConfigInput } =
        await import('../../../../src/cli-shared/config-input-validator.js');

      for (const key of [
        'gates.enabled',
        'frameworks.enabled',
        'resources.registerWithMcp',
        'resources.prompts.enabled',
        'resources.gates.enabled',
        'resources.frameworks.enabled',
        'resources.observability.enabled',
        'resources.logs.enabled',
        'verification.isolation.enabled',
        'versioning.enabled',
        'versioning.autoVersion',
      ]) {
        expect(CONFIG_VALID_KEYS).toContain(key);
        expect(validateConfigInput(key, 'false')).toMatchObject({ valid: true });
      }

      // The one replacement that is not a boolean, so it is asserted with a number rather than
      // 'false'. Its lower bound comes from `@minimum 1` on the `ConfigFile` member.
      expect(CONFIG_VALID_KEYS).toContain('versioning.maxVersions');
      expect(validateConfigInput('versioning.maxVersions', '42')).toMatchObject({
        valid: true,
        convertedValue: 42,
      });
      expect(validateConfigInput('versioning.maxVersions', '0')).toMatchObject({ valid: false });

      // The 4.x file spellings are gone from the settable surface, not merely renamed beside it —
      // a config.json still carrying them is folded by the loader, but nothing can SET them.
      for (const retiredSpelling of ['versioning.max_versions', 'versioning.auto_version']) {
        expect(CONFIG_VALID_KEYS).not.toContain(retiredSpelling);
        expect(validateConfigInput(retiredSpelling, '42')).toMatchObject({ valid: false });
      }
    });

    // The one dropped spelling with NO canonical twin, which is why it is asserted apart from the
    // loop above rather than inside it. `analysis.semanticAnalysis.llmIntegration.mode` was inert
    // like the other nine, but its canonical `enabled` partner has since been retired too: every
    // reader of that section was deleted, so a settable key would write a value nothing consults.
    // The section is still PARSED (a config carrying it keeps loading and gets a deprecation
    // warning) — it is only the setter surface that is withdrawn.
    //
    // Previously asserted on both this surface and a `mcp/tools/config-utils` re-export; ruling
    // R54 (row 4.5) deleted that re-export block — `config-action-handler.ts` already imported
    // `validateConfigInput` from cli-shared directly, so the second surface was a redundant import
    // path onto the same implementation, not a second one to keep in sync. One surface now.
    it('offers no setter for the retired analysis section', async () => {
      const { CONFIG_RESTART_REQUIRED_KEYS, CONFIG_VALID_KEYS, validateConfigInput } =
        await import('../../../../src/cli-shared/config-input-validator.js');

      const retired = [
        'analysis.semanticAnalysis.llmIntegration.enabled',
        'analysis.semanticAnalysis.llmIntegration.endpoint',
        'analysis.semanticAnalysis.llmIntegration.model',
        'analysis.semanticAnalysis.llmIntegration.maxTokens',
        'analysis.semanticAnalysis.llmIntegration.temperature',
      ];

      for (const key of retired) {
        expect(CONFIG_VALID_KEYS).not.toContain(key);
        // Not merely absent from the list — the validator rejects it, which is what a user hits.
        expect(validateConfigInput(key, 'false')).toMatchObject({ valid: false });
      }

      // A restart-required entry naming a key that cannot be set is its own kind of stale.
      expect(CONFIG_RESTART_REQUIRED_KEYS).not.toContain(retired[0]);
    });

    it('keeps the three modes that a reader actually consults', async () => {
      const { CONFIG_VALID_KEYS } =
        await import('../../../../src/cli-shared/config-input-validator.js');

      for (const real of ['telemetry.mode', 'phaseGuards.mode', 'identity.mode']) {
        expect(CONFIG_VALID_KEYS).toContain(real);
      }
    });

    // generateDefaultConfig was the upstream producer: every `cpm init` seeded `gates.mode: 'on'`,
    // so a fresh workspace started out with the spelling nothing reads. Row 4.5 (ruling R46)
    // retired the generator's leaf-by-leaf restatement altogether: code owns every default now, so
    // the generated config — like the shipped `config.json` — holds only the two document-level
    // keys that decide how the file is READ (`$schema`, `version`). Neither is a settable leaf;
    // `CONFIG_VALID_KEYS` deliberately excludes both (`_generated/config-keys.ts`'s own header
    // comment says so), so the walk below skips them at the root instead of asserting they are
    // "valid keys" they were never meant to be. The exact-equality assertion is the anchor a
    // regression back to a populated generator would trip; the walk + loop still guard any
    // settable leaf the generator DOES emit from falling outside the accepted key set.
    it('generates a default config holding only document-level keys, none of them a stale spelling', async () => {
      const { generateDefaultConfig } =
        await import('../../../../src/cli-shared/config-operations.js');
      const { CONFIG_VALID_KEYS } =
        await import('../../../../src/cli-shared/config-input-validator.js');

      const generated = generateDefaultConfig();
      expect(generated).toEqual({ $schema: './config.schema.json', version: 5 });

      const documentLevelKeys = new Set(['$schema', 'version']);
      const leaves: string[] = [];
      const walk = (node: Record<string, unknown>, prefix: string): void => {
        for (const [key, value] of Object.entries(node)) {
          if (prefix === '' && documentLevelKeys.has(key)) continue;
          const full = prefix ? `${prefix}.${key}` : key;
          if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            walk(value as Record<string, unknown>, full);
          } else {
            leaves.push(full);
          }
        }
      };
      walk(generated, '');

      for (const leaf of leaves) {
        expect(CONFIG_VALID_KEYS).toContain(leaf);
      }
    });
  });

  // Removal, not migration: there is nothing to translate the `analysis` section INTO. Its
  // replacement is a different mechanism (the `%judge` modifier), so the 4.x translation drops it
  // and the notice names that replacement. `config.json` is declared public API surface, so a
  // config that still sets it has to keep LOADING — dropping the section is what makes the
  // removal honest instead of merely silent, and the notice is what makes it actionable.
  describe('a 4.x `analysis` section is dropped with one notice', () => {
    let warnSpy: jest.SpiedFunction<typeof console.warn>;

    beforeEach(() => {
      // logger.warn writes through console.warn (infra/logging/index.ts), which is the only
      // externally observable surface — the ConfigLoader's logger is module-private.
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    /**
     * The 4.x translation notice, isolated from every other warning line. Keyed on the sentence
     * only this notice carries — the schema-mismatch lines share the `[CONFIG]` prefix.
     */
    const translationNotices = (): string[] =>
      warnSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('translated to the 5.0 shape'));

    it('drops the section and names it, plus its replacement, in one notice', async () => {
      const { manager, cleanup } = await managerFor({
        analysis: { semanticAnalysis: { llmIntegration: { enabled: true } } },
      });

      const config = await manager.loadConfig();

      // Dropped, not parsed-and-ignored: the deprecation cycle is over and the section resolves
      // to nothing at all. `Config` no longer declares the field, so this checks for the key's
      // absence at runtime rather than reading a typed member.
      expect('analysis' in config).toBe(false);

      const notices = translationNotices();
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain('analysis');
      // Naming the replacement is the point: a removal that only says "stop" reads as breakage.
      expect(notices[0]).toContain('%judge');
      expect(notices[0]).toContain('gates.evaluation.defaultMode');

      await cleanup();
    });

    it('still LOADS a config that carries the section, rather than refusing it', async () => {
      const { manager, cleanup } = await managerFor({
        gates: { enabled: false },
        analysis: { semanticAnalysis: { llmIntegration: { enabled: true, model: 'gpt-4o' } } },
      });

      const config = await manager.loadConfig();

      // `config.json` is declared public API surface: the rest of the file keeps working, which
      // is what makes the dropped section a notice rather than an outage.
      expect(config.gates?.enabled).toBe(false);

      await cleanup();
    });

    it('notices once per process, not once per load', async () => {
      const { manager, cleanup } = await managerFor({
        analysis: { semanticAnalysis: { llmIntegration: { enabled: false } } },
      });

      // File watching re-enters loadConfig on every external edit; a notice that repeats per
      // reload becomes noise the operator filters out, which is how a removal goes unread.
      await manager.loadConfig();
      await manager.loadConfig();
      await manager.loadConfig();

      expect(translationNotices()).toHaveLength(1);

      await cleanup();
    });

    it('stays silent for a `version: 5` file carrying the section', async () => {
      const { manager, cleanup } = await managerFor({
        version: 5,
        analysis: { semanticAnalysis: { llmIntegration: { enabled: true } } },
      });

      await manager.loadConfig();

      // A file that declares its version is never translated, so there is nothing to report —
      // the schema check owns the undeclared `analysis` key from here.
      expect(translationNotices()).toHaveLength(0);

      await cleanup();
    });

    it('stays silent for a 4.x config that never mentions the section', async () => {
      const { manager, cleanup } = await managerFor({ gates: { enabled: true } });

      await manager.loadConfig();

      // Nothing translated and nothing dropped: a user who never wrote a 4.x key has nothing to
      // act on, so a version-less file is not reported merely for being version-less.
      expect(translationNotices()).toHaveLength(0);

      await cleanup();
    });
  });
});

// Row 0.3 (gate-checks-and-reminders): `gates.harnessCovers` and `gates.reminderTokenBudget`
// resolve through `getGatesConfig()`'s `??` fold, same as `enableFrameworkGates` above — these
// pin the default AND the custom-value path, plus a mutation-verified RED on the fold itself.
describe('reminder guidance config (gates.harnessCovers, gates.reminderTokenBudget)', () => {
  it('defaults to [] and 800 when both keys are absent', async () => {
    const { manager, cleanup } = await loadConfigFrom({ gates: { enabled: true } });

    expect(manager.getGatesConfig().harnessCovers).toEqual([]);
    expect(manager.getGatesConfig().reminderTokenBudget).toBe(800);

    await cleanup();
  });

  it('resolves harnessCovers and reminderTokenBudget when both are set', async () => {
    const { manager, cleanup } = await loadConfigFrom({
      gates: { enabled: true, harnessCovers: ['security'], reminderTokenBudget: 300 },
    });

    expect(manager.getGatesConfig().harnessCovers).toEqual(['security']);
    expect(manager.getGatesConfig().reminderTokenBudget).toBe(300);

    await cleanup();
  });

  // POSITIVE CONTROL for the #288 mismatch path: a typo'd key is reported by name, not silently
  // dropped — same AJV `additionalProperties` path config-schema-warning.test.ts pins for
  // `gates.enabld`.
  it('reports a typo of harnessCovers as a schema mismatch naming the bad key', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cfg-harness-typo-'));
    const configPath = path.join(dir, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({ version: 5, gates: { enabled: true, harnessCover: ['security'] } }),
      'utf8'
    );
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const manager = new ConfigLoader(configPath, undefined, { schemaPath: SCHEMA_PATH });
    await manager.loadConfig();

    const validation = manager.getSchemaValidation();
    expect(validation).toMatchObject({ status: 'invalid', valid: false });
    expect(validation?.errors.some((line) => line.includes('harnessCover'))).toBe(true);

    warnSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  });

  // Sibling to the 'persistFrameworkConfig key paths' block above: both new keys must be
  // reachable from `cpm config set`. Previously asserted on both cli-shared and a
  // `mcp/tools/config-utils` re-export; ruling R54 (row 4.5) retired that re-export, so this is
  // the one settable-key surface (`config-action-handler.ts` already read `validateConfigInput`
  // from cli-shared directly, never through this module).
  it('accepts both keys on the settable-key surface', async () => {
    const { CONFIG_VALID_KEYS, validateConfigInput } =
      await import('../../../../src/cli-shared/config-input-validator.js');

    expect(CONFIG_VALID_KEYS).toContain('gates.harnessCovers');
    expect(validateConfigInput('gates.harnessCovers', 'security,testing')).toMatchObject({
      valid: true,
      convertedValue: ['security', 'testing'],
    });

    expect(CONFIG_VALID_KEYS).toContain('gates.reminderTokenBudget');
    expect(validateConfigInput('gates.reminderTokenBudget', '300')).toMatchObject({
      valid: true,
      convertedValue: 300,
    });
  });
});

// Row 2.2 (gate-checks-and-reminders): `gates.executeInlineGateDefinitions` is the opt-in the
// release notes already tell operators to set. It resolved through no fold at all until this row —
// the knob existed only on the engine-side type, so a config.json that set it was refused by the
// schema and read by nobody. These pin the fold, the default, and both settable-key surfaces.
describe('inline gate execution opt-in (gates.executeInlineGateDefinitions)', () => {
  it('resolves an explicit opt-in', async () => {
    const { manager, cleanup } = await loadConfigFrom({
      gates: { enabled: true, executeInlineGateDefinitions: true },
    });

    expect(manager.getGatesConfig().executeInlineGateDefinitions).toBe(true);

    await cleanup();
  });

  it('defaults to false when the key is absent', async () => {
    const { manager, cleanup } = await loadConfigFrom({ gates: {} });

    // False, not undefined: stage 11 reads `=== true`, so an unset key must resolve to the
    // release's stated default rather than to the absence of one.
    expect(manager.getGatesConfig().executeInlineGateDefinitions).toBe(false);

    await cleanup();
  });

  it('passes schema validation, where an unknown gates key does not', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cfg-inline-gates-'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const validate = async (gates: Record<string, unknown>) => {
      const configPath = path.join(dir, `${Object.keys(gates).join('-')}.json`);
      await writeFile(configPath, JSON.stringify({ version: 5, gates }), 'utf8');
      const manager = new ConfigLoader(configPath, undefined, { schemaPath: SCHEMA_PATH });
      await manager.loadConfig();
      return manager.getSchemaValidation();
    };

    expect(await validate({ enabled: true, executeInlineGateDefinitions: true })).toMatchObject({
      status: 'valid',
      valid: true,
    });

    // POSITIVE CONTROL: the check above is only evidence if the same probe rejects a key the
    // schema does not declare — otherwise it would pass against a schema that accepts anything.
    const nonsense = await validate({ enabled: true, nonsenseKey: true });
    expect(nonsense).toMatchObject({ status: 'invalid', valid: false });
    expect(nonsense?.errors.some((line) => line.includes('nonsenseKey'))).toBe(true);

    warnSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  });

  // Previously asserted on both cli-shared and a `mcp/tools/config-utils` re-export; ruling R54
  // (row 4.5) retired that re-export, so this is the one settable-key surface.
  it('is settable on the settable-key surface, unlike an unknown key', async () => {
    const { CONFIG_VALID_KEYS, validateConfigInput } =
      await import('../../../../src/cli-shared/config-input-validator.js');

    expect(CONFIG_VALID_KEYS).toContain('gates.executeInlineGateDefinitions');
    expect(validateConfigInput('gates.executeInlineGateDefinitions', 'true')).toMatchObject({
      valid: true,
      convertedValue: true,
    });

    // POSITIVE CONTROL for the same two calls.
    expect(CONFIG_VALID_KEYS).not.toContain('gates.nonsenseKey');
    expect(validateConfigInput('gates.nonsenseKey', 'true')).toMatchObject({
      valid: false,
    });
  });
});

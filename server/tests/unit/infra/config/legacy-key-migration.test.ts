/**
 * Legacy config key migration.
 *
 * The methodology -> framework vocabulary sweep renamed two config sections and one key. All
 * fail SILENTLY when absent: the old key is read as undefined and the default takes over, so a
 * user who had deliberately turned something off finds it back on with no error emitted. These
 * tests pin the adoption because `tsc` cannot see it — the shape is only bound at load time.
 */

import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { ConfigLoader } from '../../../../src/infra/config/index.js';

async function loadConfigFrom(raw: Record<string, unknown>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cfg-migration-'));
  const configPath = path.join(dir, 'config.json');
  await writeFile(configPath, JSON.stringify(raw), 'utf8');
  const manager = new ConfigLoader(configPath);
  const config = await manager.loadConfig();
  return { config, manager, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe('legacy config key migration', () => {
  describe('top-level methodologies -> frameworks', () => {
    it('adopts the legacy section and drops the old key', async () => {
      const { config, cleanup } = await loadConfigFrom({
        methodologies: { enabled: false, systemPromptFrequency: 7 },
      });

      expect(config.frameworks?.enabled).toBe(false);
      expect(config.frameworks?.systemPromptFrequency).toBe(7);
      expect((config as unknown as Record<string, unknown>).methodologies).toBeUndefined();

      await cleanup();
    });

    it('keeps the canonical section when both are present', async () => {
      const { config, cleanup } = await loadConfigFrom({
        methodologies: { enabled: false },
        frameworks: { enabled: true },
      });

      expect(config.frameworks?.enabled).toBe(true);
      expect((config as unknown as Record<string, unknown>).methodologies).toBeUndefined();

      await cleanup();
    });
  });

  describe('resources.methodologies -> resources.frameworks', () => {
    it('carries a deliberate disable across the rename', async () => {
      const { config, cleanup } = await loadConfigFrom({
        resources: { registerWithMcp: true, methodologies: { enabled: false } },
      });

      expect(config.resources?.frameworks?.enabled).toBe(false);
      expect(
        (config.resources as Record<string, unknown> | undefined)?.methodologies
      ).toBeUndefined();

      await cleanup();
    });

    it('keeps the canonical section when both are present', async () => {
      const { config, cleanup } = await loadConfigFrom({
        resources: { methodologies: { enabled: false }, frameworks: { enabled: true } },
      });

      expect(config.resources?.frameworks?.enabled).toBe(true);

      await cleanup();
    });

    it('leaves resources untouched when neither key is present', async () => {
      const { config, cleanup } = await loadConfigFrom({ resources: { registerWithMcp: true } });

      expect(config.resources?.registerWithMcp).toBe(true);
      expect(
        (config.resources as Record<string, unknown> | undefined)?.methodologies
      ).toBeUndefined();

      await cleanup();
    });
  });

  // NEGATIVE-VERIFY TARGET (plan row 5.2): delete the `gatesConfig.methodologyGates ??` term in
  // ConfigLoader.getGatesConfig and the deliberate-disable case below must fail. Without the fold
  // an operator who set the old key to false silently gets framework gates back on, because the
  // default is true.
  describe('gates.methodologyGates -> gates.frameworkGates', () => {
    it('carries a deliberate disable across the rename', async () => {
      const { manager, cleanup } = await loadConfigFrom({
        gates: { enabled: true, methodologyGates: false },
      });

      expect(manager.getGatesConfig().enableFrameworkGates).toBe(false);

      await cleanup();
    });

    it('reads the canonical key', async () => {
      const { manager, cleanup } = await loadConfigFrom({
        gates: { enabled: true, frameworkGates: false },
      });

      expect(manager.getGatesConfig().enableFrameworkGates).toBe(false);

      await cleanup();
    });

    it('prefers the canonical key when both are present', async () => {
      const { manager, cleanup } = await loadConfigFrom({
        gates: { enabled: true, frameworkGates: true, methodologyGates: false },
      });

      expect(manager.getGatesConfig().enableFrameworkGates).toBe(true);

      await cleanup();
    });

    it('defaults to enabled when neither key is present', async () => {
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

  // The inert `mode` spelling. `cpm enable gates` wrote `gates.mode: "on"` while every runtime
  // reader consulted `gates.enabled`, so the command reported success and changed nothing. The
  // write path assigns dot-keys verbatim (config-operations.ts applyConfigChange), so there was
  // never a translation step — the two spellings simply never met.
  describe('inert `mode` spelling -> canonical boolean', () => {
    it('adopts a deliberate disable written as gates.mode', async () => {
      const { config, cleanup } = await loadConfigFrom({ gates: { mode: 'off' } });

      expect(config.gates?.enabled).toBe(false);
      expect((config.gates as Record<string, unknown> | undefined)?.mode).toBeUndefined();

      await cleanup();
    });

    it('adopts an enable written as the llmIntegration mode', async () => {
      const { config, cleanup } = await loadConfigFrom({
        analysis: { semanticAnalysis: { llmIntegration: { mode: 'on' } } },
      });

      expect(config.analysis?.semanticAnalysis?.llmIntegration?.enabled).toBe(true);
      expect(
        (config.analysis?.semanticAnalysis?.llmIntegration as Record<string, unknown> | undefined)
          ?.mode
      ).toBeUndefined();

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
      expect((config.gates as Record<string, unknown> | undefined)?.mode).toBeUndefined();

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
      expect((config.identity as Record<string, unknown> | undefined)?.mode).toBe('strict');

      await cleanup();
    });
  });

  // Same class, different spelling axis: the CLI accepted camelCase while the runtime read
  // snake_case, so `cpm config set versioning.maxVersions 42` was equally inert.
  describe('camelCase versioning keys -> snake_case', () => {
    it('adopts maxVersions and autoVersion', async () => {
      const { manager, cleanup } = await loadConfigFrom({
        versioning: { enabled: true, maxVersions: 42, autoVersion: false },
      });

      expect(manager.getVersioningConfig().max_versions).toBe(42);
      expect(manager.getVersioningConfig().auto_version).toBe(false);

      await cleanup();
    });

    it('prefers the canonical spelling when both are present', async () => {
      const { manager, cleanup } = await loadConfigFrom({
        versioning: { enabled: true, max_versions: 7, maxVersions: 42 },
      });

      expect(manager.getVersioningConfig().max_versions).toBe(7);

      await cleanup();
    });
  });

  // The CLI surface itself. Nine `*.mode` keys had a canonical twin already listed beside them in
  // CONFIG_VALID_KEYS, so the dead half is deleted rather than folded. The three real modes stay.
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
        'versioning.maxVersions',
        'versioning.autoVersion',
      ]) {
        expect(CONFIG_VALID_KEYS).not.toContain(dead);
      }
    });

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
        'analysis.semanticAnalysis.llmIntegration.enabled',
        'versioning.enabled',
        'versioning.auto_version',
      ]) {
        expect(CONFIG_VALID_KEYS).toContain(key);
        expect(validateConfigInput(key, 'false')).toMatchObject({ valid: true });
      }

      // The one replacement that is not a boolean: `maxVersions` -> `max_versions` kept its
      // numeric 1-500 validation, so it is asserted with a number rather than 'false'.
      expect(CONFIG_VALID_KEYS).toContain('versioning.max_versions');
      expect(validateConfigInput('versioning.max_versions', '42')).toMatchObject({
        valid: true,
        convertedValue: 42,
      });
    });

    it('keeps the three modes that a reader actually consults', async () => {
      const { CONFIG_VALID_KEYS } =
        await import('../../../../src/cli-shared/config-input-validator.js');

      for (const real of ['telemetry.mode', 'phaseGuards.mode', 'identity.mode']) {
        expect(CONFIG_VALID_KEYS).toContain(real);
      }
    });

    // generateDefaultConfig was the upstream producer: every `cpm init` seeded `gates.mode: 'on'`,
    // so a fresh workspace started out with the spelling nothing reads. Pinning it to the
    // validator means the generator cannot drift from the accepted key set again.
    it('generates a default config naming only keys the validator accepts', async () => {
      const { generateDefaultConfig } =
        await import('../../../../src/cli-shared/config-operations.js');
      const { CONFIG_VALID_KEYS } =
        await import('../../../../src/cli-shared/config-input-validator.js');

      const leaves: string[] = [];
      const walk = (node: Record<string, unknown>, prefix: string): void => {
        for (const [key, value] of Object.entries(node)) {
          const full = prefix ? `${prefix}.${key}` : key;
          if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            walk(value as Record<string, unknown>, full);
          } else {
            leaves.push(full);
          }
        }
      };
      walk(generateDefaultConfig(), '');

      expect(leaves.length).toBeGreaterThan(0);
      for (const leaf of leaves) {
        expect(CONFIG_VALID_KEYS).toContain(leaf);
      }
    });
  });
});

/**
 * Legacy config key migration.
 *
 * The methodology -> framework vocabulary sweep renamed two config sections. Both migrations
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
});

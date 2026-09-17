// @lifecycle test - P4.49 falsifier: a loaded style carries its schema defaults.
/**
 * `StyleDefinitionLoader` used to hand back the RAW parsed YAML instead of the schema validator's
 * `validation.data`, so a field the schema defaults — `priority`, `enabled`, `enhancementMode` —
 * was simply `undefined` on any style that did not author it. Validation passed; the defaulted
 * value it computed was thrown away.
 *
 * THIS WAS NOT COSMETIC. `StyleManager.isStyleActive` reads `if (!style.enabled) return false`
 * before checking activation rules. A style that relied on the schema's own `enabled: true`
 * default — every style that never wrote `enabled:` — read as `undefined`, which is falsy, and
 * never auto-activated. The defaulted value the validator computed disagreed with the value the
 * loader actually served.
 *
 * WHY THE TWO FIXTURES DIFFER IN ONLY THE FIELDS UNDER TEST. `defaults_style` omits
 * `priority`/`enabled`/`enhancementMode` entirely; `authored_style` declares all three with
 * non-default values. Everything else — `name`, `description`, `guidance` — is identical prose, so
 * a difference in the assertions below can only be explained by the defaulting behavior, not by
 * some other field the two fixtures happen to differ on.
 *
 * Classification: Integration (real filesystem, real `StyleDefinitionLoader`, real Zod schema).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { StyleDefinitionLoader } from '../../../src/modules/formatting/core/style-definition-loader.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

const TEST_DIR = testScratchPath('style-loader-schema-defaults');

/** Omits `priority`, `enabled`, and `enhancementMode` — the schema must supply all three. */
const DEFAULTS_STYLE_YAML = [
  'id: defaults_style',
  'name: Schema Defaults Style',
  'description: A style that never authored priority, enabled, or enhancementMode.',
  'guidance: Write it plainly.',
  '',
].join('\n');

/** Authors all three fields with values that DIFFER from the schema default, as a control. */
const AUTHORED_STYLE_YAML = [
  'id: authored_style',
  'name: Schema Defaults Style',
  'description: A style that never authored priority, enabled, or enhancementMode.',
  'guidance: Write it plainly.',
  'priority: 7',
  'enabled: false',
  'enhancementMode: append',
  '',
].join('\n');

async function writeStyle(id: string, body: string): Promise<void> {
  const dir = path.join(TEST_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'style.yaml'), body, 'utf-8');
}

describe('a loaded style carries its schema defaults', () => {
  beforeAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
    await writeStyle('defaults_style', DEFAULTS_STYLE_YAML);
    await writeStyle('authored_style', AUTHORED_STYLE_YAML);
  });

  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('fills priority, enabled, and enhancementMode with the schema default when unauthored', () => {
    const loader = new StyleDefinitionLoader({ stylesDir: TEST_DIR, enableCache: false });
    const style = loader.loadStyle('defaults_style');

    expect(style).toBeDefined();
    expect(style?.priority).toBe(0);
    expect(style?.enabled).toBe(true);
    expect(style?.enhancementMode).toBe('prepend');
  });

  it('keeps the authored, non-default values untouched (control)', () => {
    const loader = new StyleDefinitionLoader({ stylesDir: TEST_DIR, enableCache: false });
    const style = loader.loadStyle('authored_style');

    expect(style).toBeDefined();
    expect(style?.priority).toBe(7);
    expect(style?.enabled).toBe(false);
    expect(style?.enhancementMode).toBe('append');
  });
});

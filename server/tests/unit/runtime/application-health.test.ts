import { describe, expect, test } from '@jest/globals';

import { createSimpleLogger } from '../../../src/infra/logging/index.js';
import { Application } from '../../../src/runtime/application.js';

describe('Application health reporting', () => {
  test('returns healthy when core modules and data are present', () => {
    const app = new Application(createSimpleLogger('stdio'));

    // Manually seed minimal state to avoid full startup
    (app as any).logger = createSimpleLogger('stdio');
    (app as any).configManager = { getConfig: () => ({}) };
    (app as any).textReferenceStore = {};
    (app as any).promptManager = {};
    (app as any)._promptsData = [{ id: 'p1', category: 'general' }];
    (app as any)._categories = [{ id: 'general', name: 'General' }];
    (app as any)._convertedPrompts = [{ id: 'p1', category: 'general' }];
    (app as any).mcpToolsManager = {};
    (app as any).transportRouter = { getTransportType: () => 'stdio' };
    (app as any).serverLifecycle = { isRunning: () => true, getStatus: () => ({ running: true }) };

    const health = app.validateHealth();

    expect(health.healthy).toBe(true);
    expect(health.modules.foundation).toBe(true);
    expect(health.modules.dataLoaded).toBe(true);
    expect(health.modules.modulesInitialized).toBe(true);
    expect(health.modules.serverRunning).toBe(true);
    expect(health.details.promptsLoaded).toBe(1);
    expect(health.details.categoriesLoaded).toBe(1);
  });

  /** An app with every module present and the catalog EMPTY, under `list` as `paths.resources`. */
  function emptyCatalogApp(list: readonly string[]): Application {
    const app = new Application(createSimpleLogger('stdio'));
    (app as any).logger = createSimpleLogger('stdio');
    (app as any).configManager = { getConfig: () => ({}) };
    (app as any).textReferenceStore = {};
    (app as any).promptManager = {};
    (app as any)._promptsData = [];
    (app as any)._categories = [];
    (app as any).resourceLocationsInForce = list;
    (app as any).mcpToolsManager = {};
    (app as any).transportRouter = { getTransportType: () => 'stdio' };
    (app as any).serverLifecycle = { isRunning: () => true, getStatus: () => ({ running: true }) };
    return app;
  }

  test('refuses an empty catalog when no paths.resources list is in force', () => {
    const health = emptyCatalogApp([]).validateHealth();

    expect(health.healthy).toBe(false);
    expect(health.issues).toContain('Prompt data not loaded or empty');
  });

  test('starts with an empty catalog when a paths.resources list is in force (R3n)', () => {
    const health = emptyCatalogApp(['/srv/gates-only']).validateHealth();

    expect(health.healthy).toBe(true);
    expect(health.modules.dataLoaded).toBe(true);
    expect(health.details.promptsLoaded).toBe(0);
  });
});

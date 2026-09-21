/**
 * Deleting a resource over `resource_manager` purges its `version_history` rows.
 *
 * It did not, for any of the four resource types, while `cpm delete` did — two surfaces
 * disagreeing about what delete means. `VersionHistoryService.deleteHistory` existed, was
 * doc-commented "Called when a resource is deleted", and had never had a production call site; the
 * three gate/framework/category delete replies said the rows "are NOT removed", and the prompt
 * processor said the same in a comment. The rows were unreachable by any action (rollback resolves
 * the resource first), never reclaimed, and a resource later created under the same id inherited a
 * stranger's history.
 *
 * WHY THIS IS AN ENUMERATION, NOT FOUR CASES. The defect had one shape at four sites, so a test
 * naming the four would not fail for a fifth. The types come from `resourceManagerInputSchema`'s
 * own `resource_type` enum — the published surface — and the payload table is asserted to cover
 * exactly that enum, so a new resource type is a red test in this file until its delete purges too.
 *
 * SCOPE, and the edge this deliberately does not close. `version_history` rows are keyed by a
 * tenant id, and the server and `cpm` still derive different ids for one workspace (#341 added
 * `resolveEffectiveTenantId` on the CLI side to READ across that gap, it did not unify it). So
 * every row asserted here is written through the MCP surface and purged through it. **Rows `cpm`
 * wrote under a different tenant key are not purged by an MCP delete — that closes with the
 * tutorial plan's row B.89 (server persists its resolved scope).**
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { resourceManagerInputSchema } from '../../src/mcp/tools/schemas/resource-manager.schema.js';
import {
  getAvailablePort,
  killServer,
  startServerWithHttp,
  StreamableHttpMcpClient,
  waitForHealth,
} from './helpers/http-mcp-client.js';

interface TypeCase {
  create: (id: string) => Record<string, unknown>;
  update: (id: string, marker: string) => Record<string, unknown>;
  delete: (id: string) => Record<string, unknown>;
}

const CASES: Record<string, TypeCase> = {
  prompt: {
    create: (id) => ({
      resource_type: 'prompt',
      action: 'create',
      id,
      category: 'general',
      name: `Purge ${id}`,
      description: 'V1',
      user_message_template: 'V1-BODY',
    }),
    update: (id, marker) => ({
      resource_type: 'prompt',
      action: 'update',
      id,
      description: marker,
    }),
    delete: (id) => ({ resource_type: 'prompt', action: 'delete', id, confirm: true }),
  },
  gate: {
    create: (id) => ({
      resource_type: 'gate',
      action: 'create',
      id,
      name: `Purge ${id}`,
      description: 'V1',
      guidance: 'V1-GUIDANCE',
      type: 'validation',
      severity: 'medium',
    }),
    update: (id, marker) => ({ resource_type: 'gate', action: 'update', id, description: marker }),
    delete: (id) => ({ resource_type: 'gate', action: 'delete', id, confirm: true }),
  },
  framework: {
    create: (id) => ({
      resource_type: 'framework',
      action: 'create',
      id,
      name: `Purge ${id}`,
      description: 'V1',
      system_prompt_guidance: 'V1-GUIDANCE',
      phases: [{ id: 'p1', name: 'P1', description: 'only phase' }],
      framework_gates: [
        {
          id: `${id}-gate`,
          name: 'Purge gate',
          description: 'Validates the only phase',
          frameworkArea: 'p1',
          priority: 'high',
          validationCriteria: ['purge criterion'],
        },
      ],
    }),
    update: (id, marker) => ({
      resource_type: 'framework',
      action: 'update',
      id,
      description: marker,
    }),
    delete: (id) => ({ resource_type: 'framework', action: 'delete', id, confirm: true }),
  },
  category: {
    create: (id) => ({
      resource_type: 'category',
      action: 'create',
      id,
      name: `Purge ${id}`,
      description: 'V1',
    }),
    update: (id, marker) => ({
      resource_type: 'category',
      action: 'update',
      id,
      description: marker,
    }),
    delete: (id) => ({ resource_type: 'category', action: 'delete', id, confirm: true }),
  },
};

/**
 * The resource types the tool actually publishes — the enumeration this file is built on.
 *
 * Read off the registered schema rather than a list in this file, because the schema is what the
 * router dispatches on. `z.enum` exposes its members as an object on `.enum`; its keys ARE the
 * values, and reading them that way survives the `_def` reshuffles zod has had between majors.
 */
const PUBLISHED_TYPES: readonly string[] = Object.keys(
  (
    resourceManagerInputSchema as unknown as {
      shape: { resource_type: { enum: Record<string, string> } };
    }
  ).shape.resource_type.enum
);

describe('resource_manager delete purges version_history (Streamable HTTP)', () => {
  let proc: ChildProcess | null = null;
  let client: StreamableHttpMcpClient | null = null;
  let workspace = '';
  let dbPath = '';
  let requestId = 1;

  /** Calls the tool and THROWS the server's own text on an error reply, so a failure names why. */
  const callToolOk = async (args: Record<string, unknown>): Promise<string> => {
    const reply = await callTool(args);
    if (reply.isError) {
      throw new Error(`${String(args['action'])} ${String(args['resource_type'])}: ${reply.text}`);
    }
    return reply.text;
  };

  const callTool = async (
    args: Record<string, unknown>
  ): Promise<{ isError: boolean; text: string }> => {
    if (!client) throw new Error('client not initialized');
    const result = (await client.request(
      'tools/call',
      { name: 'resource_manager', arguments: args },
      ++requestId
    )) as { isError?: boolean; content?: Array<{ text?: string }> };
    return {
      isError: result.isError === true,
      text: (result.content ?? []).map((part) => part.text ?? '').join('\n'),
    };
  };

  /** Rows the MCP surface wrote for one resource, whatever tenant the server resolved. */
  const rowsFor = (resourceType: string, resourceId: string): number[] => {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return (
        db
          .prepare(
            `SELECT version FROM version_history
             WHERE resource_type = ? AND resource_id = ? ORDER BY version`
          )
          .all(resourceType, resourceId) as unknown as Array<{ version: number }>
      ).map((row) => row.version);
    } finally {
      db.close();
    }
  };

  beforeAll(async () => {
    const port = await getAvailablePort();
    const baseUrl = `http://localhost:${port}`;
    workspace = await mkdtemp(path.join(tmpdir(), 'delete-purge-ws-'));
    dbPath = path.join(workspace, 'runtime-state', 'state.db');
    proc = startServerWithHttp(port, {
      transport: 'streamable-http',
      env: { MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: workspace },
    });
    await waitForHealth(baseUrl, { timeout: 20000, interval: 200 });
    client = new StreamableHttpMcpClient(baseUrl);
    await client.initialize();
  }, 60000);

  afterAll(async () => {
    if (proc) await killServer(proc);
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it('covers every resource type the tool publishes', () => {
    // The enumeration guard: a new member of the published union with no payload here would
    // otherwise be silently skipped by every case below, which is how a four-site defect survives.
    expect(Object.keys(CASES).sort()).toEqual([...PUBLISHED_TYPES].sort());
  });

  for (const type of Object.keys(CASES)) {
    const spec = CASES[type] as TypeCase;

    it(`purges the history of a deleted ${type} and does not touch a sibling`, async () => {
      const id = `purge_${type}_subject`;
      const sibling = `purge_${type}_sibling`;

      for (const target of [id, sibling]) {
        await callToolOk(spec.create(target));
        await callToolOk(spec.update(target, 'V2'));
      }

      // Positive control for the probe: rows exist to be purged, so a count of 0 afterwards
      // measures the purge rather than a resource that never had history.
      expect(rowsFor(type, id).length).toBeGreaterThanOrEqual(2);
      const siblingBefore = rowsFor(type, sibling);
      expect(siblingBefore.length).toBeGreaterThanOrEqual(2);

      // A PREVIEW purges nothing.
      await callToolOk({ ...spec.delete(id), action: 'preview', preview_action: 'delete' });
      expect(rowsFor(type, id).length).toBeGreaterThanOrEqual(2);

      const deletedText = await callToolOk(spec.delete(id));
      expect(deletedText).toContain('Version history purged');

      expect(rowsFor(type, id)).toEqual([]);
      // Control: the sibling's rows are untouched, so the purge is scoped to the id it named.
      expect(rowsFor(type, sibling)).toEqual(siblingBefore);

      // Re-creating the same id starts a fresh history rather than inheriting the old one.
      await callToolOk(spec.create(id));
      await callToolOk(spec.update(id, 'V2-AGAIN'));
      expect(rowsFor(type, id)[0]).toBe(1);
    }, 60000);
  }
});

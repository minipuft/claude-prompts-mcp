/**
 * A rollback puts the recorded BYTES back, never deletes a file, and previews exactly what it does.
 *
 * Driven through real `tools/call` against a real Streamable HTTP server, over fixtures whose
 * decisive bytes are HAND-AUTHORED rather than written by the code under test. That distinction is
 * the whole design of this file: a fixture the writer produced can only ever prove idempotence —
 * the writer would regenerate the same file it made — while a byte-order mark, CRLF line endings, a
 * leading comment and a non-ASCII character are exactly what a projection-based restore destroys
 * and what nothing in the writer would put back.
 *
 * Every byte claim is a digest comparison computed here, from the bytes read off disk, against the
 * digest of the bytes this test wrote. It never asks the server what it thinks it restored.
 *
 * WHAT EACH CASE PROVES
 *  - gate: a hand-written `guidance.md` carrying a BOM, CRLF and `café ☕` comes back identical
 *    after being destroyed; the hand-authored comment at the top of `gate.yaml` survives; and a
 *    preview of the same rollback prints the SAME plan the apply ran.
 *  - prompt with `tools/`: a script tool's files come back — the P4.83 claim — and a tool added
 *    AFTER the target version is kept on disk and named in the reply, never deleted (ruling R57).
 *    Its absence from the target tree is the positive control for that claim.
 *  - chain with `edges`: `edges` is restored because the FILE is, not because a projection learned
 *    to carry it.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { hashBytes } from '../../src/shared/utils/hash.js';
import { parseYamlOrThrow } from '../../src/shared/utils/yaml/index.js';
import {
  getAvailablePort,
  killServer,
  startServerWithHttp,
  StreamableHttpMcpClient,
  waitForHealth,
} from './helpers/http-mcp-client.js';

/**
 * The bytes no writer in this repository would ever produce.
 *
 * A BOM, CRLF endings, a non-ASCII character, a trailing space, an empty line — and one byte
 * that is not valid UTF-8 at all. The last one was added after a mutation came back GREEN: a
 * restore that decodes to a string and re-encodes is LOSSLESS for everything above it, so without
 * a byte that cannot survive a text round trip, "written verbatim" was being asserted by a fixture
 * a text path would also have passed. `0x80` is a continuation byte with no lead, so
 * `Buffer.toString('utf8')` replaces it with U+FFFD and nothing puts it back.
 */
const HAND_AUTHORED_GUIDANCE = Buffer.concat([
  Buffer.from('﻿# Guidance — café ☕\r\n\r\nLine with a trailing space ', 'utf8'),
  Buffer.from([0x80]),
  Buffer.from('\r\nEnd.\r\n', 'utf8'),
]);

const HAND_COMMENT = '# hand-authored: this comment must survive a rollback — café ☕\n';

interface Observed {
  previewText: string;
  applyText: string;
}

describe('byte-exact rollback (Streamable HTTP)', () => {
  let proc: ChildProcess | null = null;
  let client: StreamableHttpMcpClient | null = null;
  let workspace = '';
  let requestId = 1;

  const gate: Observed = { previewText: '', applyText: '' };
  let gateGuidanceAfter: Buffer;
  let gateYamlAfter: string;

  let promptToolScriptAfter: Buffer;
  let promptExtraToolExists = false;
  let promptRollbackText = '';
  let promptSystemMessageMtimeBefore = 0;
  let promptSystemMessageMtimeAfter = 0;

  let chainEdgesAfter: unknown;

  const callTool = async (
    name: string,
    args: Record<string, unknown>
  ): Promise<{ isError: boolean; text: string }> => {
    if (!client) throw new Error('client not initialized');
    const result = (await client.request('tools/call', { name, arguments: args }, ++requestId)) as {
      isError?: boolean;
      content?: Array<{ text?: string }>;
    };
    return {
      isError: result.isError === true,
      text: (result.content ?? []).map((part) => part.text ?? '').join('\n'),
    };
  };

  const mustCall = async (args: Record<string, unknown>): Promise<string> => {
    const result = await callTool('resource_manager', args);
    if (result.isError) {
      throw new Error(`resource_manager ${JSON.stringify(args)}: ${result.text}`);
    }
    return result.text;
  };

  beforeAll(async () => {
    const port = await getAvailablePort();
    const baseUrl = `http://localhost:${port}`;
    workspace = await mkdtemp(path.join(tmpdir(), 'byte-exact-rollback-ws-'));
    proc = startServerWithHttp(port, {
      transport: 'streamable-http',
      env: { MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: workspace },
    });
    await waitForHealth(baseUrl, { timeout: 20000, interval: 200 });
    client = new StreamableHttpMcpClient(baseUrl);
    await client.initialize();

    await driveGate();
    await drivePromptWithTools();
    await driveChainEdges();
  }, 180000);

  afterAll(async () => {
    if (proc) await killServer(proc);
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  // ── gate ────────────────────────────────────────────────────────────────────

  async function driveGate(): Promise<void> {
    const id = 'byte_gate';
    const dir = path.join(workspace, 'resources', 'gates', id);
    const yamlPath = path.join(dir, 'gate.yaml');
    const guidancePath = path.join(dir, 'guidance.md');

    await mustCall({
      resource_type: 'gate',
      action: 'create',
      id,
      name: 'Byte Gate',
      description: 'V1-DESC',
      guidance: 'placeholder',
      type: 'validation',
    });

    // The hand-authored bytes go in HERE, after the writer has had its say. Everything the
    // assertions below turn on was written by this test, not by the code under test.
    await writeFile(yamlPath, HAND_COMMENT + (await readFile(yamlPath, 'utf8')), 'utf8');
    await writeFile(guidancePath, HAND_AUTHORED_GUIDANCE);

    // A `description`-only update is scoped to `gate.yaml` and rewrites it through the
    // source-preserving writer, so the comment stays and `guidance.md` is not opened at all. The
    // row this records therefore carries exactly the hand-authored bytes.
    const targetVersion = savedVersion(
      await mustCall({ resource_type: 'gate', action: 'update', id, description: 'V2-DESC' })
    );

    // Destroy both, out of band, then roll back to the version that recorded them.
    await writeFile(guidancePath, 'DESTROYED\n', 'utf8');
    await mustCall({ resource_type: 'gate', action: 'update', id, description: 'V3-DESC' });

    gate.previewText = await mustCall({
      resource_type: 'gate',
      action: 'preview',
      preview_action: 'rollback',
      id,
      version: targetVersion,
    });
    gate.applyText = await mustCall({
      resource_type: 'gate',
      action: 'rollback',
      id,
      version: targetVersion,
      confirm: true,
    });

    gateGuidanceAfter = await readFile(guidancePath);
    gateYamlAfter = await readFile(yamlPath, 'utf8');
  }

  // ── prompt with script tools ────────────────────────────────────────────────

  async function drivePromptWithTools(): Promise<void> {
    const id = 'byte_prompt';
    const dir = path.join(workspace, 'resources', 'prompts', 'general', id);

    await mustCall({
      resource_type: 'prompt',
      action: 'create',
      id,
      category: 'general',
      name: 'Byte Prompt',
      description: 'V1-DESC',
      user_message_template: 'V1-BODY',
      system_message: 'V1-SYS',
    });

    await writeToolDirectory(path.join(dir, 'tools', 'probe'), 'probe', 'print("v2 ☕")\n');
    const targetVersion = savedVersion(
      await mustCall({ resource_type: 'prompt', action: 'update', id, description: 'V2-DESC' })
    );

    const scriptPath = path.join(dir, 'tools', 'probe', 'probe.py');
    const recorded = await readFile(scriptPath);

    // Destroy the recorded tool, and add a SECOND tool that the target version never saw.
    await writeFile(scriptPath, 'print("destroyed")\n', 'utf8');
    await writeToolDirectory(path.join(dir, 'tools', 'extra'), 'extra', 'print("added later")\n');

    const systemMessagePath = path.join(dir, 'system-message.md');
    promptSystemMessageMtimeBefore = (await stat(systemMessagePath)).mtimeMs;

    promptRollbackText = await mustCall({
      resource_type: 'prompt',
      action: 'rollback',
      id,
      version: targetVersion,
      confirm: true,
    });

    promptToolScriptAfter = await readFile(scriptPath);
    promptExtraToolExists = await exists(path.join(dir, 'tools', 'extra', 'tool.yaml'));
    promptSystemMessageMtimeAfter = (await stat(systemMessagePath)).mtimeMs;
    // The recorded bytes this test wrote, kept for the digest comparison below.
    expect(recorded.toString('utf8')).toContain('v2 ☕');
  }

  // ── chain with edges ────────────────────────────────────────────────────────

  async function driveChainEdges(): Promise<void> {
    const id = 'byte_chain';
    const dir = path.join(workspace, 'resources', 'prompts', 'general', id);

    await mustCall({
      resource_type: 'prompt',
      action: 'create',
      id,
      category: 'general',
      name: 'Byte Chain',
      description: 'V1-DESC',
      user_message_template: 'Chain body',
      chain_steps: [
        { promptId: 'byte_prompt', stepName: 'first' },
        { promptId: 'byte_prompt', stepName: 'second' },
      ],
    });
    const targetVersion = savedVersion(
      await mustCall({ resource_type: 'prompt', action: 'update', id, description: 'V2-DESC' })
    );

    // Out-of-band: strip the chain wiring the version recorded.
    const yamlPath = path.join(dir, 'prompt.yaml');
    const stripped = (await readFile(yamlPath, 'utf8'))
      .split('\n')
      .filter((line) => !line.includes('stepName') && !line.includes('promptId'))
      .join('\n');
    await writeFile(yamlPath, stripped, 'utf8');

    await mustCall({
      resource_type: 'prompt',
      action: 'rollback',
      id,
      version: targetVersion,
      confirm: true,
    });

    chainEdgesAfter = parseYamlOrThrow<Record<string, unknown>>(await readFile(yamlPath, 'utf8'))[
      'chainSteps'
    ];
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  async function writeToolDirectory(dir: string, id: string, script: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'tool.yaml'),
      `# hand-authored tool\nid: ${id}\nname: ${id}\nscript: ${id}.py\nruntime: python\n`,
      'utf8'
    );
    await writeFile(path.join(dir, `${id}.py`), script, 'utf8');
    await writeFile(path.join(dir, 'schema.json'), '{\n  "type": "object"\n}\n', 'utf8');
    await writeFile(path.join(dir, 'description.md'), `# ${id}\n`, 'utf8');
  }

  /**
   * The version an update's own receipt says it saved.
   *
   * Read from the reply rather than hardcoded: a bridge row for an out-of-band edit shifts the
   * numbering by one, so a literal would make these cases pass or fail on bookkeeping instead of
   * on bytes. The history table is not usable for this — it renders the row DESCRIPTION
   * ("Update via resource_manager"), which is the same for every update.
   */
  function savedVersion(replyText: string): number {
    const match = /Version\*{0,2}\s+\*{0,2}(\d+)/.exec(replyText);
    if (match?.[1] === undefined) {
      throw new Error(`no version number in receipt:\n${replyText}`);
    }
    return Number(match[1]);
  }

  async function exists(target: string): Promise<boolean> {
    try {
      await stat(target);
      return true;
    } catch {
      return false;
    }
  }

  // ── assertions ──────────────────────────────────────────────────────────────

  it('restores a hand-written guidance.md byte for byte, BOM and CRLF included', () => {
    // Digests computed here from the bytes this test wrote and the bytes now on disk. The server
    // is never asked what it thinks it restored.
    expect(hashBytes(gateGuidanceAfter)).toBe(hashBytes(HAND_AUTHORED_GUIDANCE));
  });

  it('keeps the hand-authored comment and the target version content in gate.yaml', () => {
    expect(gateYamlAfter.startsWith(HAND_COMMENT)).toBe(true);
    expect(gateYamlAfter).toContain('V2-DESC');
    // Positive control for the assertion above: the state being replaced was V3, so a rollback
    // that did nothing would leave V3-DESC here and still keep the comment.
    expect(gateYamlAfter).not.toContain('V3-DESC');
  });

  it('previews exactly the plan it applies', () => {
    // ONE value, compared as one value: the file-plan block the preview prints is the same block
    // the reply prints, because both render the same `RestorePlan` through the same function.
    // Both replies compose the plan as its own blank-line-separated block, so the block is
    // extracted the same way from each and compared whole. Slicing to a trailing marker instead
    // would silently include the reply's own record line and compare two different things.
    const planBlock = (text: string): string => {
      const block = text.split('\n\n').find((part) => part.includes('📄'));
      expect(block).toBeDefined();
      return block ?? '';
    };
    expect(planBlock(gate.previewText)).toBe(planBlock(gate.applyText));
    expect(gate.previewText).toContain('Nothing was written');
    expect(gate.applyText).toContain('byte for byte');
  });

  it('restores a script tool under tools/ — the P4.83 claim', () => {
    expect(promptToolScriptAfter.toString('utf8')).toBe('print("v2 ☕")\n');
  });

  it('keeps a tool added after the target version, and names it in the reply', () => {
    // R57: a restore never deletes. The positive control is that `tools/extra/` was created AFTER
    // the target version was recorded, so it is provably absent from that version's tree — which
    // is exactly why a delete-on-restore would have removed it.
    expect(promptExtraToolExists).toBe(true);
    expect(promptRollbackText).toContain('Left in place');
    expect(promptRollbackText).toContain('tools/extra/tool.yaml');
  });

  it('does not touch a file whose recorded bytes already match', () => {
    // `system-message.md` was never edited, so its hash equals the recorded one and the plan puts
    // it in `unchanged` — which means no write, so not even the mtime moves.
    expect(promptSystemMessageMtimeAfter).toBe(promptSystemMessageMtimeBefore);
  });

  it("restores a chain's steps because the file comes back, not a projection", () => {
    expect(Array.isArray(chainEdgesAfter)).toBe(true);
    expect(JSON.stringify(chainEdgesAfter)).toContain('second');
  });
});

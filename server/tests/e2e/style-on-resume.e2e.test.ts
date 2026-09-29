// @lifecycle test - P6.277 / R162 (amended): a resume's render carries the selected STYLE guidance where the rendered step's style decision injects it, over Streamable HTTP.
/**
 * MEASURED 2026-09-29 on `7a3b34d20` (driven, hermetic, shipped CAGEERF): `#analytical` on an
 * arrow-chain of three `analysis` prompts, each with an author system message, config
 * `systemPrompt.frequency 1`. With `styleGuidance.frequency 1` (every step) the system prompt
 * rendered on each resume's render and the analytical style guidance never did: stage 15 applies
 * style, and it skips every resume. A fix at stage 15 lands one step late (P6.277 handoff,
 * slice 33), because stage 15 runs before stage 16 re-decides for the rendered step.
 *
 * Now the renderer appends the style where it reads the system prompt's decision: the step render,
 * from the rendered step's STYLE decision (R151, stage 16's `redecideAt`). Every assertion here
 * reads the STYLE injection type; the system prompt is recorded beside it as the sibling it follows.
 */
import { afterAll, describe, expect, test } from '@jest/globals';

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { cageerfAnswer } from './helpers/cageerf-answer.js';
import { createHermeticRoots } from './helpers/child-env.js';
import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  startServerWithHttp,
  waitForHealth,
} from './helpers/http-mcp-client.js';

const PASS = 'GATE_REVIEW: PASS - ok';
/** Assembled, so no command literal in this file carries the operator as prose. */
const ARROW = ' -' + '-> ';
/** The first line of the bundled `analytical` style's guidance. */
const ANALYTICAL_STYLE = 'Structure your response with systematic analysis';
const PROMPTS = ['p277_a', 'p277_b', 'p277_c'];

interface ResumeRender {
  body: string;
  /** The analytical style, on the `**Response Style:**` line the render appends. */
  style: boolean;
  /** Any style line at all: a control asserts the whole class absent, not one member. */
  anyStyle: boolean;
  systemPrompt: boolean;
}

const cleanup: Array<() => void | Promise<void>> = [];
afterAll(async () => {
  for (const step of cleanup.reverse()) await step();
});

/** A hermetic server whose workspace config sets the style-guidance frequency. */
async function serverWithStyleFrequency(frequency: number) {
  const roots = createHermeticRoots(`style-on-resume-f${frequency}`);
  cleanup.push(roots.cleanup);
  const workspace = path.join(roots.root, 'workspace');
  mkdirSync(workspace, { recursive: true });
  writeFileSync(
    path.join(workspace, 'config.json'),
    JSON.stringify({
      frameworks: {
        injection: { systemPrompt: { frequency: 1 }, styleGuidance: { frequency } },
      },
    })
  );
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const proc = startServerWithHttp(port, {
    env: { HOME: roots.home, MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: roots.runtimeRoot },
  });
  cleanup.push(() => killServer(proc));
  await waitForHealth(baseUrl, { timeout: 45000, interval: 200 });
  const client = new ModernMcpClient(baseUrl, `style-on-resume-f${frequency}`);
  let nextId = 1;
  const call = async (args: Record<string, unknown>): Promise<string> => {
    const outcome = await client.callToolWithNotifications('prompt_engine', args, nextId++);
    const result = outcome.result as { content?: Array<{ text?: string }> } | undefined;
    return (result?.content ?? []).map((part) => part.text ?? '').join('\n');
  };
  for (const id of PROMPTS) {
    const outcome = await client.callToolWithNotifications(
      'resource_manager',
      {
        resource_type: 'prompt',
        action: 'create',
        id,
        category: 'analysis',
        name: id,
        description: `e2e step ${id}`,
        system_message: `SYSMSG-${id}`,
        user_message_template: `BODY-${id}`,
        gate_configuration: { framework_gates: false },
      },
      nextId++
    );
    const result = outcome.result as { isError?: boolean } | undefined;
    if (result?.isError === true) throw new Error(`could not create ${id}`);
  }
  return call;
}

/** The two resume renders (steps 2 and 3) of `#analytical` over the three prompts, each after a PASS. */
async function resumeRenders(frequency: number): Promise<ResumeRender[]> {
  const call = await serverWithStyleFrequency(frequency);
  const first = await call({
    command: `#analytical ${PROMPTS.map((id) => `>>${id}`).join(ARROW)}`,
  });
  const chainId = /chain_id[=:] ?"(chain-[A-Za-z0-9_#-]+)"/.exec(first)?.[1];
  if (chainId === undefined) throw new Error(`no chain id in: ${first.slice(0, 400)}`);
  const renders: ResumeRender[] = [];
  for (const step of ['one', 'two']) {
    const text = await call({
      chain_id: chainId,
      user_response: cageerfAnswer(`step ${step}`),
      gate_verdict: PASS,
    });
    renders.push({
      body: /BODY-p277_[abc]/.exec(text)?.[0] ?? 'none',
      style: text.includes(`**Response Style:** ${ANALYTICAL_STYLE}`),
      anyStyle: text.includes('**Response Style:**'),
      systemPrompt: text.includes('Framework Active'),
    });
  }
  return renders;
}

describe('Streamable HTTP: style guidance on a resume follows the rendered step (P6.277)', () => {
  test('style: a PASS resume renders the selected style when its frequency injects every step', async () => {
    expect(await resumeRenders(1)).toEqual([
      { body: 'BODY-p277_b', style: true, anyStyle: true, systemPrompt: true },
      { body: 'BODY-p277_c', style: true, anyStyle: true, systemPrompt: true },
    ]);
  }, 180000);

  test('style: every 2nd step is decided for the rendered step, not the answered one', async () => {
    // Step 2 skips, step 3 injects. Deciding for the answered step (the stage 15 site) swaps them.
    expect(
      (await resumeRenders(2)).map(({ body, style, anyStyle }) => ({ body, style, anyStyle }))
    ).toEqual([
      { body: 'BODY-p277_b', style: false, anyStyle: false },
      { body: 'BODY-p277_c', style: true, anyStyle: true },
    ]);
  }, 180000);

  test('control: style at first step only renders no style on a resume', async () => {
    // The system prompt, at every step, still renders on both: the renders are live.
    expect(await resumeRenders(0)).toEqual([
      { body: 'BODY-p277_b', style: false, anyStyle: false, systemPrompt: true },
      { body: 'BODY-p277_c', style: false, anyStyle: false, systemPrompt: true },
    ]);
  }, 180000);
});

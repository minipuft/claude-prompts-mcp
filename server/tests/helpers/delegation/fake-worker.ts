// @lifecycle test - The conformance standard for a delegated worker's reply: brief in, trailer out.
/**
 * A delegated step's worker is a spawned agent no test can observe, so every delegation test that
 * needs "what a conforming worker sends back" would otherwise hand-write a trailer — and each
 * hand-written one is a private guess at the contract. This helper is the single guess: it reads
 * the RENDERED brief, takes the token the server printed there, and echoes it back in the block
 * the brief asked for.
 *
 * Reading the brief rather than accepting a token argument is the point. A test that passes the
 * token in can pass the WRONG token in and still go green; this one can only produce a reply the
 * brief itself justified, so a brief that stops printing a node line makes every accept-path test
 * fail loudly instead of silently testing nothing.
 */

import {
  HANDOFF_RESULT_HEADING,
  PROPOSED_GATE_REVIEW_TOKEN,
} from '../../../src/engine/execution/delegation/handoff-contract.js';
import { QUALITY_GATES_HEADING } from '../../../src/engine/execution/delegation/brief.js';

/** The `node:` line the brief's Result Contract printed, or null when it printed none. */
function nodeTokenInBrief(brief: string): string | null {
  const match = /^node:\s*(\S+)\s*$/m.exec(brief);
  return match?.[1] ?? null;
}

/** Options a test uses to make the fake worker misbehave in ONE specific way. */
export interface FakeWorkerOptions {
  /** Echo this token instead of the brief's — the wrong-node path. */
  readonly overrideToken?: string;
  /** Omit the trailer entirely — the prose-only path a positive control needs. */
  readonly omitTrailer?: boolean;
  /** Body text the worker "produced". */
  readonly body?: string;
}

/**
 * Run the fake worker against a rendered brief, returning the reply a parent would paste back as
 * `user_response`.
 *
 * The gate lines are emitted only when the brief carried a `### Quality Gates` section, which is
 * the same condition `buildHandoffResultSection` renders its gate instruction under — so the
 * worker answers exactly what it was asked and nothing more.
 *
 * @throws when the brief carries no node line and no override was supplied. A silent fallback
 *   would let an accept-path test pass against a brief that printed no contract at all.
 */
export function runFakeWorker(brief: string, options: FakeWorkerOptions = {}): string {
  const token = options.overrideToken ?? nodeTokenInBrief(brief);
  if (token === null) {
    throw new Error(
      'runFakeWorker: the brief carries no `node:` line — nothing to echo. The Result Contract ' +
        'section is missing, which is a server-side defect, not a test-input problem.'
    );
  }

  const body = options.body ?? 'Reviewed the draft. The argument holds and the evidence is named.';
  if (options.omitTrailer === true) {
    return body;
  }

  const lines = [body, '', '```', HANDOFF_RESULT_HEADING, `node: ${token}`];
  if (brief.includes(QUALITY_GATES_HEADING)) {
    lines.push(PROPOSED_GATE_REVIEW_TOKEN, '- step-quality: PASS — the output names its evidence');
  }
  lines.push('```');
  return lines.join('\n');
}

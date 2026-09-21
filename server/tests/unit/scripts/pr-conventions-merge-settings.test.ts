/**
 * The merge-settings step in `pr-conventions.yml`, driven against synthetic commit histories.
 *
 * WHY THIS EXISTS. That step has been wrong twice, in opposite directions, and neither failure
 * was reachable by any local gate:
 *
 *   · 2026-09-02 (#259) — its first version read the repository's merge settings directly. Those
 *     fields are admin-only and the workflow token is not admin, so all three read `undefined`
 *     and the step failed on its own pull request. A probe that cannot observe stood as a gate.
 *   · 2026-09-08 (#269) — the effect-based replacement was a REQUIRED failing check whose subject
 *     is the newest squash commit on `main`. No pull request controls that, and only a merge
 *     changes it, so one overriding merge left every later PR `MERGEABLE / BLOCKED` and clearing
 *     it took an admin bypass. It also blamed a repository setting that had never drifted.
 *
 * Both are logic defects in a script that lives inside YAML, where nothing type-checks it and no
 * suite runs it. This test extracts the step's script from the workflow file itself — so it cannot
 * drift from what CI executes — wraps it the way `actions/github-script` does, and drives it with
 * doubles for `github`, `context` and `core`.
 *
 * The load-bearing assertions are the two that encode the failures above: the step must NEVER call
 * `core.setFailed`, and it must tell a one-off overriding merge apart from a drifted setting. They
 * differ in blast radius — drift strips every squash after it, an override strips exactly one —
 * which is the only evidence available to a non-admin observer.
 *
 * Classification: Unit (no network, no filesystem writes; reads two repo files)
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, beforeAll } from '@jest/globals';

import { parseYamlOrThrow } from '../../../src/shared/utils/yaml/yaml-parser.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/pr-conventions.yml');
const STEP_NAME = 'Assert the merge-settings contract by its effect';

interface WorkflowFile {
  jobs: Record<string, { steps: { name?: string; with?: { script?: string } }[] }>;
}

/** Capture of everything the step reported, so a test can assert on channel as well as content. */
interface CoreCapture {
  info: string[];
  warning: string[];
  failed: string[];
}

type StepFn = (
  github: unknown,
  context: unknown,
  core: {
    info: (_m: string) => void;
    warning: (_m: string) => void;
    setFailed: (_m: string) => void;
  }
) => Promise<void>;

/**
 * `actions/github-script` evaluates the script body inside an async function with `github`,
 * `context` and `core` in scope, which is why the body may `return` at top level. Reproduced here
 * rather than approximated — a wrapper that differed would test a different program.
 */
function loadStep(): StepFn {
  const workflow = parseYamlOrThrow<WorkflowFile>(readFileSync(WORKFLOW, 'utf8'));
  const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
  const step = steps.find((candidate) => candidate.name === STEP_NAME);
  if (step?.with?.script === undefined) {
    throw new Error(
      `No step named "${STEP_NAME}" with a script in ${WORKFLOW}. If it was renamed, rename it ` +
        'here too — a silently skipped extraction would make every assertion below vacuous.'
    );
  }
  return new Function(
    'github',
    'context',
    'core',
    `return (async () => { ${step.with.script} })();`
  ) as StepFn;
}

function commit(sha: string, subject: string, body: string) {
  return { sha, commit: { message: `${subject}\n\n${body}` } };
}

const SQUASH_SUBJECT = 'feat(scope): a thing (#123)';
const PR_SHAPED = '## Summary\n\nwhat changed';
const BARE = 'a hand-written message with no headings';

async function drive(commits: ReturnType<typeof commit>[]): Promise<CoreCapture> {
  const captured: CoreCapture = { info: [], warning: [], failed: [] };
  const github = { rest: { repos: { listCommits: async () => ({ data: commits }) } } };
  await loadStep()(
    github,
    { repo: { owner: 'minipuft', repo: 'claude-prompts-mcp' } },
    {
      info: (message: string) => captured.info.push(message),
      warning: (message: string) => captured.warning.push(message),
      setFailed: (message: string) => captured.failed.push(message),
    }
  );
  return captured;
}

describe('pr-conventions.yml — merge-settings effect check', () => {
  beforeAll(() => {
    // Guards the extraction itself. Every assertion below is about a script this test located by
    // name inside a YAML file; if that lookup silently returned nothing, they would all pass.
    expect(() => loadStep()).not.toThrow();
  });

  it('stays silent when the newest squash carries a PR-shaped body', async () => {
    const out = await drive([
      commit('aaaaaaaa', SQUASH_SUBJECT, PR_SHAPED),
      commit('bbbbbbbb', SQUASH_SUBJECT, PR_SHAPED),
    ]);

    expect(out.info.join('\n')).toContain('contract holds');
    expect(out.warning).toHaveLength(0);
    expect(out.failed).toHaveLength(0);
  });

  it('never fails the job, whatever it finds — the #269 deadlock', async () => {
    // The whole point. A required check whose subject only a merge can change must not block, or
    // it blocks the merge that would clear it. Asserted on the worst input available.
    const out = await drive([commit('cccccccc', SQUASH_SUBJECT, BARE)]);

    expect(out.failed).toHaveLength(0);
    expect(out.warning).toHaveLength(1);
  });

  it('reads a single bare squash among sound ones as an overriding merge, not drift', async () => {
    const out = await drive([
      commit('cccccccc', SQUASH_SUBJECT, BARE),
      commit('dddddddd', SQUASH_SUBJECT, PR_SHAPED),
    ]);

    const message = out.warning.join('\n');
    expect(message).toContain('single overriding merge');
    expect(message).toContain('dddddddd');
    // The converse matters as much: this is the branch that must NOT send a reader to re-apply a
    // setting that is already correct, which is exactly what cost debugging time on 2026-09-08.
    expect(message).not.toContain('drifted repository setting');
  });

  it('reads an unbroken run of bare squashes as a drifted setting, and names the fix', async () => {
    const out = await drive([
      commit('eeeeeeee', SQUASH_SUBJECT, BARE),
      commit('ffffffff', SQUASH_SUBJECT, BARE),
    ]);

    const message = out.warning.join('\n');
    expect(message).toContain('drifted repository setting');
    expect(message).toContain('-f squash_merge_commit_message=PR_BODY');
    expect(message).not.toContain('single overriding merge');
  });

  it('says nothing when no squash-shaped commit is in range', async () => {
    // A commit with no `(#n)` suffix is not a squash merge. Reporting on it would be a finding
    // about nothing — the observer has simply not seen the artifact it judges.
    const out = await drive([commit('11111111', 'feat(scope): direct commit', PR_SHAPED)]);

    expect(out.info.join('\n')).toContain('No squash-shaped commit');
    expect(out.warning).toHaveLength(0);
    expect(out.failed).toHaveLength(0);
  });
});

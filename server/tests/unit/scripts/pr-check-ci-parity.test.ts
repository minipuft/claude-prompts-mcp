/**
 * `npm run pr:check` must run every gating step the `PR Conventions` workflow runs.
 *
 * WHY THIS EXISTS. CLAUDE.md §Validation Gates states the repo's contract: "CI is the contract;
 * every other gate is a documented strict subset of it." At the PR boundary that held in form and
 * failed in substance. `CONTRIBUTING.md` documented ONE of the four gating steps — the body check
 * — so the documented local route was a PROPER subset that omitted the title lint, and a
 * contributor who followed it exactly still shipped an unchecked title (#283, `subject-case`,
 * 2026-09-14). Prose cannot hold that relation: the workflow and the instructions are two files
 * that no gate compared.
 *
 * WHAT THIS MEASURES. The workflow's gating steps are the steps carrying BOTH a `run:` and the
 * non-bot guard — bot PRs are exempt from the authored-body checks, so a step without that guard
 * judges the checkout rather than the author. Their names must equal, exactly, the set of
 * `ciStepName` values `scripts/pr-check.mjs` claims to mirror. Adding a fifth gating step to CI
 * therefore fails this test until `pr-check.mjs` mirrors it, and deleting one fails it until the
 * local mirror drops it too.
 *
 * WHY NAMES AND NOT COMMANDS. The title-lint step's `run:` also carries an `npm ci
 * --ignore-scripts` that has no local counterpart (the developer tree is already installed), so
 * comparing command strings would report a difference that is correct behaviour. The step name is
 * the stable join key, and a rename is itself a change worth failing on.
 *
 * Sibling precedent: `pr-conventions-merge-settings.test.ts` extracts a step's script from this
 * same workflow file so it cannot drift from what CI executes. This is the same technique applied
 * to the step LIST rather than to one step's body.
 *
 * Classification: Unit (no network, no filesystem writes; reads two repo files)
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it, beforeAll } from '@jest/globals';

import { parseYamlOrThrow } from '../../../src/shared/utils/yaml/yaml-parser.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/pr-conventions.yml');
const PR_CHECK = path.join(REPO_ROOT, 'scripts/pr-check.mjs');

/** The guard that marks a step as judging the AUTHOR's pull request rather than the checkout. */
const NON_BOT_GUARD = "github.event.pull_request.user.type != 'Bot'";

interface WorkflowStep {
  name?: string;
  run?: string;
  if?: string;
}

interface WorkflowFile {
  jobs: Record<string, { steps: WorkflowStep[] }>;
}

function gatingStepNames(): string[] {
  const workflow = parseYamlOrThrow<WorkflowFile>(readFileSync(WORKFLOW, 'utf8'));
  return Object.values(workflow.jobs)
    .flatMap((job) => job.steps)
    .filter((step) => typeof step.run === 'string' && (step.if ?? '').includes(NON_BOT_GUARD))
    .map((step) => step.name ?? '(unnamed step)')
    .sort();
}

let mirroredStepNames: string[];
let mirroredIds: string[];

beforeAll(async () => {
  const module = (await import(pathToFileURL(PR_CHECK).href)) as {
    MIRRORED_CI_STEPS: { id: string; ciStepName: string }[];
  };
  mirroredStepNames = module.MIRRORED_CI_STEPS.map((step) => step.ciStepName).sort();
  mirroredIds = module.MIRRORED_CI_STEPS.map((step) => step.id);
});

describe('pr:check mirrors the PR Conventions workflow', () => {
  it('finds gating steps in the workflow', () => {
    // Guards the derivation. A selector that silently matched nothing would make the equality
    // assertion below compare two empty sets and report green while measuring nothing — the
    // vacuous-pass shape this repo's own positive-control steps exist to rule out.
    expect(gatingStepNames().length).toBeGreaterThan(0);
  });

  it('claims a mirror for every gating step, and no step that is not one', () => {
    expect(mirroredStepNames).toEqual(gatingStepNames());
  });

  it('gives every mirrored step a distinct id', () => {
    expect(new Set(mirroredIds).size).toBe(mirroredIds.length);
  });

  it('names steps that exist verbatim in the workflow file', () => {
    // Belt-and-braces against a YAML parse that returns a shape the selector walks incorrectly:
    // every claimed name must also appear as literal text in the file.
    const raw = readFileSync(WORKFLOW, 'utf8');
    for (const name of mirroredStepNames) {
      expect(raw).toContain(name);
    }
  });
});

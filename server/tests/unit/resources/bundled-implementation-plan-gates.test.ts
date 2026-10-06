/**
 * The bundled `implementation_plan` declares `plan-quality` and no code gate.
 *
 * Since #445 a chain prompt's own `gateConfiguration.include` is reviewed on the chain's final
 * step. `implementation_plan`'s final step produces a plan, so `plan-quality` grades the finished
 * artifact; `code-quality` grades generated code and answered the wrong question there (owner
 * ruling 2026-10-05). Reading the SHIPPED file rather than a fixture is the point: a fixture
 * would stay green while the data drifted.
 *
 * The control reads `tech_evaluation_chain`, which still declares `code-quality`, so an empty or
 * mis-keyed read of the include list cannot satisfy the absence assertion.
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import path from 'path';

import { load as loadYaml } from 'js-yaml';

function includeOf(...promptDir: string[]): string[] {
  const file = path.join(process.cwd(), 'resources', 'prompts', ...promptDir, 'prompt.yaml');
  const parsed = loadYaml(readFileSync(file, 'utf8')) as {
    gateConfiguration?: { include?: string[] };
  };
  return parsed.gateConfiguration?.include ?? [];
}

describe('bundled chain prompts declare the gate that grades their final artifact', () => {
  it('implementation_plan includes plan-quality and no code-quality', () => {
    const include = includeOf('planning', 'implementation_plan');
    expect(include).toContain('plan-quality');
    expect(include).not.toContain('code-quality');
  });

  it('control: tech_evaluation_chain still declares code-quality, so the read sees an include list', () => {
    expect(includeOf('development', 'tech_evaluation_chain')).toContain('code-quality');
  });
});

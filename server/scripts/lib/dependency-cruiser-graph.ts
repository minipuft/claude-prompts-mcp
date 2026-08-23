import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { z } from 'zod';

const DependencySchema = z
  .object({
    resolved: z.string(),
    dependencyTypes: z.array(z.string()),
    coreModule: z.boolean().optional(),
    followable: z.boolean().optional(),
    couldNotResolve: z.boolean().optional(),
  })
  .passthrough();

const ModuleSchema = z
  .object({
    source: z.string(),
    dependencies: z.array(DependencySchema),
    dependents: z.array(z.string()).optional(),
  })
  .passthrough();

const ViolationSchema = z
  .object({
    type: z.string(),
    from: z.string(),
    to: z.string().optional(),
    rule: z.object({ severity: z.string(), name: z.string() }).passthrough(),
  })
  .passthrough();

const SummarySchema = z
  .object({
    violations: z.array(ViolationSchema),
    error: z.number().int().nonnegative(),
    warn: z.number().int().nonnegative(),
    info: z.number().int().nonnegative(),
    totalCruised: z.number().int().nonnegative(),
    totalDependenciesCruised: z.number().int().nonnegative(),
  })
  .passthrough();

const DependencyCruiserGraphSchema = z.object({
  modules: z.array(ModuleSchema),
  summary: SummarySchema,
});

export type DependencyCruiserViolation = z.infer<typeof ViolationSchema>;
export type DependencyCruiserGraph = z.infer<typeof DependencyCruiserGraphSchema>;

export interface DependencyCruiserRun {
  readonly exitCode: number;
  readonly graph: DependencyCruiserGraph;
  readonly stderr: string;
}

export interface RunDependencyCruiserOptions {
  readonly config?: string;
  readonly cwd: string;
  readonly source?: string;
}

export function parseDependencyCruiserJson(raw: string): DependencyCruiserGraph {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `dependency-cruiser emitted invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  const result = DependencyCruiserGraphSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(
      `dependency-cruiser JSON does not match the required graph contract: ${details}`
    );
  }
  return result.data;
}

export function runDependencyCruiser(options: RunDependencyCruiserOptions): DependencyCruiserRun {
  const config = options.config ?? '.dependency-cruiser.cjs';
  const source = options.source ?? 'src';
  const executable = path.join(
    options.cwd,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'depcruise.cmd' : 'depcruise'
  );
  const result = spawnSync(executable, ['--config', config, '-T', 'json', source], {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw new Error(`could not run dependency-cruiser: ${result.error.message}`);
  }
  if ((result.stdout ?? '').trim().length === 0) {
    throw new Error(
      `dependency-cruiser emitted no JSON${result.stderr ? `: ${result.stderr.trim()}` : ''}`
    );
  }
  return {
    exitCode: result.status ?? 1,
    graph: parseDependencyCruiserJson(result.stdout ?? ''),
    stderr: result.stderr ?? '',
  };
}

export function formatDependencyCruiserViolations(
  violations: readonly DependencyCruiserViolation[]
): string {
  return violations
    .map((violation) => {
      const target = violation.to === undefined ? '' : ` → ${violation.to}`;
      return `${violation.rule.severity} ${violation.rule.name}: ${violation.from}${target}`;
    })
    .join('\n');
}

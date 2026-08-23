import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import * as yaml from 'js-yaml';
import { z } from 'zod';

const MODULE_DESCRIPTOR_FILENAME = 'module.yaml';
const MODULE_KINDS = [
  'application',
  'layer',
  'domain',
  'protocol',
  'adapter',
  'runtime',
  'shared',
] as const;
const MODULE_LIFECYCLES = ['canonical', 'migrating', 'legacy'] as const;
const MODULE_CHILD_POLICIES = ['semantic', 'internal'] as const;

export const ModuleDescriptorDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be kebab-case'),
    kind: z.enum(MODULE_KINDS),
    lifecycle: z.enum(MODULE_LIFECYCLES),
    description: z.string().trim().min(1),
    children: z.enum(MODULE_CHILD_POLICIES),
    docs: z.array(z.string().trim().min(1)).optional(),
    publicEntry: z.string().trim().min(1).optional(),
    replacement: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    removeWhen: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((descriptor, context) => {
    const requiresRemoval = descriptor.lifecycle !== 'canonical';
    if (requiresRemoval && descriptor.replacement === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['replacement'],
        message: `${descriptor.lifecycle} descriptors must name a replacement id`,
      });
    }
    if (requiresRemoval && descriptor.removeWhen === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['removeWhen'],
        message: `${descriptor.lifecycle} descriptors must name a removal condition`,
      });
    }
    if (
      !requiresRemoval &&
      (descriptor.replacement !== undefined || descriptor.removeWhen !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'canonical descriptors must not carry replacement or removeWhen',
      });
    }
  });

export type ModuleDescriptorDocument = z.infer<typeof ModuleDescriptorDocumentSchema>;

export interface SemanticModuleDescriptor extends ModuleDescriptorDocument {
  readonly absoluteDirectory: string;
  readonly descriptorPath: string;
  readonly sourcePath: string;
}

export interface DescriptorProblem {
  readonly path: string;
  readonly message: string;
}

export interface DescriptorTree {
  readonly descriptors: readonly SemanticModuleDescriptor[];
  readonly problems: readonly DescriptorProblem[];
  readonly repoRoot: string;
  readonly sourceRoot: string;
}

export interface LoadDescriptorTreeOptions {
  readonly repoRoot: string;
  readonly sourceRoot: string;
}

function normalizeSlashes(value: string): string {
  return value.split(path.sep).join('/');
}

function relativeDisplayPath(repoRoot: string, absolutePath: string): string {
  const relative = path.relative(repoRoot, absolutePath);
  return normalizeSlashes(relative.length === 0 ? '.' : relative);
}

function directChildDirectories(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function nestedDescriptorPaths(directory: string): string[] {
  const found: string[] = [];
  for (const child of directChildDirectories(directory)) {
    const descriptorPath = path.join(child, MODULE_DESCRIPTOR_FILENAME);
    if (existsSync(descriptorPath)) found.push(descriptorPath);
    found.push(...nestedDescriptorPaths(child));
  }
  return found;
}

function parseDescriptor(
  descriptorPath: string,
  options: LoadDescriptorTreeOptions,
  problems: DescriptorProblem[]
): SemanticModuleDescriptor | null {
  const displayPath = relativeDisplayPath(options.repoRoot, descriptorPath);
  let parsed: unknown;
  try {
    parsed = yaml.load(readFileSync(descriptorPath, 'utf8'));
  } catch (error) {
    problems.push({
      path: displayPath,
      message: `invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }

  const result = ModuleDescriptorDocumentSchema.safeParse(parsed);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path.length === 0 ? '' : ` (${issue.path.join('.')})`;
      problems.push({ path: displayPath, message: `${issue.message}${field}` });
    }
    return null;
  }

  const absoluteDirectory = path.dirname(descriptorPath);
  const sourcePath = normalizeSlashes(path.relative(options.sourceRoot, absoluteDirectory)) || '.';
  return {
    ...result.data,
    absoluteDirectory,
    descriptorPath,
    sourcePath,
  };
}

function checkFileReferences(
  descriptor: SemanticModuleDescriptor,
  options: LoadDescriptorTreeOptions,
  problems: DescriptorProblem[]
): void {
  const displayPath = relativeDisplayPath(options.repoRoot, descriptor.descriptorPath);
  for (const doc of descriptor.docs ?? []) {
    if (!existsSync(path.resolve(options.repoRoot, doc))) {
      problems.push({ path: displayPath, message: `docs path does not exist: ${doc}` });
    }
  }
  if (
    descriptor.publicEntry !== undefined &&
    !existsSync(path.resolve(descriptor.absoluteDirectory, descriptor.publicEntry))
  ) {
    problems.push({
      path: displayPath,
      message: `publicEntry does not exist: ${descriptor.publicEntry}`,
    });
  }
}

export function loadSemanticModuleTree(options: LoadDescriptorTreeOptions): DescriptorTree {
  const normalizedOptions = {
    repoRoot: path.resolve(options.repoRoot),
    sourceRoot: path.resolve(options.sourceRoot),
  };
  const problems: DescriptorProblem[] = [];
  const descriptors: SemanticModuleDescriptor[] = [];
  const visited = new Set<string>();

  function visit(directory: string, required: boolean): void {
    const descriptorPath = path.join(directory, MODULE_DESCRIPTOR_FILENAME);
    const displayPath = relativeDisplayPath(normalizedOptions.repoRoot, descriptorPath);
    if (!existsSync(descriptorPath)) {
      if (required) problems.push({ path: displayPath, message: 'required descriptor is missing' });
      return;
    }
    if (visited.has(descriptorPath)) return;
    visited.add(descriptorPath);

    const descriptor = parseDescriptor(descriptorPath, normalizedOptions, problems);
    if (descriptor === null) return;
    descriptors.push(descriptor);
    checkFileReferences(descriptor, normalizedOptions, problems);

    if (descriptor.children === 'semantic') {
      for (const child of directChildDirectories(directory)) visit(child, true);
      return;
    }

    for (const nestedPath of nestedDescriptorPaths(directory)) {
      problems.push({
        path: relativeDisplayPath(normalizedOptions.repoRoot, nestedPath),
        message: `unexpected descriptor beneath internal boundary '${descriptor.id}'`,
      });
    }
  }

  visit(normalizedOptions.sourceRoot, true);

  const byId = new Map<string, SemanticModuleDescriptor>();
  for (const descriptor of descriptors) {
    const previous = byId.get(descriptor.id);
    if (previous !== undefined) {
      problems.push({
        path: relativeDisplayPath(normalizedOptions.repoRoot, descriptor.descriptorPath),
        message: `duplicate id '${descriptor.id}' also declared by ${relativeDisplayPath(normalizedOptions.repoRoot, previous.descriptorPath)}`,
      });
    } else {
      byId.set(descriptor.id, descriptor);
    }
  }

  for (const descriptor of descriptors) {
    if (descriptor.replacement !== undefined) {
      if (descriptor.replacement === descriptor.id) {
        problems.push({
          path: relativeDisplayPath(normalizedOptions.repoRoot, descriptor.descriptorPath),
          message: 'replacement must reference a different descriptor id',
        });
      } else if (!byId.has(descriptor.replacement)) {
        problems.push({
          path: relativeDisplayPath(normalizedOptions.repoRoot, descriptor.descriptorPath),
          message: `replacement id does not exist: ${descriptor.replacement}`,
        });
      }
    }
  }

  return {
    descriptors: descriptors.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
    problems: problems.sort(
      (left, right) =>
        left.path.localeCompare(right.path) || left.message.localeCompare(right.message)
    ),
    ...normalizedOptions,
  };
}

export function nearestSemanticDescriptor(
  modulePath: string,
  descriptors: readonly SemanticModuleDescriptor[],
  sourceRoot: string
): SemanticModuleDescriptor | null {
  const absoluteModule = path.resolve(sourceRoot, modulePath);
  const candidates = descriptors
    .filter((descriptor) => {
      const relative = path.relative(descriptor.absoluteDirectory, absoluteModule);
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    })
    .sort((left, right) => right.absoluteDirectory.length - left.absoluteDirectory.length);
  return candidates[0] ?? null;
}

export function formatDescriptorProblems(problems: readonly DescriptorProblem[]): string {
  return problems.map((problem) => `- ${problem.path}: ${problem.message}`).join('\n');
}

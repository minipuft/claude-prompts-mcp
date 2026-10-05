// @lifecycle canonical - Verifies refreshed prompt mutations and builds addressable receipts.

import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type { PromptResourceContext } from '../core/context.js';
import type { OperationResult } from '../core/types.js';

import {
  normalizeChainBudget,
  withInlineGateDefaults,
} from '#modules/prompts/yaml-prompt-loader.js';
import { canonicalPromptSnapshot } from '#modules/versioning/index.js';
import { resolveContainedPath } from '#shared/utils/path-containment.js';
import { slugifyCategoryDirectory } from '#shared/utils/resource-ids.js';
import { parseYaml } from '#shared/utils/yaml/yaml-parser.js';

export interface PromptMutationReceipt {
  resource_type: 'prompt';
  action: 'create' | 'update';
  id: string;
  config_path: string;
  server_root: string;
  /**
   * The prompts directory the write landed in — `affected_files` are all beneath it.
   *
   * With a workspace overlaying the bundled tree, "where prompts come from" and "where a write
   * goes" stopped being one place, so the receipt has to say which. It resolves through the same
   * `getResolvedPromptsDirectory()` call `FileOperations` writes through, which is what keeps the
   * two from drifting; a test binds the receipt's value to the actual file paths rather than
   * trusting that they agree.
   */
  resource_root: string;
  affected_files: string[];
  refresh_status: 'loaded' | 'verification_failed' | 'restart_pending';
  loaded_after_refresh: boolean | null;
  current_version: number;
}

export interface PromptMutationVerification {
  receipt: PromptMutationReceipt;
  verified: boolean;
  error?: string;
}

export interface PromptMutationCompletion {
  action: 'create' | 'update';
  id: string;
  expectedPrompt: Record<string, unknown>;
  operation: OperationResult;
  fullRestart: boolean;
  refresh: () => Promise<void>;
  reason: string;
}

export class PromptMutationReceiptService {
  constructor(private readonly context: PromptResourceContext) {}

  async complete(input: PromptMutationCompletion): Promise<PromptMutationVerification> {
    let refreshResult: {
      loadedAfterRefresh: boolean | null;
      refreshStatus: PromptMutationReceipt['refresh_status'];
      verificationError?: string;
    };

    if (input.fullRestart) {
      setTimeout(() => {
        // The receipt already told the caller `restart_pending`. Detached and uncaught, a
        // restart that failed left that status true forever and logged nothing anywhere.
        this.context.dependencies.onRestart(input.reason).catch((error: unknown) => {
          this.context.dependencies.logger.error(
            `[PromptMutationReceiptService] Restart after ${input.action} of '${input.id}' failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        });
      }, 1000);
      refreshResult = { loadedAfterRefresh: null, refreshStatus: 'restart_pending' };
    } else {
      refreshResult = await this.refreshAndVerify(input);
    }

    // Structural caps leave the loaded budget by design. Prove their authored values from
    // this operation's own parent file, rather than treating a scaffold or tool path as proof.
    const declaredCaps = structuralBudgetCaps(input.expectedPrompt['budget']);
    if (Object.keys(declaredCaps).length > 0) {
      try {
        const parentYaml = resolveContainedPath(
          this.context.dependencies.configManager.getResolvedPromptsDirectory(),
          `${slugifyCategoryDirectory(String(input.expectedPrompt['category'] ?? 'general'))}/${input.id}/prompt.yaml`
        );
        if (!(input.operation.affectedFiles ?? []).some((file) => resolve(file) === parentYaml)) {
          throw new Error('the affected files do not name the authored parent prompt.yaml');
        }
        const parsed = parseYaml<unknown>(await readFile(parentYaml, 'utf8'), {
          filename: parentYaml,
        });
        if (!parsed.success || !isRecord(parsed.data) || parsed.data['id'] !== basename(input.id)) {
          throw new Error('the affected parent prompt.yaml does not identify this prompt');
        }
        const storedCaps = structuralBudgetCaps(parsed.data['budget']);
        const mismatched = Object.keys(declaredCaps).filter(
          (field) => !isDeepStrictEqual(declaredCaps[field], storedCaps[field])
        );
        if (mismatched.length > 0) {
          throw new Error(`authored budget mismatch: ${mismatched.join(', ')}`);
        }
      } catch (error) {
        refreshResult = {
          loadedAfterRefresh: false,
          refreshStatus: 'verification_failed',
          verificationError: `Prompt '${input.id}' was written but its authored budget could not be verified: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    const history = await this.context.versionHistoryService.loadHistory('prompt', input.id);
    const config = this.context.dependencies.configManager;
    const receipt: PromptMutationReceipt = {
      resource_type: 'prompt',
      action: input.action,
      id: input.id,
      config_path: config.getConfigPath(),
      server_root: config.getServerRoot(),
      resource_root: config.getResolvedPromptsDirectory(),
      affected_files: input.operation.affectedFiles ?? [],
      refresh_status: refreshResult.refreshStatus,
      loaded_after_refresh: refreshResult.loadedAfterRefresh,
      current_version: history?.current_version ?? 0,
    };

    return refreshResult.verificationError === undefined
      ? { receipt, verified: true }
      : { receipt, verified: false, error: refreshResult.verificationError };
  }

  private async refreshAndVerify(input: PromptMutationCompletion): Promise<{
    loadedAfterRefresh: boolean;
    refreshStatus: 'loaded' | 'verification_failed';
    verificationError?: string;
  }> {
    try {
      await input.refresh();
      const loaded = this.context
        .getData()
        .convertedPrompts.find((prompt) => prompt.id === input.id);
      const expectedSnapshot = normalizeReloadShape(
        canonicalPromptSnapshot(input.id, input.expectedPrompt)
      );
      const loadedSnapshot = normalizeReloadShape(canonicalPromptSnapshot(input.id, loaded));
      const matches = loaded !== undefined && isDeepStrictEqual(loadedSnapshot, expectedSnapshot);
      if (matches) return { loadedAfterRefresh: true, refreshStatus: 'loaded' };

      const mismatchedFields = this.findMismatchedFields(expectedSnapshot, loadedSnapshot);
      const mismatch =
        mismatchedFields.length > 0 ? ` (mismatched: ${mismatchedFields.join(', ')})` : '';
      return {
        loadedAfterRefresh: false,
        refreshStatus: 'verification_failed',
        verificationError:
          `Prompt '${input.id}' was written but the refreshed registry did not expose ` +
          `the expected state${mismatch}.`,
      };
    } catch (error) {
      return {
        loadedAfterRefresh: false,
        refreshStatus: 'verification_failed',
        verificationError: `Prompt '${input.id}' was written but refresh failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  private findMismatchedFields(
    expected: Record<string, unknown>,
    loaded: Record<string, unknown>
  ): string[] {
    return [...new Set([...Object.keys(expected), ...Object.keys(loaded)])].filter(
      (field) => !isDeepStrictEqual(expected[field], loaded[field])
    );
  }
}

/**
 * Match the loader's documented defaults before comparing authored state against a loaded one.
 *
 * Exported for `PromptLifecycleProcessor`'s create-path version snapshot: the recorded
 * state must match what a post-refresh load produces, or the first update bridges a "mismatch"
 * that is really just these same loader defaults this function already accounts for here.
 */
export function normalizeReloadShape(snapshot: Record<string, unknown>): Record<string, unknown> {
  const normalized = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
  normalized['systemMessage'] = normalized['systemMessage'] ?? '';
  // `category` survives a round trip only as its directory slug.
  //
  // The write puts the prompt under `slugifyCategoryDirectory(category)`, and `loader.ts:186`
  // then overwrites `prompt.category` with the directory-derived id regardless of what the file
  // declares. So the authored value is what the operator typed and the reloaded value is always
  // the slug, and comparing them directly made every create with a spaced category report
  // `❌ Post-write verification failed (mismatched: category)` for a write that was correct in
  // every respect — measured 2026-08-30 with `My Category`. Applied to BOTH sides rather than
  // only the expected one: the transform is idempotent, so slugging an already-slugged value is
  // a no-op, and a symmetric normalization cannot drift into asserting which side is which.
  if (typeof normalized['category'] === 'string') {
    normalized['category'] = slugifyCategoryDirectory(normalized['category']);
  }
  if (normalized['gateConfiguration'] !== undefined) {
    normalized['gateConfiguration'] = withLoaderGateDefaults(normalized['gateConfiguration']);
  }
  if (Array.isArray(normalized['arguments'])) {
    normalized['arguments'] = normalized['arguments'].map((argument: unknown) => {
      if (argument === null || typeof argument !== 'object') return argument;
      const fields = argument as Record<string, unknown>;
      return { ...fields, required: fields['required'] ?? false };
    });
  }
  // Reuse the loader's owner for the runtime view; the public service separately proves
  // structural declarations in the file, so normalization cannot conceal a lost authored cap.
  const budget = normalizeChainBudget(
    normalized['budget'] as Parameters<typeof normalizeChainBudget>[0]
  );
  if (budget === undefined) delete normalized['budget'];
  else normalized['budget'] = budget;
  return normalized;
}

/**
 * Apply the loader's inline-gate defaults (`withInlineGateDefaults`) to each definition, so a
 * write that omitted `pass_criteria` compares equal to the `[]` the loader serves (R103). A
 * definition the loader DROPS is left as written: its absence from the served prompt is a real
 * mismatch, and this function must not hide it.
 */
function withLoaderGateDefaults(gateConfiguration: unknown): unknown {
  if (gateConfiguration === null || typeof gateConfiguration !== 'object') return gateConfiguration;
  const definitions = (gateConfiguration as Record<string, unknown>)['inline_gate_definitions'];
  if (!Array.isArray(definitions)) return gateConfiguration;
  return {
    ...gateConfiguration,
    inline_gate_definitions: definitions.map((definition: unknown) =>
      definition !== null && typeof definition === 'object'
        ? withInlineGateDefaults(definition as Record<string, unknown>)
        : definition
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function structuralBudgetCaps(budget: unknown): Record<string, unknown> {
  if (!isRecord(budget)) return {};
  return Object.fromEntries(
    ['maxNodes', 'maxFanOut']
      .filter((field) => budget[field] !== undefined)
      .map((field) => [field, budget[field]])
  );
}

// @lifecycle canonical - Verifies refreshed prompt mutations and builds addressable receipts.

import { isDeepStrictEqual } from 'node:util';

import { canonicalPromptSnapshot } from '../utils/validation.js';

import type { PromptResourceContext } from '../core/context.js';
import type { OperationResult } from '../core/types.js';

import { slugifyCategoryDirectory } from '#shared/utils/resource-ids.js';

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
        void this.context.dependencies.onRestart(input.reason);
      }, 1000);
      refreshResult = { loadedAfterRefresh: null, refreshStatus: 'restart_pending' };
    } else {
      refreshResult = await this.refreshAndVerify(input);
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
      const expectedSnapshot = this.normalizeReloadShape(
        canonicalPromptSnapshot(input.id, input.expectedPrompt)
      );
      const loadedSnapshot = this.normalizeReloadShape(canonicalPromptSnapshot(input.id, loaded));
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

  /** Match the loader's documented defaults before comparing authored state after refresh. */
  private normalizeReloadShape(snapshot: Record<string, unknown>): Record<string, unknown> {
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
    if (Array.isArray(normalized['arguments'])) {
      normalized['arguments'] = normalized['arguments'].map((argument: unknown) => {
        if (argument === null || typeof argument !== 'object') return argument;
        const fields = argument as Record<string, unknown>;
        return { ...fields, required: fields['required'] ?? false };
      });
    }
    return normalized;
  }
}

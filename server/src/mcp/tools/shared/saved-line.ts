// @lifecycle canonical - The `saved: <path>` line every resource_manager create, update and rollback ends with.

import * as path from 'node:path';

import type { RestorePlan } from '#modules/versioning/index.js';
import type { ToolResponse } from '#shared/types/index.js';

import { resourceEntryFileName } from '#shared/utils/resource-file-set.js';

/**
 * The file a write's `saved:` line names, chosen from the files the write actually wrote: the
 * resource's main YAML file (`prompt.yaml`, `gate.yaml`, `framework.yaml`, `category.yaml`) when
 * this write wrote it, otherwise the first file it did write — `user-message.md` for a
 * template-only prompt update, `guidance.md` for a guidance-only gate update. Undefined when the
 * write wrote nothing, which `withSavedLine` refuses.
 *
 * One rule for all four writers, so no writer can name its main file out of habit for a write
 * that left that file untouched.
 */
export function selectSavedPath(
  writtenFiles: readonly string[],
  mainYamlPath: string
): string | undefined {
  return writtenFiles.includes(mainYamlPath) ? mainYamlPath : writtenFiles[0];
}

/**
 * End a create, update or rollback reply with where the write landed (ruling R3j): one final line,
 * `saved: <absolute path of a file this write wrote>`, so the caller learns which of several
 * resource folders received the file without a follow-up `inspect`. A structured reply carries
 * the same path as `structuredContent.saved`, for a client that reads only the JSON half.
 *
 * Only for a reply whose write landed: a refusal, a preview or a delete writes no file and must
 * not name one. `writtenFiles` is the writer's own account of the files it wrote, and the path
 * must be one of them. Each refusal below is a defect — a writer that misreports, or an update
 * that wrote nothing and should have answered through `withWriteOutcome` — so it throws rather
 * than answering with a line that names a file this call did not write.
 */
export function withSavedLine(
  response: ToolResponse,
  savedPath: string | undefined,
  writtenFiles: readonly string[] | undefined
): ToolResponse {
  const written = writtenFiles ?? [];
  if (written.length === 0) {
    throw new Error(
      `A resource write reached the saved line with no file written (saved path: ` +
        `${savedPath ?? 'none'}): a write that wrote nothing answers through withWriteOutcome, ` +
        `and a create that wrote nothing is a defect in the writer`
    );
  }
  if (savedPath === undefined || savedPath === '') {
    throw new Error(
      `A resource write landed but its writer reported no saved path (files written: ${written.join(', ')})`
    );
  }
  if (!written.includes(savedPath)) {
    throw new Error(
      `A resource write names ${savedPath} as saved, but that file is not among the files it ` +
        `wrote: ${written.join(', ')}`
    );
  }
  return {
    ...appendLastLine(response, `saved: ${savedPath}`),
    ...(response.structuredContent !== undefined
      ? { structuredContent: { ...response.structuredContent, saved: savedPath } }
      : {}),
  };
}

/** The last line of an update reply whose request changed no file (ruling R3w). */
export const NOTHING_WRITTEN_LINE = 'nothing written: the request changed no file';

/**
 * End an update reply with what its write did: the `saved:` line when it wrote a file, or
 * `nothing written: the request changed no file` when its writer reports an empty list (ruling
 * R3w). An update that changes no file is a request that asked for the state already on disk, not
 * a failure, so the reply stays a success and names no file.
 *
 * Only an explicit empty `writtenFiles` takes the nothing-written branch. A missing list is a
 * writer that did not report what it wrote, and goes to `withSavedLine`, which throws.
 */
export function withWriteOutcome(
  response: ToolResponse,
  result: { savedPath?: string | undefined; writtenFiles?: readonly string[] | undefined }
): ToolResponse {
  if (result.writtenFiles?.length === 0) {
    return appendLastLine(response, NOTHING_WRITTEN_LINE);
  }
  return withSavedLine(response, result.savedPath, result.writtenFiles);
}

/**
 * End a byte-exact rollback reply with what its restore wrote, as `withWriteOutcome` ends an
 * update: the `saved:` line naming the resource's entry file when the restore wrote it, otherwise
 * the first file it wrote, or the nothing-written line when every file already matched.
 *
 * The plan is the restore's own account of its writes: `applyByteRestore` writes exactly
 * `plan.write`, each at its `absolutePath` under the root the resource is served from, so the
 * line names where the restored bytes landed rather than where a write would go by default.
 */
export function withRestoreOutcome(response: ToolResponse, plan: RestorePlan): ToolResponse {
  if (plan.resourceType === 'config') {
    // `config` has no resource_manager rollback; `cpm` restores it (`cli-shared/config-restore.ts`).
    throw new Error('A config restore reached a resource_manager rollback reply');
  }
  const writtenFiles = plan.write.map((file) => file.absolutePath);
  const entryPath = path.resolve(plan.destinationRoot, resourceEntryFileName(plan.resourceType));
  return withWriteOutcome(response, {
    savedPath: selectSavedPath(writtenFiles, entryPath),
    writtenFiles,
  });
}

function appendLastLine(response: ToolResponse, line: string): ToolResponse {
  const lastPart = response.content.at(-1);
  const content: ToolResponse['content'] =
    lastPart === undefined
      ? [{ type: 'text', text: line }]
      : [
          ...response.content.slice(0, -1),
          { ...lastPart, text: `${lastPart.text.trimEnd()}\n\n${line}` },
        ];
  return { ...response, content };
}

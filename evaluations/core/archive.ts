import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import {
  canonicalJson,
  hashBytes,
  hashCanonical,
} from "../../server/src/shared/utils/hash.ts";
import { parseArchiveRecord, parseContentRef } from "./contracts.ts";
import type { ArchiveRecord, ContentRef } from "./contracts.ts";

type BlobRef = Extract<ContentRef, { type: "blob" }>;
type RecordRef = Extract<ContentRef, { type: "record" }>;

function dependencyRefs(record: ArchiveRecord): ContentRef[] {
  return [
    ...record.refs,
    ...record.provenance.refs,
    ...(record.usage.state === "known" ? [record.usage.source] : []),
    ...(record.cost.state === "known" ? [record.cost.source] : []),
  ];
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function directory(path: string, privateMode: boolean): Promise<void> {
  const info = await lstat(path);
  if (
    info.isSymbolicLink() ||
    !info.isDirectory() ||
    (await realpath(path)) !== path
  ) {
    throw new Error(
      `Archive directory must be a real nonsymlink directory: ${path}`,
    );
  }
  if (privateMode) assertPrivate(info.mode, info.uid, 0o700, path);
}

function assertPrivate(
  mode: number,
  uid: number,
  required: number,
  path: string,
): void {
  if ((mode & 0o7777) !== required) {
    throw new Error(
      `Archive path requires mode ${required.toString(8)}: ${path}`,
    );
  }
  if (typeof process.getuid === "function" && uid !== process.getuid()) {
    throw new Error(
      `Archive path must be owned by the current operator: ${path}`,
    );
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensureDirectory(
  path: string,
  privateMode: boolean,
): Promise<void> {
  let created = false;
  try {
    await mkdir(path, { mode: 0o700 });
    created = true;
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
  }
  await directory(path, privateMode);
  if (created) await syncDirectory(dirname(path));
}

async function prepareRoot(value: string): Promise<string> {
  if (process.platform === "win32")
    throw new Error(
      "EvaluationArchive requires POSIX private modes, hard links and directory fsync",
    );
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.includes("\0") ||
    value.split(/[\\/]/).includes("..")
  ) {
    throw new TypeError(
      "Archive root must be an explicit path without traversal",
    );
  }
  const root = resolve(value);
  const prefix = parse(root).root;
  await directory(prefix, false);
  let current = prefix;
  for (const segment of root.slice(prefix.length).split("/").filter(Boolean)) {
    current = join(current, segment);
    await ensureDirectory(current, current === root);
  }
  await directory(root, true);
  await ensureDirectory(join(root, "blobs"), true);
  await ensureDirectory(join(root, "records"), true);
  return root;
}

async function readPrivateFile(path: string): Promise<Buffer> {
  const before = await lstat(path);
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    (await realpath(path)) !== path
  ) {
    throw new Error(
      `Archive entry must be a real nonsymlink regular file: ${path}`,
    );
  }
  assertPrivate(before.mode, before.uid, 0o600, path);
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const after = await handle.stat();
    if (
      !after.isFile() ||
      before.dev !== after.dev ||
      before.ino !== after.ino
    ) {
      throw new Error(`Archive entry changed while opening: ${path}`);
    }
    assertPrivate(after.mode, after.uid, 0o600, path);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function removeTemporary(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
}

/**
 * One caller-selected immutable evidence archive, separate from operational state.
 * The root is operator-owned and private. lstat/realpath/O_NOFOLLOW reject observed
 * symlinks; Node's path-based FS API has no dirfd guarantee against an adversarial
 * same-user directory swap. POSIX modes and hard-link/directory-fsync support are required.
 */
export class EvaluationArchive {
  private readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  static async open(root: string): Promise<EvaluationArchive> {
    return new EvaluationArchive(await prepareRoot(root));
  }

  async putBlob(bytes: Uint8Array, mediaType: string): Promise<BlobRef> {
    if (!(bytes instanceof Uint8Array))
      throw new TypeError("Archive blob requires bytes");
    // Copy before the first await so caller mutation cannot alter the hashed bytes.
    const content = Buffer.from(bytes);
    const ref = parseContentRef({
      type: "blob",
      media_type: mediaType,
      digest: hashBytes(content),
    }) as BlobRef;
    await this.publish(ref, content, async () => {
      await this.getBlob(ref);
    });
    return ref;
  }

  async getBlob(value: BlobRef): Promise<Buffer> {
    const ref = parseContentRef(value);
    if (ref.type !== "blob")
      throw new TypeError("getBlob requires a blob reference");
    const content = await this.read(ref);
    if (hashBytes(content) !== ref.digest)
      throw new Error(`Archive blob digest mismatch: ${ref.digest}`);
    return content;
  }

  async putRecord(value: ArchiveRecord): Promise<RecordRef> {
    const record = parseArchiveRecord(value);
    await this.verifyDependencies(record);
    const ref = parseContentRef({
      type: "record",
      kind: record.kind,
      digest: record.record_id,
    }) as RecordRef;
    await this.publish(
      ref,
      Buffer.from(canonicalJson(record), "utf8"),
      async () => {
        await this.getRecord(ref);
      },
    );
    return ref;
  }

  async getRecord(value: RecordRef): Promise<ArchiveRecord> {
    const ref = parseContentRef(value);
    if (ref.type !== "record")
      throw new TypeError("getRecord requires a record reference");
    const content = await this.read(ref);
    const parsed: unknown = JSON.parse(content.toString("utf8"));
    const record = parseArchiveRecord(parsed);
    if (record.record_id !== ref.digest)
      throw new Error(`Archive record digest mismatch: ${ref.digest}`);
    if (record.kind !== ref.kind)
      throw new Error(
        `Archive record kind mismatch: expected ${ref.kind}, found ${record.kind}`,
      );
    if (!content.equals(Buffer.from(canonicalJson(record), "utf8")))
      throw new Error(`Archive record is not canonical JSON: ${ref.digest}`);
    return record;
  }

  /** Explicit read-only replay of the whole declared graph; getRecord remains one-envelope. */
  async resolveClosure(refs: readonly ContentRef[]): Promise<void> {
    const pending = [...refs];
    const seen = new Set<string>();
    while (pending.length > 0) {
      const ref = parseContentRef(pending.pop());
      const key = hashCanonical(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      if (ref.type === "blob") await this.getBlob(ref);
      else pending.push(...dependencyRefs(await this.getRecord(ref)));
    }
  }

  private async verifyDependencies(record: ArchiveRecord): Promise<void> {
    for (const ref of dependencyRefs(record)) {
      if (ref.type === "blob") await this.getBlob(ref);
      else await this.getRecord(ref);
    }
  }

  private async location(
    ref: ContentRef,
  ): Promise<{ directory: string; path: string }> {
    await directory(this.root, true);
    const parent = join(this.root, ref.type === "blob" ? "blobs" : "records");
    await directory(parent, true);
    const name =
      ref.digest.slice("sha256:".length) +
      (ref.type === "record" ? ".json" : "");
    return { directory: parent, path: join(parent, name) };
  }

  private async read(ref: ContentRef): Promise<Buffer> {
    const target = await this.location(ref);
    try {
      return await readPrivateFile(target.path);
    } catch (error) {
      if (hasCode(error, "ENOENT"))
        throw new Error(
          `Archive dependency or entry is missing: ${ref.type} ${ref.digest}`,
          { cause: error },
        );
      throw error;
    }
  }

  private async publish(
    ref: ContentRef,
    bytes: Buffer,
    verify: () => Promise<void>,
  ): Promise<void> {
    const target = await this.location(ref);
    const temporary = join(target.directory, `.pending-${randomUUID()}`);
    // O_CREAT|O_EXCL is wx; add O_NOFOLLOW where the platform supplies it.
    const handle = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      // Recheck directory paths immediately before linking the same-directory temporary.
      await this.location(ref);
      try {
        await link(temporary, target.path);
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
      }
      // Both new and existing publications must validate. Never replace a corrupt final.
      await verify();
      await syncDirectory(target.directory);
    } finally {
      await removeTemporary(temporary);
      await syncDirectory(target.directory);
    }
  }
}

import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  canonicalJson,
  hashBytes,
} from "../../server/src/shared/utils/hash.ts";
import { EvaluationArchive } from "../core/archive.ts";
import { createArchiveRecord } from "../core/contracts.ts";
import type {
  ArchiveRecord,
  ArchiveRecordInput,
  ContentRef,
} from "../core/contracts.ts";

type BlobRef = Extract<ContentRef, { type: "blob" }>;
type RecordRef = Extract<ContentRef, { type: "record" }>;

async function fixture(
  t: TestContext,
): Promise<{ base: string; root: string; archive: EvaluationArchive }> {
  const base = await mkdtemp(join(tmpdir(), "evaluation-archive-"));
  t.after(async () => rm(base, { recursive: true, force: true }));
  const root = join(base, "archive");
  return { base, root, archive: await EvaluationArchive.open(root) };
}

function blobRef(bytes: string): BlobRef {
  return {
    type: "blob",
    media_type: "application/json",
    digest: hashBytes(bytes) as BlobRef["digest"],
  };
}

function entryPath(root: string, ref: ContentRef): string {
  return join(
    root,
    ref.type === "blob" ? "blobs" : "records",
    ref.digest.slice(7) + (ref.type === "record" ? ".json" : ""),
  );
}

function input(source: ContentRef): ArchiveRecordInput {
  return {
    schema_version: 1,
    kind: "task",
    provenance: {
      adapter: { id: "offline", version: "1" },
      source: { id: "fixture", version: "1" },
      refs: [source],
    },
    refs: [source],
    payload: { criterion: "retain evidence" },
  };
}

test("private archive round trips exact bytes, canonical immutable records and their dependencies", async (t) => {
  const { root, archive } = await fixture(t);
  const bytes = Buffer.from([0, 255, 195, 40]);
  const source = await archive.putBlob(bytes, "application/octet-stream");
  const record = createArchiveRecord(input(source));
  const ref = await archive.putRecord(record);
  assert.deepEqual(await archive.getBlob(source), bytes);
  assert.deepEqual(await archive.getRecord(ref), record);
  assert.ok(Object.isFrozen(await archive.getRecord(ref)));
  assert.equal(
    await readFile(entryPath(root, ref), "utf8"),
    canonicalJson(record),
  );
  for (const path of [root, join(root, "blobs"), join(root, "records")]) {
    assert.equal((await lstat(path)).mode & 0o7777, 0o700);
  }
  for (const path of [entryPath(root, source), entryPath(root, ref)]) {
    const info = await lstat(path);
    assert.equal(info.mode & 0o7777, 0o600);
    assert.equal(info.nlink, 1);
  }
  const dependent = createArchiveRecord({
    ...input(source),
    refs: [ref],
    payload: { version: 2 },
  });
  assert.deepEqual(
    await archive.getRecord(await archive.putRecord(dependent)),
    dependent,
  );
  const empty = await archive.putBlob(
    new Uint8Array(),
    "application/octet-stream",
  );
  assert.equal((await archive.getBlob(empty)).length, 0);
});

test("parallel duplicate publication is idempotent without replacing files or leaving temporaries", async (t) => {
  const { root, archive } = await fixture(t);
  const archives = await Promise.all(
    Array.from({ length: 4 }, () => EvaluationArchive.open(root)),
  );
  const bytes = Buffer.from("same immutable content");
  const refs = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      archives[i % archives.length]!.putBlob(bytes, "text/plain"),
    ),
  );
  const source = refs[0]!;
  assert.ok(refs.every((ref) => ref.digest === source.digest));
  const originalBlob = await lstat(entryPath(root, source));
  const record = createArchiveRecord(input(source));
  const recordRefs = await Promise.all(
    Array.from({ length: 20 }, () => archive.putRecord(record)),
  );
  assert.ok(recordRefs.every((ref) => ref.digest === record.record_id));
  const originalRecord = await lstat(entryPath(root, recordRefs[0]!));
  await archive.putBlob(bytes, "text/plain");
  await archive.putRecord(record);
  assert.equal((await lstat(entryPath(root, source))).ino, originalBlob.ino);
  assert.equal(
    (await lstat(entryPath(root, recordRefs[0]!))).ino,
    originalRecord.ino,
  );
  assert.deepEqual(await readdir(join(root, "blobs")), [
    source.digest.slice(7),
  ]);
  assert.deepEqual(await readdir(join(root, "records")), [
    record.record_id.slice(7) + ".json",
  ]);
});

test("blob input and returned buffers are detached from stored content", async (t) => {
  const { archive } = await fixture(t);
  const bytes = Buffer.from("original");
  const publication = archive.putBlob(bytes, "text/plain");
  bytes.fill(0);
  const ref = await publication;
  const returned = await archive.getBlob(ref);
  assert.equal(returned.toString(), "original");
  returned.fill(0);
  assert.equal((await archive.getBlob(ref)).toString(), "original");
});

test("all top-level, provenance, known usage and cost references must resolve before publication", async (t) => {
  const { root, archive } = await fixture(t);
  const source = await archive.putBlob(Buffer.from("source"), "text/plain");
  const missing = blobRef("missing");
  const candidates: ArchiveRecordInput[] = [
    { ...input(source), refs: [missing] },
    {
      ...input(source),
      provenance: { ...input(source).provenance, refs: [missing] },
    },
    {
      ...input(source),
      usage: {
        state: "known",
        unit: "tokens",
        values: { input: 0 },
        source: missing,
      },
    },
    {
      ...input(source),
      cost: { state: "known", amount: 0, currency: "USD", source: missing },
    },
  ];
  for (const candidate of candidates) {
    await assert.rejects(
      archive.putRecord(createArchiveRecord(candidate)),
      /missing/,
    );
  }
  assert.deepEqual(await readdir(join(root, "records")), []);
  const good = createArchiveRecord({
    ...input(source),
    usage: { state: "known", unit: "tokens", values: { input: 0 }, source },
    cost: { state: "known", amount: 0, currency: "USD", source },
  });
  assert.deepEqual(
    await archive.getRecord(await archive.putRecord(good)),
    good,
  );
});

test("record kind and lookup digest mismatches cannot be read or used as dependencies", async (t) => {
  const { root, archive } = await fixture(t);
  const source = await archive.putBlob(Buffer.from("source"), "text/plain");
  const record = createArchiveRecord(input(source));
  const ref = await archive.putRecord(record);
  const wrongKind: RecordRef = { ...ref, kind: "grade" };
  await assert.rejects(archive.getRecord(wrongKind), /kind mismatch/);
  await assert.rejects(
    archive.putRecord(
      createArchiveRecord({ ...input(source), refs: [wrongKind] }),
    ),
    /kind mismatch/,
  );
  const wrongDigest: RecordRef = {
    ...ref,
    digest: hashBytes("different digest") as RecordRef["digest"],
  };
  await writeFile(entryPath(root, wrongDigest), canonicalJson(record), {
    mode: 0o600,
  });
  await assert.rejects(
    archive.getRecord(wrongDigest),
    /record digest mismatch/,
  );
});

test("tampered and truncated blob finals fail reads and are never repaired or overwritten", async (t) => {
  const { root, archive } = await fixture(t);
  const bytes = Buffer.from("complete original bytes");
  const ref = await archive.putBlob(bytes, "text/plain");
  const path = entryPath(root, ref);
  for (const corrupt of [
    Buffer.from("tampered"),
    Buffer.alloc(0),
    bytes.subarray(0, 4),
  ]) {
    await writeFile(path, corrupt);
    await assert.rejects(archive.getBlob(ref), /blob digest mismatch/);
    await assert.rejects(
      archive.putBlob(bytes, "text/plain"),
      /blob digest mismatch/,
    );
    assert.deepEqual(await readFile(path), corrupt);
    assert.deepEqual(await readdir(join(root, "blobs")), [ref.digest.slice(7)]);
  }
});

test("record tampering, truncation, noncanonical bytes and malformed controls are refused", async (t) => {
  const { root, archive } = await fixture(t);
  const source = await archive.putBlob(Buffer.from("source"), "text/plain");
  const record = createArchiveRecord(input(source));
  const ref = await archive.putRecord(record);
  const path = entryPath(root, ref);
  const corruptions = [
    JSON.stringify({ ...record, payload: { tampered: true } }),
    "{",
    "",
    canonicalJson(record) + "\n",
    JSON.stringify({ ...record, extra: true }),
  ];
  for (const corrupt of corruptions) {
    await writeFile(path, corrupt);
    await assert.rejects(archive.getRecord(ref));
    await assert.rejects(archive.putRecord(record));
    assert.equal(await readFile(path, "utf8"), corrupt);
    assert.deepEqual(await readdir(join(root, "records")), [
      record.record_id.slice(7) + ".json",
    ]);
  }
});

test("orphan temporaries and missing or partial finals cannot masquerade as publications", async (t) => {
  const { root, archive } = await fixture(t);
  const orphan = join(root, "blobs", ".pending-orphan");
  const bytes = Buffer.from("unpublished");
  await writeFile(orphan, bytes, { mode: 0o600 });
  const ref = blobRef(bytes.toString());
  await assert.rejects(archive.getBlob(ref), /missing/);
  await writeFile(entryPath(root, ref), bytes.subarray(0, 2), { mode: 0o600 });
  await assert.rejects(archive.getBlob(ref), /digest mismatch/);
  await assert.rejects(
    archive.putBlob(bytes, ref.media_type),
    /digest mismatch/,
  );
  assert.deepEqual(await readFile(orphan), bytes);
});

test("malformed refs and traversal fail before filesystem paths are used", async (t) => {
  const { root, base, archive } = await fixture(t);
  const sentinel = join(base, "outside");
  await writeFile(sentinel, "unchanged", { mode: 0o600 });
  for (const digest of [
    "sha256:../../outside",
    "../../outside",
    "sha256:" + "A".repeat(64),
    "sha256:123",
  ]) {
    await assert.rejects(
      archive.getBlob({
        type: "blob",
        media_type: "text/plain",
        digest,
      } as BlobRef),
      /canonical sha256/,
    );
  }
  await assert.rejects(
    EvaluationArchive.open(`${root}/../escape`),
    /traversal/,
  );
  await assert.rejects(EvaluationArchive.open(""), /explicit path/);
  await assert.rejects(archive.putBlob(Buffer.from("bad"), ""), /nonempty/);
  await assert.rejects(
    archive.getBlob({
      type: "record",
      kind: "task",
      digest: blobRef("bad").digest,
    } as unknown as BlobRef),
    /requires a blob reference/,
  );
  await assert.rejects(
    archive.getRecord(blobRef("bad") as unknown as RecordRef),
    /requires a record reference/,
  );
  assert.equal(await readFile(sentinel, "utf8"), "unchanged");
  assert.deepEqual(await readdir(join(root, "blobs")), []);
});

test("root, ancestor and child directory symlinks are refused before and after opening", async (t) => {
  const { base, root, archive } = await fixture(t);
  const alias = join(base, "alias");
  await symlink(root, alias);
  await assert.rejects(EvaluationArchive.open(alias), /nonsymlink directory/);
  await assert.rejects(
    EvaluationArchive.open(join(alias, "nested")),
    /nonsymlink directory/,
  );
  const outside = join(base, "external");
  await mkdir(outside, { mode: 0o700 });
  await rm(join(root, "blobs"), { recursive: true });
  await symlink(outside, join(root, "blobs"));
  await assert.rejects(EvaluationArchive.open(root), /nonsymlink directory/);
  await assert.rejects(
    archive.putBlob(Buffer.from("escape"), "text/plain"),
    /nonsymlink directory/,
  );
  await assert.rejects(
    archive.getBlob(blobRef("escape")),
    /nonsymlink directory/,
  );
  assert.deepEqual(await readdir(outside), []);
  await unlink(join(root, "blobs"));
  await rm(root, { recursive: true });
  await symlink(outside, root);
  await assert.rejects(
    archive.putBlob(Buffer.from("escape"), "text/plain"),
    /nonsymlink directory/,
  );
});

test("final file symlinks and unexpected directories refuse reads and duplicate writes", async (t) => {
  const { base, root, archive } = await fixture(t);
  const bytes = Buffer.from("blob");
  const source = await archive.putBlob(bytes, "text/plain");
  const record = createArchiveRecord(input(source));
  const ref = await archive.putRecord(record);
  const outside = join(base, "outside-file");
  await writeFile(outside, bytes, { mode: 0o600 });
  await unlink(entryPath(root, ref));
  await symlink(outside, entryPath(root, ref));
  await assert.rejects(archive.getRecord(ref), /nonsymlink regular file/);
  await assert.rejects(archive.putRecord(record), /nonsymlink regular file/);
  await unlink(entryPath(root, source));
  await symlink(outside, entryPath(root, source));
  await assert.rejects(archive.getBlob(source), /nonsymlink regular file/);
  await assert.rejects(
    archive.putBlob(bytes, "text/plain"),
    /nonsymlink regular file/,
  );
  assert.deepEqual(await readFile(outside), bytes);
  await unlink(entryPath(root, source));
  await mkdir(entryPath(root, source), { mode: 0o700 });
  await assert.rejects(archive.getBlob(source), /nonsymlink regular file/);
  await assert.rejects(
    archive.putBlob(bytes, "text/plain"),
    /nonsymlink regular file/,
  );
});

test("broad permissions and non-directory roots are refused without chmodding caller paths", async (t) => {
  const { base, root, archive } = await fixture(t);
  await chmod(root, 0o755);
  await assert.rejects(EvaluationArchive.open(root), /mode 700/);
  assert.equal((await lstat(root)).mode & 0o7777, 0o755);
  await chmod(root, 0o700);
  await chmod(join(root, "blobs"), 0o755);
  await assert.rejects(
    archive.putBlob(Buffer.from("secret"), "text/plain"),
    /mode 700/,
  );
  await chmod(join(root, "blobs"), 0o700);
  const ref = await archive.putBlob(Buffer.from("secret"), "text/plain");
  await chmod(entryPath(root, ref), 0o644);
  await assert.rejects(archive.getBlob(ref), /mode 600/);
  await assert.rejects(
    archive.putBlob(Buffer.from("secret"), "text/plain"),
    /mode 600/,
  );
  const fileRoot = join(base, "file-root");
  await writeFile(fileRoot, "file", { mode: 0o600 });
  await assert.rejects(
    EvaluationArchive.open(fileRoot),
    /nonsymlink directory/,
  );
});

test("archive reopens and replays after unrelated disposable runtime state is deleted", async (t) => {
  const { base, root, archive } = await fixture(t);
  const source = await archive.putBlob(
    Buffer.from("retained native evidence"),
    "text/plain",
  );
  const record: ArchiveRecord = createArchiveRecord(input(source));
  const ref = await archive.putRecord(record);
  const runtime = join(base, "runtime-state");
  await mkdir(runtime, { mode: 0o700 });
  await writeFile(join(runtime, "state.db"), "disposable unrelated state", {
    mode: 0o600,
  });
  await rm(runtime, { recursive: true });
  const replay = await EvaluationArchive.open(root);
  assert.deepEqual(await replay.getRecord(ref), record);
  assert.equal(
    (await replay.getBlob(source)).toString(),
    "retained native evidence",
  );
});

test("explicit dependency replay detects archive loss without claiming recursive envelope validation", async (t) => {
  const { root, archive } = await fixture(t);
  const source = await archive.putBlob(Buffer.from("evidence"), "text/plain");
  const record = createArchiveRecord(input(source));
  const ref = await archive.putRecord(record);
  await unlink(entryPath(root, source));
  assert.deepEqual(await archive.getRecord(ref), record);
  await assert.rejects(archive.getBlob(source), /missing/);
  await assert.rejects(archive.putRecord(record), /missing/);
});

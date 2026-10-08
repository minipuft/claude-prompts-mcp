/**
 * Actual built CLI byte-tree proof with distinct validation boundaries.
 * The historical --no-validate control proves byte fidelity only. Separate controls
 * exercise default semantic validation and refusal without changing resource history.
 * All private/sibling data here is synthetic; no model evaluation is claimed.
 */
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { SqliteEngine } from "../../../server/src/infra/database/sqlite-engine.js";
import { recordResourceWrite } from "@cli-shared/version-history.js";
import { projectResourceSnapshot } from "@cli-shared/resource-snapshot.js";
import { hashBytes, hashFileSet } from "@shared/utils/hash.js";
import { resourceFileSet } from "@shared/utils/resource-file-set.js";
import { parseYamlOrThrow } from "@shared/utils/yaml/yaml-parser.js";
import type { Logger } from "@shared/types/index.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "../../dist/cpm.js");
const ID = "semantic-cli-proof";
const SCOPE = "semantic-cli-private-fixture";

function state(revision: 1 | 2): { yaml: string; guidance: string } {
  const first = revision === 1;
  return {
    yaml: [
      `# Public authored bytes v${revision}: keep comments, quoting and CRLF.`,
      `id: ${ID}`,
      `name: "Semantic CLI v${revision}"`,
      "type: validation",
      `description: "Public version ${revision} — café"`,
      "enabled: true",
      "guidanceFile: guidance.md",
      `calibration_suite_id: reviewed-suite-v${revision}`,
      "evaluation:",
      `  mode: ${first ? "judge" : "self"}`,
      `  model: synthetic-reviewer-v${revision}`,
      `  strict: ${first ? "true" : "false"}`,
      "pass_criteria:",
      "  - type: semantic_evaluation",
      "    id: public-answer",
      "    target:",
      "      kind: step_output",
      `    question: "Does the output meet public requirement ${revision}?"`,
      "    evidence_requirements:",
      `      min_items: ${revision}`,
      "    result:",
      "      kind: boolean",
      "    acceptance:",
      "      kind: equals",
      `      value: ${first ? "true" : "false"}`,
      "    allow_not_applicable: false",
      "",
    ].join("\r\n"),
    guidance: `# Public guidance v${revision}\r\n\r\nCite public evidence — café.\r\n`,
  };
}

const ORIGINAL = state(1);
const CURRENT = state(2);
const PRIVATE =
  '{"synthetic_private_sentinel":"never publish expected labels"}\n';
// A valid sibling keeps catalog validation meaningful while byte checks prove exclusion.
const SIBLING =
  "# synthetic sibling sentinel\nid: sibling\nname: Sibling\ntype: guidance\ndescription: Synthetic sibling exclusion control\nguidance: Retain this sibling unchanged.\n";
const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

let workspace = "";
let entry = "";
let guidance = "";
let privateFile = "";
let siblingFile = "";
let savedEnvironment: Record<string, string | undefined>;

function run(args: string[]): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  const result = spawnSync(
    process.execPath,
    [CLI, ...args, "--workspace", workspace],
    {
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        MCP_RUNTIME_ROOT: workspace,
        MCP_WORKSPACE: workspace,
      },
    },
  );
  if (result.error !== undefined) throw result.error;
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

async function recordState(
  value: { yaml: string; guidance: string },
  version: number,
): Promise<void> {
  const prior = existsSync(entry)
    ? (
        await projectResourceSnapshot(
          "gate",
          ID,
          entry,
          parseYamlOrThrow<Record<string, unknown>>(
            readFileSync(entry, "utf8"),
          ),
        )
      ).snapshot
    : undefined;
  const recorded = await recordResourceWrite(
    entry,
    { resourceType: "gate", resourceId: ID },
    {
      enumerate: () =>
        resourceFileSet({
          resourceType: "gate",
          entryPath: entry,
          roots: { primary: join(workspace, "resources/gates") },
        }),
      targets: [
        { path: entry, kind: "file" },
        { path: guidance, kind: "file" },
      ],
      ...(prior === undefined ? {} : { priorSnapshot: prior }),
      write: async () => {
        await writeFile(entry, value.yaml);
        await writeFile(guidance, value.guidance);
        return (
          await projectResourceSnapshot(
            "gate",
            ID,
            entry,
            parseYamlOrThrow<Record<string, unknown>>(
              readFileSync(entry, "utf8"),
            ),
          )
        ).snapshot;
      },
      description: `Public semantic fixture version ${version}`,
    },
  );
  expect(recorded).toMatchObject({ written: true, recorded: true, version });
}

function withDatabase<T>(read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(join(workspace, "runtime-state/state.db"), {
    readOnly: true,
  });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

function expectExcludedBytesUntouched(): void {
  expect(readFileSync(privateFile)).toEqual(Buffer.from(PRIVATE));
  expect(readFileSync(siblingFile)).toEqual(Buffer.from(SIBLING));
}

beforeEach(async () => {
  expect(existsSync(CLI)).toBe(true); // Explicit prerequisite: build the current CLI before this row check.
  workspace = mkdtempSync(join(tmpdir(), "cpm-semantic-byte-tree-"));
  savedEnvironment = {
    MCP_RUNTIME_ROOT: process.env["MCP_RUNTIME_ROOT"],
    MCP_WORKSPACE: process.env["MCP_WORKSPACE"],
  };
  process.env["MCP_RUNTIME_ROOT"] = workspace;
  process.env["MCP_WORKSPACE"] = workspace;
  entry = join(workspace, "resources/gates", ID, "gate.yaml");
  guidance = join(dirname(entry), "guidance.md");
  privateFile = join(dirname(entry), "private/expected.json");
  siblingFile = join(workspace, "resources/gates/sibling/gate.yaml");
  await mkdir(dirname(privateFile), { recursive: true });
  await mkdir(dirname(siblingFile), { recursive: true });
  await writeFile(privateFile, PRIVATE);
  await writeFile(siblingFile, SIBLING);
  await writeFile(
    join(workspace, "config.json"),
    JSON.stringify({ identity: { launchDefaults: { workspaceId: SCOPE } } }),
  );
  const engine = await SqliteEngine.getInstance(logger, {
    dbPath: join(workspace, "runtime-state/state.db"),
  });
  try {
    await engine.initialize(); // Sole DDL authority; no mirrored legacy schema.
  } finally {
    await engine.shutdown();
  }
  await recordState(ORIGINAL, 1);
  await recordState(CURRENT, 2);
});

afterEach(async () => {
  for (const [key, value] of Object.entries(savedEnvironment ?? {})) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (workspace !== "") await rm(workspace, { recursive: true, force: true });
});

describe("built cpm semantic gate version fidelity", () => {
  it("compares full public projections backed by canonical scoped byte trees with private/sibling exclusions", () => {
    withDatabase((db) => {
      const rows = db
        .prepare(
          "SELECT id, version, tenant_id, workspace_id, tree_hash, tree_origin FROM version_history WHERE resource_type = ? AND resource_id = ? ORDER BY version",
        )
        .all("gate", ID) as Array<{
        id: number;
        version: number;
        tenant_id: string;
        workspace_id: string;
        tree_hash: string;
        tree_origin: string;
      }>;
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        const expected = row.version === 1 ? ORIGINAL : CURRENT;
        expect(row.tenant_id).toBe(SCOPE);
        expect(row.workspace_id).toBe(SCOPE);
        expect(row.tree_origin).toBe("primary");
        expect(row.tree_hash).toBe(
          hashFileSet([
            { path: "gate.yaml", content: expected.yaml },
            { path: "guidance.md", content: expected.guidance },
          ]),
        );
        const files = db
          .prepare(
            "SELECT e.path, e.object_hash, o.bytes FROM version_entries e JOIN objects o ON o.tenant_id = e.tenant_id AND o.hash = e.object_hash WHERE e.version_row_id = ? AND e.tenant_id = ? ORDER BY e.path",
          )
          .all(row.id, SCOPE) as Array<{
          path: string;
          object_hash: string;
          bytes: Uint8Array;
        }>;
        expect(files.map((file) => file.path)).toEqual([
          "gate.yaml",
          "guidance.md",
        ]);
        expect(Buffer.from(files[0]!.bytes)).toEqual(
          Buffer.from(expected.yaml),
        );
        expect(Buffer.from(files[1]!.bytes)).toEqual(
          Buffer.from(expected.guidance),
        );
        for (const file of files)
          expect(file.object_hash).toBe(hashBytes(file.bytes));
      }
      for (const excluded of [PRIVATE, SIBLING]) {
        expect(
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM objects WHERE tenant_id = ? AND hash = ?",
            )
            .get(SCOPE, hashBytes(excluded)),
        ).toEqual({ count: 0 });
      }
    });
    const result = run(["compare", "gate", ID, "1", "2", "--json"]);
    expect(result.exitCode).toBe(0);
    const compared = JSON.parse(result.stdout) as {
      from: { snapshot: Record<string, unknown> };
      to: { snapshot: Record<string, unknown> };
    };
    for (const [snapshot, expected] of [
      [compared.from.snapshot, ORIGINAL],
      [compared.to.snapshot, CURRENT],
    ] as const) {
      const authored = parseYamlOrThrow<Record<string, unknown>>(expected.yaml);
      for (const key of [
        "id",
        "name",
        "type",
        "description",
        "pass_criteria",
        "calibration_suite_id",
        "evaluation",
      ])
        expect(snapshot[key]).toEqual(authored[key]);
      expect(snapshot["guidance"]).toBe(expected.guidance);
    }
    expect(result.stdout).not.toContain("synthetic_private_sentinel");
    expect(result.stdout).not.toContain("synthetic sibling sentinel");
    expectExcludedBytesUntouched();
  });

  it("previews without writes then rolls modern versions back byte-for-byte using explicit --no-validate", () => {
    const preview = run([
      "rollback",
      "gate",
      ID,
      "1",
      "--preview",
      "--no-validate",
      "--json",
    ]);
    expect(preview.exitCode).toBe(0);
    expect(JSON.parse(preview.stdout)).toMatchObject({
      preview: true,
      recorded: false,
      not_restored: [],
      files_written: expect.arrayContaining(["gate.yaml", "guidance.md"]),
    });
    expect(readFileSync(entry)).toEqual(Buffer.from(CURRENT.yaml));
    expect(readFileSync(guidance)).toEqual(Buffer.from(CURRENT.guidance));
    expect(
      withDatabase((db) =>
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM version_history WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?",
          )
          .get(SCOPE, "gate", ID),
      ),
    ).toEqual({ count: 2 });
    for (const [version, expected] of [
      [1, ORIGINAL],
      [2, CURRENT],
    ] as const) {
      const restored = run([
        "rollback",
        "gate",
        ID,
        String(version),
        "--no-validate",
        "--json",
      ]);
      expect(restored.exitCode).toBe(0);
      expect(JSON.parse(restored.stdout)).toMatchObject({
        preview: false,
        recorded: true,
        restored_version: version,
        not_restored: [],
        files_written: expect.arrayContaining(["gate.yaml", "guidance.md"]),
      });
      expect(readFileSync(entry)).toEqual(Buffer.from(expected.yaml));
      expect(readFileSync(guidance)).toEqual(Buffer.from(expected.guidance));
      expectExcludedBytesUntouched();
    }
  });

  it("default validation accepts semantic public definitions and compare/rollback retains exact bytes and exclusions", () => {
    const compared = run(["compare", "gate", ID, "1", "2", "--json"]);
    expect(compared.exitCode).toBe(0);
    const snapshots = JSON.parse(compared.stdout) as {
      from: { snapshot: Record<string, unknown> };
      to: { snapshot: Record<string, unknown> };
    };
    for (const [snapshot, expected] of [
      [snapshots.from.snapshot, ORIGINAL],
      [snapshots.to.snapshot, CURRENT],
    ] as const) {
      const authored = parseYamlOrThrow<Record<string, unknown>>(expected.yaml);
      for (const field of [
        "pass_criteria",
        "calibration_suite_id",
        "evaluation",
      ])
        expect(snapshot[field]).toEqual(authored[field]);
      expect(snapshot["guidance"]).toBe(expected.guidance);
    }
    const validate = () => {
      const checked = run(["validate", "--gates", "--json"]);
      expect(checked.exitCode).toBe(0);
      expect(JSON.parse(checked.stdout)).toMatchObject({
        valid: true,
        summary: { total: 2, invalid: 0 },
      });
    };
    validate();
    for (const [version, expected] of [
      [1, ORIGINAL],
      [2, CURRENT],
    ] as const) {
      // No --no-validate: the CLI's canonical verifier runs after restoring the real tree.
      const restored = run(["rollback", "gate", ID, String(version), "--json"]);
      expect(restored.exitCode).toBe(0);
      expect(JSON.parse(restored.stdout)).toMatchObject({
        recorded: true,
        restored_version: version,
        not_restored: [],
        files_written: expect.arrayContaining(["gate.yaml", "guidance.md"]),
      });
      expect(readFileSync(entry)).toEqual(Buffer.from(expected.yaml));
      expect(readFileSync(guidance)).toEqual(Buffer.from(expected.guidance));
      expectExcludedBytesUntouched();
      validate();
    }
  });

  it("default rollback refuses a malformed semantic historical definition and restores current bytes without recording success", async () => {
    const malformed = {
      ...ORIGINAL,
      yaml: ORIGINAL.yaml.replace("min_items: 1", "min_items: 0"),
    };
    await recordState(malformed, 3);
    await recordState(CURRENT, 4);
    const rows = () =>
      withDatabase((db) =>
        db
          .prepare(
            "SELECT version, snapshot, tree_hash FROM version_history WHERE tenant_id = ? AND resource_type = ? AND resource_id = ? ORDER BY version",
          )
          .all(SCOPE, "gate", ID),
      );
    const before = rows();
    const refused = run(["rollback", "gate", ID, "3", "--json"]);
    expect(refused.exitCode).toBe(1);
    const failure = JSON.parse(refused.stdout) as {
      error: string;
      validation: { valid: boolean; errors: Array<{ path: string }> };
      rollback: { performed: boolean };
    };
    expect(failure.error).toContain("failed validation");
    expect(failure.validation.valid).toBe(false);
    expect(failure.rollback.performed).toBe(true);
    expect(
      failure.validation.errors.some(
        (issue) =>
          issue.path.includes("pass_criteria") &&
          issue.path.includes("min_items"),
      ),
    ).toBe(true);
    expect(readFileSync(entry)).toEqual(Buffer.from(CURRENT.yaml));
    expect(readFileSync(guidance)).toEqual(Buffer.from(CURRENT.guidance));
    expectExcludedBytesUntouched();
    expect(rows()).toEqual(before);
  });
});

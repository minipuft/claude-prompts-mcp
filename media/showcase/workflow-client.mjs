#!/usr/bin/env node
// Canonical MCP resource installer and receipt-producing smoke client; never executes a render.
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { access, mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import os from "node:os";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const serverRoot = path.join(repoRoot, "server");
const mediaRoot = path.dirname(fileURLToPath(import.meta.url));
const specPath = path.join(mediaRoot, "workflow-spec.json");
const modes = new Set(["install", "inspect", "smoke", "call", "drive"]);
const usage =
  "workflow-client.mjs install|inspect|smoke|call|drive [--server-entry PATH] [--evidence-dir PATH] [--payload PATH] [--mailbox DIR]";

function parseArguments(argv) {
  const [mode, ...rest] = argv;
  if (!modes.has(mode)) throw new Error(usage);
  const result = { mode };
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (
      !["--server-entry", "--evidence-dir", "--payload", "--mailbox"].includes(key) ||
      !rest[i + 1]
    ) {
      throw new Error(usage);
    }
    result[key.slice(2)] = rest[i + 1];
  }
  return result;
}

async function loadSdk() {
  const dependencyRoots = [serverRoot];
  if (process.env.SHOWCASE_MCP_CLIENT_ROOT)
    dependencyRoots.push(process.env.SHOWCASE_MCP_CLIENT_ROOT);
  for (const root of dependencyRoots) {
    const require = createRequire(
      path.join(path.resolve(root), "package.json"),
    );
    let clientPath;
    let transportPath;
    try {
      clientPath = require.resolve("@modelcontextprotocol/client");
      transportPath = require.resolve("@modelcontextprotocol/client/stdio");
    } catch (error) {
      if (error.code !== "MODULE_NOT_FOUND") throw error;
      continue;
    }
    const [client, transport] = await Promise.all([
      import(pathToFileURL(clientPath).href),
      import(pathToFileURL(transportPath).href),
    ]);
    return {
      Client: client.Client,
      StdioClientTransport: transport.StdioClientTransport,
      getDefaultEnvironment: transport.getDefaultEnvironment,
    };
  }
  throw new Error(
    "Install @modelcontextprotocol/client@2.0.0 in a private prefix, then set SHOWCASE_MCP_CLIENT_ROOT. Do not install through shared server/node_modules.",
  );
}

function textOf(result) {
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function selectEntry(override) {
  const entry = path.resolve(
    override ??
      process.env.SHOWCASE_SERVER_ENTRY ??
      path.join(serverRoot, "dist/index.js"),
  );
  await access(entry, constants.R_OK);
  return entry;
}

function assertReceipt(result, id) {
  const data = result.structuredContent;
  const text = textOf(result);
  const receipt = data?.receipt;
  if (
    result.isError ||
    data?.mutated !== true ||
    receipt?.id !== id ||
    receipt.resource_root !== path.join(serverRoot, "resources/prompts") ||
    receipt.loaded_after_refresh !== true ||
    !Number.isInteger(receipt.current_version)
  )
    throw new Error(
      "Missing successful mutation receipt for " + id + ": " + text,
    );
  return data;
}

class WorkflowClient {
  constructor(client, evidenceDirectory) {
    this.client = client;
    this.evidenceDirectory = evidenceDirectory;
    this.sequence = 0;
  }

  async call(label, name, args, { allowError = false } = {}) {
    this.sequence += 1;
    const prefix = String(this.sequence).padStart(3, "0") + "-" + label;
    await writeFile(
      path.join(this.evidenceDirectory, prefix + ".request.json"),
      JSON.stringify({ name, arguments: args }, null, 2) + "\n",
    );
    const result = await this.client.callTool(
      { name, arguments: args },
      { timeout: 600000 }, // a shell_verify gate may run the inbetween probe for ~60 s; the old 60 s killed a drive mid-gate (2026-10-15)
    );
    await writeFile(
      path.join(this.evidenceDirectory, prefix + ".response.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    if (result.isError && !allowError)
      throw new Error(label + ": " + textOf(result));
    return result;
  }

  async confirmRouting() {
    const result = await this.call("routing", "resource_manager", {
      resource_type: "prompt",
      action: "inspect",
      id: "review",
      detail: "full",
    });
    const actual = result.structuredContent?.source_root;
    const expected = path.join(serverRoot, "resources/prompts");
    if (actual !== expected)
      throw new Error(
        "Refusing mutations: prompt source root " +
          actual +
          " does not match " +
          expected,
      );
    return {
      sourceRoot: actual,
      serverRoot: result.structuredContent?.server_root,
    };
  }

  async inspect(resources) {
    for (const resource of resources) {
      await this.call("inspect-" + resource.id, "resource_manager", {
        resource_type: "prompt",
        action: "inspect",
        id: resource.id,
        detail: "full",
      });
    }
  }

  async install(resources) {
    for (const resource of resources) {
      const existing = await this.call(
        "existing-" + resource.id,
        "resource_manager",
        {
          resource_type: "prompt",
          action: "inspect",
          id: resource.id,
          detail: "full",
        },
        { allowError: true },
      );
      if (!existing.isError) {
        const preview = await this.call(
          "preview-" + resource.id,
          "resource_manager",
          { ...resource, action: "preview", preview_action: "update" },
        );
        const version =
          preview.structuredContent?.current_version ??
          existing.structuredContent?.current_version;
        if (!Number.isInteger(version))
          throw new Error("No current version for " + resource.id);
        assertReceipt(
          await this.call("update-" + resource.id, "resource_manager", {
            ...resource,
            action: "update",
            expected_version: version,
          }),
          resource.id,
        );
      } else {
        const message = textOf(existing);
        if (!/not found|does not exist|unknown prompt/i.test(message))
          throw new Error("Unexpected inspect error: " + message);
        const validation = await this.call(
          "validate-" + resource.id,
          "resource_manager",
          { ...resource, action: "validate" },
        );
        if (
          validation.structuredContent?.valid !== true ||
          validation.structuredContent?.mutated !== false
        ) {
          throw new Error("Validation failed or mutated for " + resource.id);
        }
        assertReceipt(
          await this.call("create-" + resource.id, "resource_manager", {
            ...resource,
            action: "create",
          }),
          resource.id,
        );
      }
      await this.call("installed-" + resource.id, "resource_manager", {
        resource_type: "prompt",
        action: "inspect",
        id: resource.id,
        detail: "full",
      });
    }
  }

  // drive: run one chain to completion with the server kept alive. Each rendered step lands in
  // <mailbox>/NN-step.md; the session answers in <mailbox>/NN-reply.md (plain text = user_response,
  // or a JSON object = extra prompt_engine fields such as gate_verdict). Chain runs are per-process
  // (chain_runs is PID-scoped), so a chain cannot be resumed across separate `call` launches.
  async drive(payload, mailbox) {
    await mkdir(mailbox, { recursive: true });
    let step = 0;
    let result = await this.call("drive-start", payload.name, payload.arguments);
    let chainId;
    for (;;) {
      step += 1;
      const text = textOf(result);
      const nn = String(step).padStart(2, "0");
      const found = /chain_id[=:]\s*["']?(chain-[A-Za-z0-9_#-]+)/.exec(text)?.[1];
      if (found) chainId = found;
      await writeFile(path.join(mailbox, nn + "-step.md"), text + "\n");
      const done = !result.isError && (!/chain_id[=:]/.test(text) || (/Execution complete|chain completed|Chain complete/i.test(text) && !/Continue:/.test(text)));
      await writeFile(path.join(mailbox, "status.json"), JSON.stringify({ step, chainId, done, at: new Date().toISOString() }) + "\n");
      if (done || !chainId) return { steps: step, chainId };
      const replyPath = path.join(mailbox, nn + "-reply.md");
      // A refusal keeps NN: the refusal lands in NN-error.md, the consumed reply is renamed to
      // NN-reply.refused-K.md, and the session answers again in NN-reply.md. The step number
      // only advances when the server accepts a reply.
      for (let refusals = 0; ; refusals += 1) {
        const raw = await this.awaitReply(replyPath);
        let args = { chain_id: chainId, user_response: raw };
        if (raw.trimStart().startsWith("{")) args = { chain_id: chainId, ...JSON.parse(raw) };
        // A reply carrying BOTH the step's answer and a gate verdict in one call is accepted by the
        // server without running the step's shell checks (measured 2026-10-16, ~/.cache/gate-diag2:
        // the verdict opens a review nobody graded), and the engine's own `Next:` footer advertises
        // that form. The driver never sends it: the answer goes alone, and a verdict that rode with
        // it is held and sent on its own once the server renders the review.
        let heldVerdict = null;
        if (args.user_response !== undefined && args.gate_verdict !== undefined) {
          heldVerdict = args.gate_verdict;
          args = { chain_id: chainId, user_response: args.user_response };
          await writeFile(path.join(mailbox, nn + "-split.md"), "answer sent alone; the verdict follows once the review renders (the combined form skips shell checks)\n");
        }
        const label = "drive-step-" + nn + (refusals ? "-retry" + refusals : "");
        result = await this.call(label, "prompt_engine", args, { allowError: true });
        if (!result.isError && heldVerdict && /Gate Review Required|GATE_REVIEW|Shell Verification Results/i.test(textOf(result))) {
          await writeFile(path.join(mailbox, nn + "-review.md"), textOf(result) + "\n");
          result = await this.call(label + "-verdict", "prompt_engine", { chain_id: chainId, gate_verdict: heldVerdict }, { allowError: true });
        }
        if (!result.isError) break;
        await writeFile(path.join(mailbox, nn + "-error.md"), textOf(result) + "\n");
        await rename(replyPath, path.join(mailbox, nn + "-reply.refused-" + (refusals + 1) + ".md"));
      }
    }
  }

  async awaitReply(replyPath) {
    const deadline = Date.now() + 6 * 60 * 60 * 1000;
    while (Date.now() < deadline) {
      try { await access(replyPath, constants.R_OK); break; } catch { await new Promise((r) => setTimeout(r, 2000)); }
    }
    // A reply is accepted only once it is non-empty and unchanged across two reads 500 ms apart,
    // so a file still being written is never submitted as an empty user_response.
    for (;;) {
      const first = await readFile(replyPath, "utf8");
      await new Promise((r) => setTimeout(r, 500));
      const second = await readFile(replyPath, "utf8");
      if (first.trim().length > 0 && first === second) return first;
    }
  }

  async smoke() {
    const sentinel = "SMOKE_BOARD_HANDOFF_7D3A";
    const brief =
      "SMOKE: recorded validation fixture for silent showcase mapping; do not produce creative work.";
    const start = await this.call("smoke-start", "prompt_engine", {
      command: "%clean >>showcase_preproduction",
      inputs: {
        brief,
        constraints:
          "SMOKE fixture only. No creative evaluation, no filesystem changes, no executable check or publication.",
        output_root: "media/showcase/output",
      },
    });
    const text = textOf(start);
    const chainId = /chain_id[=:]\s*["']?(chain-[A-Za-z0-9_#-]+)/.exec(
      text,
    )?.[1];
    if (!chainId) throw new Error("Smoke start returned no chain id: " + text);
    const fixtureOutput = (node, resultSentinel) =>
      "SMOKE: recorded validation fixture. " +
      resultSentinel +
      "\nNo creative work was performed. This is a literal result-propagation probe, not a worker execution receipt.\n\nHANDOFF RESULT\nnode: " +
      node;
    let summary;
    let sessionAfter;
    let baselineResponse;
    let cancelledText = "";
    try {
      const baseline = await this.call(
        "smoke-session-before",
        "system_control",
        { action: "session", operation: "list" },
      );
      baselineResponse = baseline;
      const handoff = fixtureOutput("board", sentinel);
      const next = await this.call("smoke-handoff", "prompt_engine", {
        chain_id: chainId,
        user_response: handoff,
      });
      const rendered = textOf(next);
      const handoffChecks = [];
      const fixtures = [
        {
          node: "story",
          sentinel: "SMOKE_STORY_RESULT_7D3A",
          next: "Write `v3/shots.json`",
        },
        {
          node: "shots",
          sentinel: "SMOKE_SHOTS_RESULT_7D3A",
          next: "Return: Inspected Evidence; Grades",
        },
      ];
      for (const fixture of fixtures) {
        const reply = fixtureOutput(fixture.node, fixture.sentinel);
        const response = await this.call(
          "smoke-" + fixture.node + "-result",
          "prompt_engine",
          { chain_id: chainId, user_response: reply },
        );
        const body = textOf(response);
        const check = {
          from: fixture.node,
          expectedNext: fixture.next,
          outputSentinelPresent: body.includes(fixture.sentinel),
          nextPromptPresent: body.includes(fixture.next),
          previousHandoffInContext: body.includes("Previous handoff:\n" + reply),
        };
        handoffChecks.push(check);
        if (Object.values(check).some((value) => value === false)) {
          await writeFile(
            path.join(this.evidenceDirectory, "smoke-handoff-checks.json"),
            JSON.stringify(handoffChecks, null, 2) + "\n",
          );
          throw new Error(
            "Mapped handoff failed for " +
              fixture.node +
              "; see saved response.",
          );
        }
      }
      summary = {
        evidenceClass: "explicitly labeled smoke fixture",
        chain: "showcase_preproduction",
        chainId,
        handoffSentinel: sentinel,
        sentinelPresent: rendered.includes(sentinel),
        storyTemplatePresent:
          rendered.includes("Write or revise the silent script") ||
          rendered.includes("showcase_story"),
        briefMapped: text.includes(brief),
        boardOutputInStoryContext: rendered.includes(
          "Previous handoff:\n" + handoff,
        ),
        briefPresent: rendered.includes(brief),
        gateVerdictSubmitted: false,
        creativeProductionExecuted: false,
        modifier:
          "%clean: protocol/mapping probe only; production gate reviews not exercised",
        handoffChecks,
        stepsRendered: ["board", "story", "shots", "grade"],
        beforeSessionResponseRecorded: Boolean(baseline),
      };
      if (
        !summary.sentinelPresent ||
        !summary.storyTemplatePresent ||
        !summary.briefPresent ||
        !summary.briefMapped ||
        !summary.boardOutputInStoryContext
      ) {
        await writeFile(
          path.join(this.evidenceDirectory, "smoke-summary.json"),
          JSON.stringify(summary, null, 2) + "\n",
        );
        throw new Error(
          "Next-step mapping not proved. See saved responses; no verdict fabricated.",
        );
      }
    } finally {
      const cancelled = await this.call("smoke-cancel", "prompt_engine", {
        chain_id: chainId,
        cancel: true,
      });
      cancelledText = textOf(cancelled);
      await writeFile(
        path.join(this.evidenceDirectory, "smoke-cancellation.txt"),
        cancelledText + "\n",
      );
      sessionAfter = await this.call("smoke-session-after", "system_control", {
        action: "session",
        operation: "list",
      });
    }
    const progressOf = (response) =>
      /\*\*Progress\*\*: Step (\d+\/\d+)/.exec(textOf(response))?.[1];
    summary.chainCancelledNotice = cancelledText.includes("Chain Cancelled");
    summary.sessionProgressBefore = progressOf(baselineResponse);
    summary.sessionProgressAfter = progressOf(sessionAfter);
    if (
      !summary.chainCancelledNotice ||
      summary.sessionProgressBefore !== "1/4" ||
      summary.sessionProgressAfter !== "4/4"
    )
      throw new Error(
        "Session listing did not show 1/4 before and 4/4 after, or the cancel notice is missing: " +
          JSON.stringify(summary),
      );
    await writeFile(
      path.join(this.evidenceDirectory, "smoke-summary.json"),
      JSON.stringify(summary, null, 2) + "\n",
    );
    return summary;
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const sdk = await loadSdk();
  const entry = await selectEntry(args["server-entry"]);
  const evidenceRoot = path.resolve(
    args["evidence-dir"] ?? path.join(mediaRoot, "evidence"),
  );
  await mkdir(evidenceRoot, { recursive: true });
  const evidenceDirectory = await mkdtemp(
    path.join(evidenceRoot, args.mode + "-"),
  );
  const runtimeRoot = await mkdtemp(
    path.join(os.tmpdir(), "showcase-mcp-runtime-"),
  );
  const env = {
    ...sdk.getDefaultEnvironment(),
    MCP_WORKSPACE: serverRoot,
    MCP_RESOURCES_PATH: path.join(serverRoot, "resources"),
    MCP_RUNTIME_ROOT: runtimeRoot,
    // Animation gates (plan animation-scaffold-2026-10-14 row 2.4, D81): the isolated server may run only the
    // probe scripts under scripts/animation, and only inside this media root. Prefix entries, newline-separated.
    MCP_SHELL_VERIFY_ALLOWLIST: [
      "python3 scripts/animation/*",
      "node scripts/animation/*",
    ].join("\n"),
    MCP_SHELL_VERIFY_ALLOWED_DIRS: mediaRoot,
  };
  const transport = new sdk.StdioClientTransport({
    command: process.execPath,
    args: [entry, "--transport=stdio", "--quiet"],
    cwd: serverRoot,
    env,
    stderr: "pipe",
  });
  let serverStderr = "";
  transport.stderr?.on("data", (chunk) => {
    serverStderr += chunk.toString();
  });
  const client = new sdk.Client({
    name: "showcase-workflow-client",
    version: "1.0.0",
  });
  await writeFile(
    path.join(evidenceDirectory, "launch.json"),
    JSON.stringify(
      {
        command: process.execPath,
        args: [entry, "--transport=stdio", "--quiet"],
        cwd: serverRoot,
        pathSettings: {
          workspace: serverRoot,
          resources: env.MCP_RESOURCES_PATH,
          runtime: runtimeRoot,
        },
        sdkVersion: "2.x: resolved from installed package",
        mode: args.mode,
      },
      null,
      2,
    ) + "\n",
  );
  try {
    await client.connect(transport);
    const workflow = new WorkflowClient(client, evidenceDirectory);
    await workflow.confirmRouting();
    const spec = JSON.parse(await readFile(specPath, "utf8"));
    if (args.mode === "install") await workflow.install(spec.resources);
    if (args.mode === "inspect") await workflow.inspect(spec.resources);
    if (args.mode === "smoke")
      console.log(JSON.stringify(await workflow.smoke()));
    if (args.mode === "drive") {
      if (!args["payload"] || !args["mailbox"])
        throw new Error("drive requires --payload {name,arguments} and --mailbox DIR.");
      const payload = JSON.parse(await readFile(path.resolve(args["payload"]), "utf8"));
      console.log(JSON.stringify(await workflow.drive(payload, path.resolve(args["mailbox"]))));
    }
    if (args.mode === "call") {
      if (!args["payload"])
        throw new Error("call requires --payload containing {name,arguments}.");
      const payload = JSON.parse(
        await readFile(path.resolve(args["payload"]), "utf8"),
      );
      if (
        !["resource_manager", "prompt_engine", "system_control"].includes(
          payload.name,
        )
      )
        throw new Error("Only the three canonical MCP tools are accepted.");
      await workflow.call("caller-payload", payload.name, payload.arguments);
    }
    console.log(args.mode + " completed; MCP receipts: " + evidenceDirectory);
  } finally {
    await client.close();
    await writeFile(
      path.join(evidenceDirectory, "server-stderr.log"),
      serverStderr,
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

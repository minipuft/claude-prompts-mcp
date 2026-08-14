#!/usr/bin/env node
/** Request a Mend-hosted Renovate run only after remote delivery guards pass. */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPOSITORY = "minipuft/claude-prompts-mcp";
const DASHBOARD_ISSUE = 157;
const CONFIG_PATH = ".github/renovate.json5";
const REQUIRED_CONTEXTS = ["Build", "CLI", "Lint & Validate", "Test Suite"];
const REQUIRED_HEAD_CHECKS = [
  ...REQUIRED_CONTEXTS,
  "Validate Renovate Configuration",
  "release-please",
];
const REQUEST_MARKER =
  "- [ ] <!-- manual job -->Check this box to trigger a request for Renovate to run again on this repository";
const REQUESTED_MARKER = REQUEST_MARKER.replace("[ ]", "[x]");
const REPO_ROOT = path.join(__dirname, "..");

function ghApi(apiPath, { method = "GET", body } = {}) {
  const args = ["api", apiPath, "--method", method];
  const options = {
    encoding: "utf8",
    stdio: [body ? "pipe" : "ignore", "pipe", "pipe"],
  };
  if (body) {
    args.push("--input", "-");
    options.input = JSON.stringify(body);
  }
  try {
    return JSON.parse(execFileSync("gh", args, options));
  } catch (error) {
    const detail = error.stderr?.trim() || error.message;
    throw new Error(`GitHub API request failed for ${apiPath}: ${detail}`);
  }
}

function gitBlobSha(file) {
  const content = fs.readFileSync(file);
  return crypto
    .createHash("sha1")
    .update(`blob ${content.length}\0`)
    .update(content)
    .digest("hex");
}

function loadSnapshot() {
  const prefix = `repos/${REPOSITORY}`;
  const branch = ghApi(`${prefix}/branches/main`);
  const mainSha = branch.commit.sha;
  return {
    branch,
    protection: ghApi(
      `${prefix}/branches/main/protection/required_status_checks`,
    ),
    permissions: ghApi(`${prefix}/actions/permissions`),
    remoteConfig: ghApi(`${prefix}/contents/${CONFIG_PATH}?ref=main`),
    checks: ghApi(`${prefix}/commits/${mainSha}/check-runs?per_page=100`)
      .check_runs,
    dashboard: ghApi(`${prefix}/issues/${DASHBOARD_ISSUE}`),
  };
}

function validateSnapshot(snapshot, localConfigSha) {
  const errors = [];
  if (!snapshot.branch.protected) errors.push("remote main is not protected");
  if (!snapshot.protection.strict)
    errors.push("remote main does not require up-to-date branches");
  const contexts = [...(snapshot.protection.contexts || [])].sort();
  if (JSON.stringify(contexts) !== JSON.stringify(REQUIRED_CONTEXTS)) {
    errors.push(`required contexts changed: [${contexts.join(", ")}]`);
  }
  if (
    !snapshot.permissions.enabled ||
    !snapshot.permissions.sha_pinning_required
  ) {
    errors.push("GitHub Actions or full-SHA enforcement is disabled");
  }
  if (snapshot.remoteConfig.sha !== localConfigSha) {
    errors.push("local Renovate config does not match remote main");
  }
  for (const name of REQUIRED_HEAD_CHECKS) {
    const passed = snapshot.checks.some(
      (check) => check.name === name && check.conclusion === "success",
    );
    if (!passed) errors.push(`remote main has no successful '${name}' check`);
  }
  if (snapshot.dashboard.state !== "open")
    errors.push("dependency dashboard is not open");
  if (snapshot.dashboard.title !== "📦 Dependency Updates Dashboard") {
    errors.push("dependency dashboard title changed");
  }
  const requestCount = snapshot.dashboard.body.split(REQUEST_MARKER).length - 1;
  const requestedCount =
    snapshot.dashboard.body.split(REQUESTED_MARKER).length - 1;
  if (requestCount !== 1 || requestedCount !== 0) {
    errors.push(
      "dashboard run marker is missing, duplicated, or already requested",
    );
  }
  return errors;
}

function healthyFixture() {
  return {
    branch: { protected: true },
    protection: { strict: true, contexts: [...REQUIRED_CONTEXTS] },
    permissions: { enabled: true, sha_pinning_required: true },
    remoteConfig: { sha: "config-sha" },
    checks: REQUIRED_HEAD_CHECKS.map((name) => ({
      name,
      conclusion: "success",
    })),
    dashboard: {
      state: "open",
      title: "📦 Dependency Updates Dashboard",
      body: `header\n${REQUEST_MARKER}\n`,
    },
  };
}

function runSelfTest() {
  const cases = [
    ["healthy snapshot", (value) => value, true],
    [
      "unprotected main",
      (value) => ((value.branch.protected = false), value),
      false,
    ],
    [
      "stale local config",
      (value) => ((value.remoteConfig.sha = "other"), value),
      false,
    ],
    [
      "missing protected check",
      (value) => (value.protection.contexts.pop(), value),
      false,
    ],
    [
      "failed main validation",
      (value) => ((value.checks[0].conclusion = "failure"), value),
      false,
    ],
    [
      "request already pending",
      (value) => ((value.dashboard.body = REQUESTED_MARKER), value),
      false,
    ],
  ];
  let failures = 0;
  for (const [name, mutate, expected] of cases) {
    const passed =
      validateSnapshot(mutate(healthyFixture()), "config-sha").length === 0;
    console.log(`  ${passed === expected ? "ok  " : "FAIL"}  ${name}`);
    if (passed !== expected) failures += 1;
  }
  process.exitCode = failures ? 1 : 0;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return runSelfTest();
  const unknown = args.filter((arg) => arg !== "--apply");
  if (unknown.length)
    throw new Error(`unknown argument(s): ${unknown.join(", ")}`);

  const configSha = gitBlobSha(path.join(REPO_ROOT, CONFIG_PATH));
  const snapshot = loadSnapshot();
  const errors = validateSnapshot(snapshot, configSha);
  if (errors.length) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `PASSED: remote Renovate run guards at main ${snapshot.branch.commit.sha}`,
  );
  if (!args.includes("--apply")) {
    console.log("DRY RUN: pass --apply to request the hosted run");
    return;
  }

  const latestSnapshot = loadSnapshot();
  const latestErrors = validateSnapshot(latestSnapshot, configSha);
  if (latestErrors.length) {
    throw new Error(
      `remote guards changed after preflight: ${latestErrors.join("; ")}`,
    );
  }
  if (
    latestSnapshot.branch.commit.sha !== snapshot.branch.commit.sha ||
    latestSnapshot.dashboard.updated_at !== snapshot.dashboard.updated_at ||
    latestSnapshot.dashboard.body !== snapshot.dashboard.body
  ) {
    throw new Error(
      "remote main or dashboard changed after preflight; rerun the command",
    );
  }
  const requestedBody = latestSnapshot.dashboard.body.replace(
    REQUEST_MARKER,
    REQUESTED_MARKER,
  );
  const updated = ghApi(`repos/${REPOSITORY}/issues/${DASHBOARD_ISSUE}`, {
    method: "PATCH",
    body: { body: requestedBody },
  });
  if (updated.body !== requestedBody)
    throw new Error("dashboard request was not preserved exactly");
  console.log(`REQUESTED: hosted Renovate run via ${updated.html_url}`);
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}

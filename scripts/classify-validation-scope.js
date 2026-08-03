#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const ROOT_DOCUMENTATION = new Set([
  "AGENTS.md",
  "CHANGELOG.md",
  "CLAUDE.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "README.md",
  "SECURITY.md",
]);

function isDocumentationPath(path) {
  return (
    ROOT_DOCUMENTATION.has(path) ||
    /^(?:docs|plans)\/.*\.md$/i.test(path) ||
    /^(?:cli|server)\/README\.md$/i.test(path)
  );
}

function normalizePaths(input) {
  return input
    .split(/\r?\n/u)
    .map((path) => path.trim().replace(/^\.\//u, ""))
    .filter(Boolean);
}

function classifyValidationScope(paths) {
  if (paths.length === 0) {
    return {
      scope: "full",
      reason: "No changed paths were supplied; validation fails closed.",
    };
  }

  let includesHooks = false;

  for (const path of paths) {
    if (
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").includes("..")
    ) {
      return {
        scope: "full",
        reason: `Unrecognized path syntax fails closed: ${path}`,
      };
    }

    if (isDocumentationPath(path)) {
      continue;
    }

    if (path.startsWith("hooks/")) {
      includesHooks = true;
      continue;
    }

    return {
      scope: "full",
      reason: `Executable, configuration, mixed, or unknown path changed: ${path}`,
    };
  }

  if (includesHooks) {
    return {
      scope: "hooks",
      reason: "Only Python hooks and documentation changed.",
    };
  }

  return {
    scope: "docs",
    reason: "Only Markdown documentation changed.",
  };
}

function runSelfTests() {
  const cases = [
    { paths: ["README.md"], expected: "docs" },
    { paths: ["plans/release.md", "docs/guides/setup.md"], expected: "docs" },
    { paths: ["hooks/validate.py"], expected: "hooks" },
    { paths: ["hooks/validate.py", "docs/hooks.md"], expected: "hooks" },
    { paths: ["server/src/index.ts"], expected: "full" },
    { paths: ["server/README.md", "server/package.json"], expected: "full" },
    { paths: [".github/workflows/ci.yml"], expected: "full" },
    { paths: ["docs/guides/setup.mdx"], expected: "full" },
    { paths: ["server/prompts/example/user-message.md"], expected: "full" },
    { paths: [".claude/rules/release.md"], expected: "full" },
    { paths: ["notes.md"], expected: "full" },
    {
      paths: ["plans/retired.md", "scripts/build-extension.sh"],
      expected: "full",
    },
    { paths: ["deleted/source.ts"], expected: "full" },
    { paths: [], expected: "full" },
    { paths: ["../outside.md"], expected: "full" },
    { paths: ["docs\\windows.md"], expected: "full" },
  ];

  for (const testCase of cases) {
    assert.equal(
      classifyValidationScope(testCase.paths).scope,
      testCase.expected,
      `unexpected scope for ${JSON.stringify(testCase.paths)}`,
    );
  }

  assert.deepEqual(normalizePaths("./README.md\r\n\n hooks/test.py \n"), [
    "README.md",
    "hooks/test.py",
  ]);

  process.stdout.write(
    `Validation scope classifier: ${cases.length + 1} checks passed\n`,
  );
}

function writeGitHubOutputs(outputPath, result) {
  const lines = [
    `scope=${result.scope}`,
    `full=${result.scope === "full"}`,
    `python=${result.scope === "hooks" || result.scope === "full"}`,
  ];
  fs.appendFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--self-test")) {
    runSelfTests();
    return;
  }

  const paths = normalizePaths(fs.readFileSync(0, "utf8"));
  const result = classifyValidationScope(paths);
  const outputIndex = args.indexOf("--github-output");

  if (outputIndex !== -1) {
    const outputPath = args[outputIndex + 1];
    if (!outputPath) {
      throw new Error("--github-output requires a file path");
    }
    writeGitHubOutputs(outputPath, result);
  }

  if (args.includes("--scope")) {
    process.stdout.write(`${result.scope}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify({ ...result, paths })}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  classifyValidationScope,
  isDocumentationPath,
  normalizePaths,
};

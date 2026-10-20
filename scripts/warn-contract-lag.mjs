#!/usr/bin/env node
/**
 * Warns, on a pull request, when this repository's delivery contract is older than the latest
 * minipuft/repository-standards release. Never fails.
 *
 * WHY IT EXISTS. Measured 2026-10-20: six fleet repositories sat at template 1.7.0 while
 * repository-standards had released 1.10.1, three minor versions of fixes later, and nothing
 * anywhere reported it. The fleet audit in repository-standards now FAILS on that lag; this step
 * is the downstream half, and it only warns. A new upstream release changes nothing a pull request
 * controls, so failing here would turn every open pull request red on the day of a release, and
 * the fix (adopting the release) is its own pull request, not a change to the one being checked.
 *
 * WHAT IT DOES. Reads `templateVersion` from `.delivery-contract.json` at the working directory,
 * reads the latest published release of minipuft/repository-standards from the GitHub API, and
 * when the contract is behind, prints one warning naming both versions and the remedy. Under
 * GitHub Actions the warning is a `::warning::` annotation; elsewhere it starts with `warning: `,
 * the convention `validate-pr-body.mjs` uses. Current: prints nothing. A missing contract file, an
 * unreadable version or a failed request prints one plain line saying the comparison was skipped.
 *
 * EXIT STATUS IS ALWAYS 0, including on an unexpected exception. The workflow step also carries
 * `continue-on-error: true`, so not even a crash before `main` runs can fail PR Conventions.
 *
 * ZERO-DEPENDENCY, like the other scripts PR Conventions runs: it uses only Node built-ins and the
 * global `fetch`, so it runs before any install.
 *
 * `REPOSITORY_STANDARDS_RELEASE_URL` overrides the API address; the tests point it at a local
 * server. `GITHUB_TOKEN`, when set, authenticates the request, which avoids the shared
 * unauthenticated rate limit on hosted runners.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_RELEASE_URL =
  "https://api.github.com/repos/minipuft/repository-standards/releases/latest";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * `MAJOR.MINOR.PATCH` with an optional leading `v`. Pre-release and build suffixes are ignored:
 * release-please publishes plain versions here, so a suffix carries no ordering this check needs.
 */
export function parseReleaseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? "").trim());
  return match ? match.slice(1, 4).map(Number) : null;
}

/** Negative when `a` is older than `b`, 0 when equal, positive when newer; null if unparseable. */
export function compareReleaseVersions(a, b) {
  const left = parseReleaseVersion(a);
  const right = parseReleaseVersion(b);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * How far `found` is behind `latest`, in the largest unit that differs ("3 minor versions
 * behind"). Null when `found` is not behind or either side is unparseable.
 */
export function describeReleaseLag(found, latest) {
  const order = compareReleaseVersions(found, latest);
  if (order === null || order >= 0) return null;
  const left = parseReleaseVersion(found);
  const right = parseReleaseVersion(latest);
  const units = ["major", "minor", "patch"];
  const index = left.findIndex((part, position) => part !== right[position]);
  const distance = right[index] - left[index];
  return `${distance} ${units[index]} version${distance === 1 ? "" : "s"} behind`;
}

function readTemplateVersion(contractPath) {
  try {
    const document = JSON.parse(readFileSync(contractPath, "utf8"));
    if (!document.templateVersion) {
      return { skipped: `${contractPath} carries no templateVersion` };
    }
    return { templateVersion: document.templateVersion };
  } catch (error) {
    return { skipped: `${contractPath} is unreadable: ${error.message}` };
  }
}

async function readLatestRelease(url, token) {
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        skipped: `the latest release request answered ${response.status} ${response.statusText}`,
      };
    }
    const payload = await response.json();
    if (!parseReleaseVersion(payload.tag_name)) {
      return {
        skipped: `the latest release tag ${JSON.stringify(payload.tag_name)} is not a version`,
      };
    }
    return { version: String(payload.tag_name).replace(/^v/, "") };
  } catch (error) {
    return { skipped: `the latest release request failed: ${error.message}` };
  }
}

/**
 * The comparison itself, separated from printing so the outcome is one value: a `warning`
 * (behind), a `skipped` reason (could not compare), or neither (current or ahead).
 */
export async function contractLag({
  contractPath = path.resolve(".delivery-contract.json"),
  releaseUrl = process.env.REPOSITORY_STANDARDS_RELEASE_URL ||
    DEFAULT_RELEASE_URL,
  token = process.env.GITHUB_TOKEN,
} = {}) {
  const contract = readTemplateVersion(contractPath);
  if (contract.skipped) return { skipped: contract.skipped };
  const latest = await readLatestRelease(releaseUrl, token);
  if (latest.skipped) return { skipped: latest.skipped };
  const order = compareReleaseVersions(
    contract.templateVersion,
    latest.version,
  );
  if (order === null) {
    return {
      skipped: `templateVersion ${JSON.stringify(contract.templateVersion)} is not a version`,
    };
  }
  if (order >= 0) return {};
  return {
    warning:
      `This repository's delivery contract is template ${contract.templateVersion}; the latest ` +
      `minipuft/repository-standards release is ${latest.version} ` +
      `(${describeReleaseLag(contract.templateVersion, latest.version)}). Adopt it in its own ` +
      `pull request: run \`delivery-contract update\` from a repository-standards checkout at ` +
      `v${latest.version}, then commit what it writes. This is a warning, never a failure: a new ` +
      `release changes nothing this pull request controls.`,
  };
}

async function main() {
  const outcome = await contractLag();
  if (outcome.warning) {
    const prefix = process.env.GITHUB_ACTIONS
      ? "::warning title=Delivery contract is behind the latest release::"
      : "warning: ";
    console.log(`${prefix}${outcome.warning}`);
  } else if (outcome.skipped) {
    console.log(`Delivery contract lag not compared: ${outcome.skipped}.`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  try {
    await main();
  } catch (error) {
    console.log(`Delivery contract lag not compared: ${error.message}.`);
  }
  process.exitCode = 0;
}

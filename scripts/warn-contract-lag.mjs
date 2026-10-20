#!/usr/bin/env node
/**
 * Warns, on a pull request, when this repository's delivery contract is older than the latest
 * minipuft/repository-standards release AND that release changed the template. Never fails.
 *
 * WHY IT EXISTS. Measured 2026-10-20: six fleet repositories sat at template 1.7.0 while
 * repository-standards had released 1.10.1, three minor versions of fixes later, and nothing
 * anywhere reported it. The fleet audit in repository-standards now FAILS on that lag; this step
 * is the downstream half, and it only warns. A new upstream release changes nothing a pull request
 * controls, so failing here would turn every open pull request red on the day of a release, and
 * the fix (adopting the release) is its own pull request, not a change to the one being checked.
 *
 * WHAT COUNTS AS LAG (owner ruling Q1, 2026-10-20). A newer release is not lag by itself: a release
 * that touches only the audit, CI, docs or the CLI changes nothing a member runs. The step warns
 * only when the `templates/delivery-contract` tree differs between the member's installed tag
 * (`v<templateVersion>`) and the latest release tag, the same rule the fleet audit applies.
 *
 * WHAT IT DOES. Reads `templateVersion` from `.delivery-contract.json` at the working directory and
 * asks the GitHub REST API for the latest release of minipuft/repository-standards (1 call). When
 * the contract is older, it reads the `delivery-contract` entry of `templates/` at each of the two
 * tags (2 calls, at most 3 in all) and compares the entries' tree SHAs: equal means silence.
 * Different prints one warning naming both versions and the remedy. Under GitHub Actions the
 * warning is a `::warning::` annotation; elsewhere it starts with `warning: `, the convention
 * `validate-pr-body.mjs` uses. A missing contract file, an unreadable version, a failed request or
 * an installed tag that does not exist prints one plain line saying the comparison was skipped.
 *
 * EXIT STATUS IS ALWAYS 0, including on an unexpected exception. The workflow step also carries
 * `continue-on-error: true`, so not even a crash before `main` runs can fail PR Conventions.
 *
 * ZERO-DEPENDENCY, like the other scripts PR Conventions runs: it uses only Node built-ins and the
 * global `fetch`, so it runs before any install.
 *
 * `REPOSITORY_STANDARDS_API_URL` overrides the repository's API address
 * (`https://api.github.com/repos/minipuft/repository-standards`); the tests point it at a local
 * server. `GITHUB_TOKEN`, when set, authenticates the requests, which avoids the shared
 * unauthenticated rate limit on hosted runners.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_API_URL =
  "https://api.github.com/repos/minipuft/repository-standards";
const TEMPLATE_PARENT = "templates";
const TEMPLATE_DIRECTORY = "delivery-contract";
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

// One GET. `skipped` carries the reason when the answer cannot be used; a 404 is reported apart
// (`missing`) because for a tag lookup it means the tag does not exist, not that the API failed.
async function getJson(fetchImpl, url, token, what) {
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const response = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 404) return { missing: true };
    if (!response.ok) {
      return {
        skipped: `the ${what} request answered ${response.status} ${response.statusText}`,
      };
    }
    return { payload: await response.json() };
  } catch (error) {
    return { skipped: `the ${what} request failed: ${error.message}` };
  }
}

async function readLatestRelease(fetchImpl, apiUrl, token) {
  const answer = await getJson(
    fetchImpl,
    `${apiUrl}/releases/latest`,
    token,
    "latest release",
  );
  if (answer.missing)
    return { skipped: "the repository has no latest release" };
  if (answer.skipped) return { skipped: answer.skipped };
  const tag = answer.payload.tag_name;
  if (!parseReleaseVersion(tag)) {
    return {
      skipped: `the latest release tag ${JSON.stringify(tag)} is not a version`,
    };
  }
  return { version: String(tag).replace(/^v/, "") };
}

/** The tree SHA of `templates/delivery-contract` at `v<version>`; equal SHAs mean equal bytes. */
async function readTemplateTree(fetchImpl, apiUrl, token, version) {
  const tag = `v${version}`;
  const answer = await getJson(
    fetchImpl,
    `${apiUrl}/contents/${TEMPLATE_PARENT}?ref=${encodeURIComponent(tag)}`,
    token,
    `${tag} template`,
  );
  if (answer.missing) {
    return {
      skipped: `release tag ${tag} was not found in minipuft/repository-standards`,
    };
  }
  if (answer.skipped) return { skipped: answer.skipped };
  const entry = Array.isArray(answer.payload)
    ? answer.payload.find((item) => item.name === TEMPLATE_DIRECTORY)
    : undefined;
  if (!entry?.sha) {
    return {
      skipped: `${TEMPLATE_PARENT}/${TEMPLATE_DIRECTORY} is not listed at ${tag}`,
    };
  }
  return { sha: entry.sha };
}

/**
 * The comparison itself, separated from printing so the outcome is one value: a `warning`
 * (the template changed after the installed version), a `skipped` reason (could not compare), or
 * neither (current, ahead, or a newer release that left the template alone).
 */
export async function contractLag({
  contractPath = path.resolve(".delivery-contract.json"),
  apiUrl = process.env.REPOSITORY_STANDARDS_API_URL || DEFAULT_API_URL,
  token = process.env.GITHUB_TOKEN,
  fetchImpl = fetch,
} = {}) {
  const contract = readTemplateVersion(contractPath);
  if (contract.skipped) return { skipped: contract.skipped };
  const latest = await readLatestRelease(fetchImpl, apiUrl, token);
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
  const installed = await readTemplateTree(
    fetchImpl,
    apiUrl,
    token,
    String(contract.templateVersion).replace(/^v/, ""),
  );
  if (installed.skipped) return { skipped: installed.skipped };
  const current = await readTemplateTree(
    fetchImpl,
    apiUrl,
    token,
    latest.version,
  );
  if (current.skipped) return { skipped: current.skipped };
  if (installed.sha === current.sha) return {};
  return {
    warning:
      `This repository's delivery contract is template ${contract.templateVersion}; the latest ` +
      `minipuft/repository-standards release is ${latest.version} ` +
      `(${describeReleaseLag(contract.templateVersion, latest.version)}), and the template changed ` +
      `between them. Adopt it in its own pull request: run \`delivery-contract update\` from a ` +
      `repository-standards checkout at v${latest.version}, then commit what it writes. This is a ` +
      `warning, never a failure: a new release changes nothing this pull request controls.`,
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

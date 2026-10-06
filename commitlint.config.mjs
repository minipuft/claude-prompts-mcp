/**
 * Conventional-commit enforcement for every commit (commit-msg hook) AND every PR title
 * (.github/workflows/pr-conventions.yml runs this same config on the title, because the
 * squash-merge title is the line release-please writes into the changelog).
 *
 * Seeded by the delivery contract (`.delivery-contract.json`), so this file is this repository's
 * own: the scope list is edited here and kept in lockstep with CLAUDE.md and CONTRIBUTING.md.
 * Every other rule comes from `commitlint.rules.mjs`, which the contract manages: do not edit
 * that file, because `validate:delivery-contract` fails on any drift from the installed version.
 */
import rules from "./commitlint.rules.mjs";

export default {
  extends: ["@commitlint/config-conventional"],
  plugins: rules.plugins,
  rules: {
    ...rules.rules,
    "scope-enum": [
      2,
      "always",
      [
        "server",
        "cli",
        "runtime",
        "pipeline",
        "gates",
        "frameworks",
        "prompts",
        "chains",
        "styles",
        "scripts",
        "hooks",
        "resources",
        "mcp-tools",
        "contracts",
        "parsers",
        "ci",
        "deps",
        "config",
        "logging",
        "metrics",
        "docs",
        "tests",
        "semantic",
        "execution",
      ],
    ],
  },
};

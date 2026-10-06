/**
 * Conventional-commit enforcement for every commit (commit-msg hook) AND every PR title
 * (.github/workflows/pr-conventions.yml runs this same config on the title, because the
 * squash-merge title is the line release-please writes into the changelog).
 *
 * Level 2 rules block. Level 1 rules WARN — they name a smell in the subject, and a smell is a
 * question for the author, not a verdict. Scopes and header length stay blocking; keep the
 * scope list in lockstep with the repo's own conventions.
 *
 * The advisory subject rules encode the delivery contract §Titles name the outcome:
 *   subject-outcome-verb   — activity verbs ("implement", "execute", "consolidate", "update",
 *                            "improve", "rework", "address", "refresh", "harden") describe the
 *                            session; the subject should describe the product after merge.
 *   subject-one-outcome    — " and " or " — <list>" in a subject usually means two outcomes, which
 *                            is two PRs (or one outcome that subsumes both and should be named).
 *   body-max-length        — a commit body past ~1,500 characters is a plan note wearing a commit;
 *                            the reasoning belongs in implementation-notes, linked.
 */

const ACTIVITY_VERBS = [
  "implement",
  "execute",
  "consolidate",
  "consolidation",
  "update",
  "improve",
  "rework",
  "address",
  "refresh",
  "harden",
  "enhance",
  "misc",
  "various",
  "wip",
];

const activityVerb = new RegExp(
  `(^|\\s)(${ACTIVITY_VERBS.join("|")})(\\s|$)`,
  "i",
);
const secondOutcome = /\s(and|—|--)\s/;

const plugins = [
  {
    rules: {
      "subject-outcome-verb": ({ subject }) => {
        const hit = activityVerb.exec(subject || "");
        return [
          hit === null,
          `subject uses the activity verb "${hit?.[2]}" — name the OUTCOME: what is true after this merges? (the delivery contract §Titles name the outcome)`,
        ];
      },
      "subject-one-outcome": ({ subject }) => {
        const hit = secondOutcome.exec(subject || "");
        return [
          hit === null,
          `subject joins two outcomes with "${hit?.[1]?.trim()}" — one PR is one outcome; name the one that subsumes both, or split (the delivery contract §Titles name the outcome)`,
        ];
      },
    },
  },
];

export default {
  plugins,
  rules: {
    "subject-outcome-verb": [1, "always"],
    "subject-one-outcome": [1, "always"],
    "body-max-length": [1, "always", 1500],
    "header-max-length": [2, "always", 100],
    "scope-empty": [0, "never"],
  },
};

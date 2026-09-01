/**
 * Conventional-commit enforcement for every commit (commit-msg hook) AND every PR title
 * (.github/workflows/pr-conventions.yml runs this same config on the title, because the
 * squash-merge title is the line release-please writes into the changelog).
 *
 * Level 2 rules block. Level 1 rules WARN — they name a smell in the subject, and a smell is a
 * question for the author, not a verdict. Scopes and header length stay blocking; keep the
 * scope list in lockstep with CLAUDE.md and CONTRIBUTING.md.
 *
 * The three advisory subject rules encode CONTRIBUTING.md §Titles name the outcome:
 *   subject-outcome-verb   — activity verbs ("implement", "execute", "consolidate", "update",
 *                            "improve", "rework", "address", "refresh", "harden") describe the
 *                            session; the subject should describe the product after merge.
 *                            Measured 2026-09-01: "execute the security review" (#249),
 *                            "resource-surface consolidation" (#255).
 *   subject-one-outcome    — " and " or " — <list>" in a subject usually means two outcomes, which
 *                            is two PRs (or one outcome that subsumes both and should be named).
 *                            "#254: mid-chain unknown surfacing AND adaptive consolidation".
 *   body-max-length        — a commit body past ~1,500 characters is a plan note wearing a commit;
 *                            the reasoning belongs in implementation-notes, linked.
 */

const ACTIVITY_VERBS = [
  'implement',
  'execute',
  'consolidate',
  'consolidation',
  'update',
  'improve',
  'rework',
  'address',
  'refresh',
  'harden',
  'enhance',
  'misc',
  'various',
  'wip',
];

const activityVerb = new RegExp(`(^|\\s)(${ACTIVITY_VERBS.join('|')})(\\s|$)`, 'i');
const secondOutcome = /\s(and|—|--)\s/;

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'subject-outcome-verb': ({ subject }) => {
          const hit = activityVerb.exec(subject || '');
          return [
            hit === null,
            `subject uses the activity verb "${hit?.[2]}" — name the OUTCOME: what is true after this merges? (CONTRIBUTING.md §Titles name the outcome)`,
          ];
        },
        'subject-one-outcome': ({ subject }) => {
          const hit = secondOutcome.exec(subject || '');
          return [
            hit === null,
            `subject joins two outcomes with "${hit?.[1]?.trim()}" — one PR is one outcome; name the one that subsumes both, or split (CONTRIBUTING.md §Titles name the outcome)`,
          ];
        },
      },
    },
  ],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'server',
        'cli',
        'runtime',
        'pipeline',
        'gates',
        'frameworks',
        'prompts',
        'chains',
        'styles',
        'scripts',
        'hooks',
        'resources',
        'mcp-tools',
        'contracts',
        'parsers',
        'ci',
        'deps',
        'config',
        'logging',
        'metrics',
        'docs',
        'tests',
        'semantic',
        'execution',
      ],
    ],
    'scope-empty': [0, 'never'],
    'header-max-length': [2, 'always', 100],
    'subject-outcome-verb': [1, 'always'],
    'subject-one-outcome': [1, 'always'],
    'body-max-length': [1, 'always', 1500],
  },
};

# How This Repo Is Run

How a change moves from an idea to a published release, and why each check
along the way exists. Read it once before your first pull request. It explains;
the linked docs own the detail and the exact commands.

## The Path at a Glance

```
plan (plans/*.md) ──► owner ruling ──► branch + commits
                                            │
                                            ▼
              npm run pr:check ──► pull request ──► CI route (docs · hooks · full)
                                                        │
                                                        ▼
                                          squash merge into main
                                                        │
                                                        ▼
           release-please PR ──► GitHub release ──► npm publish + downstream sync
```

Small fixes can skip the plan and start at the branch. Everything from the pull
request onwards applies to every change.

## Plans: Where Work Is Written Down

Larger work starts as a Markdown file in `plans/`. A plan names its goal, the
decisions made so far, and a table of rows, one row per piece of work. Check
`plans/` before you change a subsystem: an active plan may already be reshaping
it ([CONTRIBUTING §Architecture Decisions](../../CONTRIBUTING.md#architecture-decisions)).

| Part                  | What it means                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `status:` frontmatter | one of `active`, `backlog`, `done`, `reference`                                                                                       |
| a row marked `☐`      | open work, stamped with the date it was last true and what would flip it                                                              |
| a row marked `✓`      | done; any file it names must be committed, which `validate:plan-row-tracking` checks                                                  |
| `plans/archive/`      | where a `done` plan goes when it retires; a `reference` plan moves to `plans/reference/` instead, because something still links to it |

**Why the row check exists:** a plan once showed seven rows marked done whose
files had never been committed. Every local check read the working tree, so
nothing noticed until CI checked out the commit.

The status vocabulary and the row grammar are fleet conventions, not this
repository's own. [Release Process §Plan retirement](../guides/release-process.md#plan-retirement)
links the versioned convention and explains how retirement runs here.

## Rulings: Decisions Someone Owns

A plan records the decisions its owner made in a Rulings table, one line each,
with who decided and when. A ruling settles a question so later work does not
reopen it.

Plans are archived when they finish, so a ruling that lives only in a plan
disappears with it. That is why a ruling a user of the server can observe, or
one that changes a default, also becomes an Architecture Decision Record in
`docs/adr/` in the same pull request that ships it
([ADR 0004](../adr/0004-a-plan-ruling-a-consumer-can-observe-becomes-an-adr-in-the.md)).
The test: would someone who followed the old behaviour now do the wrong thing?
`node scripts/adr.mjs new "<title>"` writes the next numbered file
([ADR index](../adr/README.md)).

## Commits

Commits follow Conventional Commits with a scope from `commitlint.config.mjs`,
and the subject names what is true after the commit, not what you did
([CONTRIBUTING §Commit Conventions](../../CONTRIBUTING.md#commit-conventions)).
Each commit should pass the revert test: it can be undone on its own, with its
tests and docs inside it.

**Why:** the release tooling reads commit types to choose the next version and
write the changelog. A commit it cannot parse is left out of the release.

Git hooks run a fast subset of CI on your machine: formatting, lint and
typecheck at commit, typecheck and the lint ratchet at push
([CONTRIBUTING §Git Hooks](../../CONTRIBUTING.md#git-hooks)). A hook never runs
a check CI does not run, so a green CI always covers what the hooks covered.

## The Pull Request Gate

Seed the body from your branch, fill it in, then run the same checks the
`PR Conventions` workflow will run, from the repository root:

```bash
npm run pr:body -- --out /tmp/pr-body.md
npm run pr:check -- --body-file /tmp/pr-body.md --title "docs(docs): outcome"
```

| The body needs             | Why                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| a one-sentence outcome     | the title and body become the squash commit, which is what readers of `main` see         |
| `## Demonstration`         | a reviewer sees the before and after, not a description of it (`n/a: <reason>` for docs) |
| a verification table       | each claim with its command and a baseline; a count with no baseline tells nothing       |
| `## Notes for Reviewers`   | at most three pointers to where a reviewer should look hardest                           |
| one `Plan:` footer, if any | ties the pull request to its plan (below)                                                |

**The `Plan:` footer is checked, not trusted.** A pull request that names a plan
must move at least one of its rows to done, and the one that closes the last row
must retire the plan in the same change. Every pull request of one plan carries
the same footer, so `git log --grep` finds the whole series on `main`
([ADR 0003](../adr/0003-the-plan-footer-is-the-join-key-between-a-pr-and-its.md)).

**The squash check reads the commit the merge will write.** GitHub re-wraps the
body at 72 columns, and the release tooling parses that re-wrapped text. A wrap
in the wrong place once dropped two pull requests, one of them a breaking change,
from a release without any error.

`pr:check` mirrors the workflow step for step, and a test fails when the two
drift apart. Full detail:
[CONTRIBUTING §Pull Request Process](../../CONTRIBUTING.md#pull-request-process).

## CI Routes

CI looks at which files changed and picks one of three routes
(`scripts/classify-validation-scope.js` decides):

| Route   | When                                                     | What runs                                                      |
| ------- | -------------------------------------------------------- | -------------------------------------------------------------- |
| `docs`  | only handbooks, `docs/**/*.md`, `plans/**/*.md`, READMEs | text checks: CONTRIBUTING commands, plan rows, README charter  |
| `hooks` | only `hooks/**`, plus optional docs                      | the Python checks plus the same text checks                    |
| `full`  | anything else, including mixed or unknown changes        | typecheck, `validate:all`, build, and the Node 22 and 24 tests |

**Why it fails closed:** a change the classifier does not recognise takes the
full route, so a new kind of file can never slip through on a lighter one. The
required job names stay the same on every route, so a docs change still reports
every required check instead of leaving one pending.

The full test suite runs once, in CI, on the pull request. Locally you run the
check that reads what your change wrote
([CLAUDE.md §Validation Gates](../../CLAUDE.md#validation-gates-one-contract-impact-aware-subsets),
[CONTRIBUTING §Testing](../../CONTRIBUTING.md#testing)).

## Merge and Release

Merge with `gh pr merge <n> --squash` and no other flags, so the commit carries
the pull request's title and body unchanged.

Releases are automated. Release Please keeps an open release pull request that
bumps the version files, writes the changelog from the commit types, and retires
plans marked `done`. Merging it tags a GitHub release, which publishes to npm,
builds the desktop extension, and opens a version update in each downstream
repository ([CONTRIBUTING §Release Process](../../CONTRIBUTING.md#release-process),
[Release Process guide](../guides/release-process.md#workflow-chain)).

## Fleet Standards

This repository is the upstream of a small fleet of related repositories. The
shared rules live in
[`minipuft/repository-standards`](https://github.com/minipuft/repository-standards):
the pull request scripts and workflow, the shared Renovate preset, the plan
status vocabulary with the tool that retires plans, and a weekly audit that
compares every downstream's installed version with this one.

This repository consumes those standards and pins them:

| Check                                | Fails when                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `validate:delivery-contract`         | a managed script was edited here instead of upstream                                              |
| `validate:standards-pins`            | the four references to the standards (package, action, `$schema`, doc link) disagree on a version |
| `validate:renovate-preset-agreement` | this repository's Renovate policy differs from the shared preset without saying so                |

**Why:** a check that reads another repository belongs upstream, where every
member gets it. A local copy splits one decision into two that drift apart
([CLAUDE.md §Fleet Standards Upstream](../../CLAUDE.md#fleet-standards-upstream-minipuftrepository-standards)).

## Where Each Fact Lives

| Question                           | Owner                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| exact commands and the PR template | [CONTRIBUTING.md](../../CONTRIBUTING.md)                                                          |
| which check runs on which route    | [CLAUDE.md §Validation Gates](../../CLAUDE.md#validation-gates-one-contract-impact-aware-subsets) |
| why a decision was made            | [`docs/adr/`](../adr/README.md)                                                                   |
| how a release is cut and shipped   | [Release Process](../guides/release-process.md)                                                   |

## GitHub Repository Setup

**Repository:** {{repo}}
**Package Manager:** {{package_manager}}
**Publish to npm:** {{publish_npm}}
**Required CI Jobs:** {{ci_jobs}}
{% if downstream_repos %}**Downstream Repos:** {{downstream_repos}}{% endif %}

---

## Tasks

### 1. Audit Current State

Check existing configuration:

```bash
# Branch protection
gh api repos/{{repo}}/branches/main/protection 2>&1

# Rulesets
gh api repos/{{repo}}/rulesets 2>&1

# Environments
gh api repos/{{repo}}/environments --jq '.environments[].name' 2>&1

# Secrets (names only)
gh secret list -R {{repo}} 2>&1
```

### 2. Set Branch Protection

Configure main branch protection with required status checks:

```bash
gh api repos/{{repo}}/branches/main/protection -X PUT \
  -H "Accept: application/vnd.github+json" \
  --input - << 'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [{% for job in ci_jobs.split(',') %}"{{job | trim}}"{% if not loop.last %}, {% endif %}{% endfor %}]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

### 3. Repository Settings

Enable auto-merge and other settings:

```bash
gh api repos/{{repo}} -X PATCH \
  -f allow_auto_merge=true \
  -f delete_branch_on_merge=true \
  -f allow_squash_merge=true \
  -f allow_merge_commit=false \
  -f allow_rebase_merge=false
```

### 4. CI Workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
{% if 'lint' in ci_jobs %}
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
{% if package_manager == 'bun' %}
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run lint
{% else %}
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: {{package_manager}}
      - run: {{package_manager}} {% if package_manager == 'npm' %}ci{% else %}install{% endif %}
      - run: {{package_manager}} run lint
{% endif %}
{% endif %}

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
{% if package_manager == 'bun' %}
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run build
{% else %}
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: {{package_manager}}
      - run: {{package_manager}} {% if package_manager == 'npm' %}ci{% else %}install{% endif %}
      - run: {{package_manager}} run build
{% endif %}

{% if 'test' in ci_jobs %}
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
{% if package_manager == 'bun' %}
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun test
{% else %}
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: {{package_manager}}
      - run: {{package_manager}} {% if package_manager == 'npm' %}ci{% else %}install{% endif %}
      - run: {{package_manager}} test
{% endif %}
{% endif %}
```

{% if publish_npm %}

### 5. npm Publish Workflow

Create `.github/workflows/npm-publish.yml`:

```yaml
name: Publish to npm

on:
  release:
    types: [published]

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    environment: npm
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org

      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm publish --access public --provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
{% if downstream_repos %}

{% for downstream in downstream_repos.split(',') %}
      - name: Notify {{downstream | trim}}
        uses: peter-evans/repository-dispatch@v4
        with:
          token: ${{ secrets.DOWNSTREAM_PAT }}
          repository: {{downstream | trim}}
          event-type: upstream-release
          client-payload: '{"version": "${{ github.event.release.tag_name }}"}'
{% endfor %}
{% endif %}
```

**Required Secrets:**

- `NPM_TOKEN`: npm automation token for publishing
  {% if downstream_repos %}- `DOWNSTREAM_PAT`: GitHub PAT with repo scope for downstream notifications{% endif %}

Create npm environment:

```bash
gh api repos/{{repo}}/environments/npm -X PUT
```

{% endif %}

{% if downstream_repos %}

### 6. Upstream Sync Workflow (for downstream repos)

Create in each downstream repo `.github/workflows/upstream-sync.yml`:

```yaml
name: Upstream Sync

on:
  repository_dispatch:
    types: [upstream-release]
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  update-dependency:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Update dependency
        id: update
        run: |
          npm update <package-name>
          VERSION=$(node -p "require('./package-lock.json').packages['node_modules/<package-name>'].version")
          echo "version=$VERSION" >> $GITHUB_OUTPUT

      - name: Check for changes
        id: changes
        run: |
          git diff --quiet package-lock.json && echo "has_changes=false" >> $GITHUB_OUTPUT || echo "has_changes=true" >> $GITHUB_OUTPUT

      - name: Create Pull Request
        if: steps.changes.outputs.has_changes == 'true'
        id: pr
        uses: peter-evans/create-pull-request@v7
        with:
          title: 'chore(deps): update to ${{ steps.update.outputs.version }}'
          branch: deps/upstream-${{ steps.update.outputs.version }}
          commit-message: 'chore(deps): update to ${{ steps.update.outputs.version }}'
          labels: dependencies,automerge

      - name: Enable auto-merge
        if: steps.pr.outputs.pull-request-number
        run: gh pr merge --auto --squash "${{ steps.pr.outputs.pull-request-number }}"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

{% endif %}

## Verification

After setup, verify:

```bash
# Branch protection
gh api repos/{{repo}}/branches/main/protection --jq '{
  required_checks: .required_status_checks.contexts,
  strict: .required_status_checks.strict,
  force_push: .allow_force_pushes.enabled
}'

# Repo settings
gh api repos/{{repo}} --jq '{
  auto_merge: .allow_auto_merge,
  delete_branch: .delete_branch_on_merge
}'

# Secrets
gh secret list -R {{repo}}
```

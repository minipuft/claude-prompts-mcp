# Practice Capture

## Submitted evidence

{{evidence}}

## Why it matters

{{why_it_matters}}
{% if reaction %}

## Initial reaction

{{reaction}}
{% endif %}{% if context %}

## Possible use context

{{context}}
{% endif %}{% if assets %}

## Supplied local assets

{{assets}}
{% endif %}{% if collection %}

## Candidate collection

{{collection}}
{% endif %}

**Promotion mode:** {% if promotion == "evaluate" %}evaluate{% else %}none{% endif %}

Preserve first; interpret second; promote only after evidence and authority exist.

### 1. INTAKE FRAME

State what was supplied, what can be inspected directly, what remains inaccessible or unverified, and why this evidence may be worth preserving. Do not infer a technique or preference from a title alone.

### 2. PROVENANCE INVENTORY

For every source, preserve the exact submitted locator and propose a normalized canonical identity. Record title, author or organization, retrieval date, license or `unknown`, and a deep locator when one exists. Label each claim as **REPORTED**, **OBSERVED**, **INFERRED**, or **REACTION**.

If a visual asset was supplied, preserve it only through the Practice Library asset path: PNG, JPEG, or WebP; SHA-256 identity; descriptive alt text and caption. Active SVG, HTML, scripts, credentials, loopback/private hosts, and executable archives are inadmissible.

### 3. DUPLICATE + LINK SEARCH

Search `practice/generated/catalog.json` and `practice/records/` by:

- source identity, author, title, URL, and existing aliases;
- semantic role: what this evidence could teach or change;
- candidate collection and related techniques, reactions, failures, and unknowns.

Prefer linking or updating the appropriate existing record over creating a parallel record. Never use a short sequential ID; the canonical writer owns UUIDs, semantic slugs, aliases, and asset hashes.

### 4. RECORD PLAN

Propose the smallest atomic record set using only the established kinds:

| Record | Kind | Evidence or interpretation | Links | Why separate |
| ------ | ---- | -------------------------- | ----- | ------------ |

Valid kinds: `reference`, `artifact`, `insight`, `technique`, `failure-mode`, `reaction`, `unknown`, `profile`, `collection`.

A reference is not automatically a technique. A reaction is not a universal rule. A profile is a versioned, task-relative interpretation whose claims link back to evidence.

### 5. VERIFIED CAPTURE

Prepare a temporary JSON capture specification accepted by the existing writer. From the knowledge-hub root, run:

```bash
python3 -m practice.cli capture <temporary-capture.json>
python3 -m practice.cli validate
python3 -m practice.cli build --check-deterministic
```

Delete the temporary specification after successful ingestion. Do not manually rewrite canonical frontmatter to bypass the writer. If any command fails, stop, report the exact failure, and leave promotion at `none`.

### 6. CAPTURE RECEIPT

Return:

- created or reused semantic slugs and UUID-backed links;
- clickable source and generated board pointers;
- locally preserved asset hashes where applicable;
- validation and deterministic-build results;
- remaining unknowns or unavailable evidence.

{% if promotion == "evaluate" %}

### 7. PROMOTION EVALUATION

Invoke `/knowledge-capture` and evaluate maturity only after capture succeeds:

1. Count independent sightings and cite each evidence record.
2. Search existing skills and rules twice: by source terms and by the behavior the finding serves.
3. Classify the proposal: `none`, `project-only`, `extend-skill`, `extend-rule`, or `new-skill-candidate`.
4. Prefer the existing owner. A new skill requires a genuinely distinct operating procedure with no current owner.
5. Present the exact target and compact proposed change.
6. Ask for explicit user confirmation. Do not edit the framework during this run.

If the evidence has not cleared the maturity threshold and the user has not explicitly confirmed promotion, return `promotion: none — evidence retained for another sighting`.
{% else %}

### 7. PROMOTION

`promotion: none — capture only`. Do not inspect or modify global skills, rules, profiles, or public artifacts.
{% endif %}

### 8. FINAL RESPONSE

Use this order:

1. **Captured** — stable pointers and record kinds
2. **Validation** — writer, validator, deterministic build
3. **Interpretation** — what appears reusable, explicitly goal-relative
4. **Promotion** — none or an approval-gated proposal
5. **Unknowns** — evidence still needed

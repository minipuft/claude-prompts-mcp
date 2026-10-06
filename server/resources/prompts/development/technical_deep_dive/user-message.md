# Technical Deep Dive: {{library}}

## Context

{{context}}

{% if concerns %}

## Specific Concerns to Investigate

{{concerns}}
{% endif %}

---

Conduct a **thorough technical analysis** of `{{library}}`:

## 1. API Design & Developer Experience

### Core API Surface

```typescript
// Show key interfaces/functions with type signatures
```

### Learning Curve

- Time to productivity estimate
- Documentation quality (1-5)
- TypeScript support level

### Ergonomics

- Boilerplate required
- Configuration complexity
- Error messages quality

## 2. Performance Analysis

| Aspect              | Assessment | Evidence                          |
| ------------------- | ---------- | --------------------------------- |
| Bundle Size         |            | (source: bundlephobia or similar) |
| Runtime Performance |            |                                   |
| Memory Usage        |            |                                   |
| Tree-shaking        |            |                                   |

### Benchmarks (if available)

Reference specific benchmarks with sources.

## 3. Security Assessment

- [ ] Known CVEs (check npm audit, Snyk)
- [ ] Dependency chain risks
- [ ] Input validation handling
- [ ] Last security audit (if any)

**Security verdict**: [Low Risk / Medium Risk / High Risk / Unknown]

## 4. Edge Cases & Limitations

### Known Limitations

- List documented limitations

### Common Pitfalls

- Gotchas from GitHub issues, Stack Overflow

### Breaking Change History

- Major version migration difficulty

## 5. Verified Claims

> **IMPORTANT**: Every claim must be verifiable. Cite sources.

| Claim | Source | Verified |
| ----- | ------ | -------- |
|       |        |          |

---

**Output requirements**:

- All performance claims must cite sources (bundlephobia, benchmarks, docs)
- Security assessment must reference actual CVE databases or audit reports
- Include code examples for API patterns

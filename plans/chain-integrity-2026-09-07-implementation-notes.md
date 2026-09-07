---
title: "Chain integrity — implementation notes"
plan: chain-integrity-2026-09-07.md
date: 2026-09-07
status: active
tags: [chains, implementation-notes]
---

# Chain Integrity — Implementation Notes

Deviation log for `chain-integrity-2026-09-07.md`. Tier 0 receipts land here first, then move
into the plan's row status once a row closes.

## Tier 0 receipts

Receipts recorded in the plan rows 0.1–0.4 (2026-09-07). The one design consequence is ruling R7 in the plan: the write-path check runs before the write that scaffolds a chain's own one-level steps, so those ids are exempt and everything else must resolve.

## Deviations

| #   | Date | Row | Deviation | Why |
| --- | ---- | --- | --------- | --- |

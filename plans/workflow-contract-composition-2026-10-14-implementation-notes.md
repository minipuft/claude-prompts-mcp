# Composition implementation notes

## 2026-10-14 — C1 artifacts accepted under explicit index exception

Root reviewed the73-line C1 receipt, exact handbook/reference diff and root-index-review/logical-review.json. Seven working conflicts resolved; docs57/100, seven actual changed paths, three allowed TypeScript projections and AGENTS unchanged. Source types/contracts/build/schema3/guidance/format and canonical lower ratchets pass. Both capture PIDs exited, ports closed and owned private roots absent.

Raw index hash differed without a retained initial binary; exact-index custody failed and remains failed. Current2017 stage0 blobs match initial byte-identical working merge snapshot, modes match branch mode merge, and21 initial unmerged entries are unchanged. Root review did not modify index; HEAD and MERGE_HEAD exact. This adjudicates current logical correctness only, not historical metadata causality. Preserve guard-after supersession by guard-final and index-final-observation.

The first root reconstruction attempt used unsupported merge-tree --write-tree onGit2.34.1, failed before index writes and is retained. Current logical review supports bounded artifact acceptance without restoration. Root now stages the seven resolutions plus root plan/notes and commits the private merge; C2 test callers/typing and C3 combined transport are still pending. Worker registered-prompt attestation returned no open review; later honest FAIL was hook-blocked and abort gave guidance without termination. This is installed-call supplemental evidence only, not successful closure; no replay/clear/fake PASS.

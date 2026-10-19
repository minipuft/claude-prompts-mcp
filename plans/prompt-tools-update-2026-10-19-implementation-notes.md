# Implementation notes: prompt tools update

## Rulings

- **R1 (2026-10-19)** Origin: the live check for #502 ran `resource_manager` prompt `update` on `reference_demo` with `tools:[word_count]`; `text_digest` disappeared from `prompt.yaml`'s `tools:` list, authored comments were dropped and `description` was re-wrapped. Row 1 diagnoses before any fix row is cut.

- **R2 (2026-10-19, planner; owner may override before merge)** A `tools` entry without `confirm` means approval required. The loader defaults it to `true` (`modules/automation/core/script-schema.ts:96`) and `docs/guides/script-tools.md` says "Omitting the key defaults to TRUE"; the writer's `confirm: tool.confirm ?? false` (`file-operations.ts:1227`) contradicted both. The writer stops restating defaults: it writes only supplied fields, and on update overlays them on the existing file. Changelog `### Fixed`.
- **R3** S1/S2 (sending `tools` replaces the bound list; a dropped tool's folder stays) is intended and tested (`unset-verb.test.ts:375-391`, #262), but documented only on `tool_operation`. Fork: intended-but-undocumented → row C documents it on `tools` and in the reply. No behavior change.
- **R4** S4 (re-wrapping at 80 columns) is the documented cost of the whole-document path (`CHANGELOG.md:457`). Row A keeps list-length edits off that path, so it stops for this case; no global width change (width 0 would match 30 of 106 bundled files against 63 at 80).

## Deviations

- **DEV-B-1** Row B writes a supplied `schema` to the tool's declared `schemaFile` (default `schema.json`) rather than always `schema.json`, so the schema lands where the loader reads it. Accepted.
- **DEV-B-2** Row B merged `origin/main` (#502) into its branch before editing, on planner instruction, so the `formatJsonDocument` call is resolved and tested there.

## Findings

- **Row B** A resend no longer forces `enabled: true`: an authored `enabled: false` survives (it was silently re-enabled before). Row C's changelog names it. An unparseable existing `tool.yaml` is treated as absent and rewritten.

- **Row 1 diagnosis** S3: `yaml-document-writer.ts:135` recurses only into equal-length arrays; a length change records the whole list (`:147`) and takes `doc.setIn` + `doc.toString()` (`:253-255`), dropping inner comments (measured 5→1). S5: `planToolFiles` (`file-operations.ts:1211-1247`) rebuilds `tool.yaml` from 9 fields with `serializeYaml`, never reading the file: comments 20→0, key order changed, `confirm` flipped, `schemaFile`/`env`/`workingDir`/`confirmMessage`/`autoApproveOnValid`/… dropped. #343 moved every other writer to the comment-preserving one and missed this site.
- The brief misstated two observations (wrapping direction; `tool.yaml` unchanged). A brief should carry the before/after file pair, not a reading of it.

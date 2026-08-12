const DEFAULT_FORBIDDEN_PATTERNS = ['legacy/', '/legacy/', '@legacy/', 'legacy-'];
const DEFAULT_CONTEXT_DEEP_IMPORTS = [
  'execution/context/execution-context',
  'execution/context/context-types',
];
const ZERO_WIDTH_JOINER = 0x200d;
const VARIATION_SELECTORS = new Set([0xfe0f, 0xfe0e]);

const EXTENDED_PICTOGRAPHIC_REGEX = /\p{Extended_Pictographic}/u;
const EMOJI_COMPONENT_REGEX = /\p{Emoji_Component}/u;
const EMOJI_MODIFIER_REGEX = /\p{Emoji_Modifier}/u;

const normalizePatterns = (patterns = DEFAULT_FORBIDDEN_PATTERNS) => {
  return patterns.map((pattern) => {
    if (typeof pattern === 'string') {
      if (pattern.startsWith('regex:')) {
        const regex = new RegExp(pattern.slice('regex:'.length));
        return {
          description: `/${regex.source}/`,
          test: (candidate) => regex.test(candidate),
        };
      }

      return {
        description: pattern,
        test: (candidate) => candidate.includes(pattern),
      };
    }

    if (pattern && typeof pattern === 'object' && pattern.value) {
      const mode = pattern.type === 'regex' ? 'regex' : 'substring';
      if (mode === 'regex') {
        const regex = new RegExp(pattern.value);
        return {
          description: `/${regex.source}/`,
          test: (candidate) => regex.test(candidate),
        };
      }

      return {
        description: pattern.value,
        test: (candidate) => candidate.includes(pattern.value),
      };
    }

    throw new Error(
      `Invalid pattern configuration supplied to claude/no-legacy-imports: ${pattern}`
    );
  });
};

const getSourceCode = (context) => context.sourceCode ?? context.getSourceCode();
const normalizePath = (value) => value.replace(/\\/g, '/');
const codeUnitLength = (codePoint) => (codePoint !== undefined && codePoint > 0xffff ? 2 : 1);
const matchesRegex = (regex, codePoint) => {
  if (codePoint === undefined) {
    return false;
  }
  return regex.test(String.fromCodePoint(codePoint));
};
const isEmojiStart = (codePoint) =>
  matchesRegex(EXTENDED_PICTOGRAPHIC_REGEX, codePoint) ||
  matchesRegex(EMOJI_COMPONENT_REGEX, codePoint);
const isEmojiComponent = (codePoint) => matchesRegex(EMOJI_COMPONENT_REGEX, codePoint);
const isEmojiModifier = (codePoint) => matchesRegex(EMOJI_MODIFIER_REGEX, codePoint);
const isVariationSelector = (codePoint) =>
  codePoint !== undefined ? VARIATION_SELECTORS.has(codePoint) : false;

// Walks the UTF-16 string to capture emoji grapheme clusters (base + modifiers + joiners).
const collectEmojiRanges = (text) => {
  const ranges = [];
  let index = 0;

  while (index < text.length) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }

    const initialLength = codeUnitLength(codePoint);

    if (isEmojiStart(codePoint)) {
      let end = index + initialLength;

      while (end < text.length) {
        const nextCodePoint = text.codePointAt(end);
        if (nextCodePoint === undefined) {
          break;
        }

        const nextLength = codeUnitLength(nextCodePoint);

        if (
          isVariationSelector(nextCodePoint) ||
          isEmojiModifier(nextCodePoint) ||
          isEmojiComponent(nextCodePoint)
        ) {
          end += nextLength;
          continue;
        }

        if (nextCodePoint === ZERO_WIDTH_JOINER) {
          const followingIndex = end + nextLength;
          if (followingIndex >= text.length) {
            end += nextLength;
            break;
          }

          const followingCodePoint = text.codePointAt(followingIndex);
          if (followingCodePoint === undefined) {
            break;
          }

          if (isEmojiStart(followingCodePoint)) {
            end = followingIndex + codeUnitLength(followingCodePoint);
            continue;
          }

          end += nextLength;
          continue;
        }

        break;
      }

      ranges.push({ start: index, end });
      index = end;
      continue;
    }

    index += initialLength;
  }

  return ranges;
};

const noLegacyImportsRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prevents importing modules that live under legacy/* or deprecated folders',
    },
    schema: [
      {
        type: 'object',
        properties: {
          patterns: {
            type: 'array',
            items: {
              anyOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    type: { enum: ['regex', 'substring'] },
                    value: { type: 'string' },
                  },
                  required: ['value'],
                  additionalProperties: false,
                },
              ],
            },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      legacyImport: 'Imports from legacy modules are forbidden (matched pattern "{{pattern}}")',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const matchers = normalizePatterns(options.patterns);

    const reportIfLegacy = (sourceNode) => {
      if (!sourceNode || typeof sourceNode.value !== 'string') {
        return;
      }

      const specifier = sourceNode.value;
      const match = matchers.find((matcher) => matcher.test(specifier));
      if (!match) {
        return;
      }

      context.report({
        node: sourceNode,
        messageId: 'legacyImport',
        data: { pattern: match.description },
      });
    };

    return {
      ImportDeclaration(node) {
        reportIfLegacy(node.source);
      },
      ExportAllDeclaration(node) {
        reportIfLegacy(node.source);
      },
      ExportNamedDeclaration(node) {
        reportIfLegacy(node.source);
      },
      ImportExpression(node) {
        reportIfLegacy(node.source);
      },
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length > 0 &&
          node.arguments[0].type === 'Literal'
        ) {
          reportIfLegacy(node.arguments[0]);
        }
      },
    };
  },
};

const noContextDeepImportsRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Encourages importing execution context types from the barrel index',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowInternal: { type: 'boolean' },
          blockedModules: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      contextDeepImport:
        'Use execution/context/index.js barrel instead of importing "{{path}}" directly.',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const allowInternal = options.allowInternal !== false;
    const blockedModules = options.blockedModules ?? DEFAULT_CONTEXT_DEEP_IMPORTS;

    const isAllowedInternal = () => {
      if (!allowInternal) {
        return false;
      }
      // `context.filename` first: ESLint 10 REMOVED `context.getFilename()`, so the old
      // `getFilename?.() ?? ''` silently produced '' and this exemption never applied.
      // The optional call is kept only as an ESLint 8/9 fallback.
      const filename = context.filename ?? context.getFilename?.() ?? '';
      const normalized = normalizePath(filename);
      // `engine/` is part of the path. The literal used to read '/src/execution/context/',
      // which stopped matching when the layer restructure moved the directory under
      // src/engine/ — so this exemption was dead twice over.
      return normalized.includes('/src/engine/execution/context/');
    };

    const reportIfDeepImport = (sourceNode) => {
      if (!sourceNode || typeof sourceNode.value !== 'string') {
        return;
      }
      if (isAllowedInternal()) {
        return;
      }
      const specifier = normalizePath(sourceNode.value);
      const match = blockedModules.find((pattern) => specifier.includes(pattern));
      if (!match) {
        return;
      }
      context.report({
        node: sourceNode,
        messageId: 'contextDeepImport',
        data: { path: match },
      });
    };

    return {
      ImportDeclaration(node) {
        reportIfDeepImport(node.source);
      },
      ExportAllDeclaration(node) {
        reportIfDeepImport(node.source);
      },
      ExportNamedDeclaration(node) {
        reportIfDeepImport(node.source);
      },
      ImportExpression(node) {
        reportIfDeepImport(node.source);
      },
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length > 0 &&
          node.arguments[0].type === 'Literal'
        ) {
          reportIfDeepImport(node.arguments[0]);
        }
      },
    };
  },
};

const LIFECYCLE_REGEX = /@lifecycle\s+([a-z-]+)/i;

const requireLifecycleRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Enforces a @lifecycle annotation comment before code in critical files',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowedStatuses: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
          },
          requireDescription: {
            type: 'boolean',
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missingLifecycle:
        'Files in guarded folders must declare a @lifecycle annotation (one of: {{allowed}}).',
      invalidLifecycle:
        'Lifecycle status "{{status}}" is not allowed here (expected one of: {{allowed}}).',
      missingDescription:
        'Lifecycle annotations must include a short description (e.g. "@lifecycle canonical - gate entrypoint").',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const allowed = (options.allowedStatuses ?? ['canonical', 'migrating', 'legacy']).map(
      (status) => status.toLowerCase()
    );
    const allowedDisplay = allowed.join(', ');
    const requireDescription = options.requireDescription === true;

    return {
      Program(node) {
        const sourceCode = getSourceCode(context);
        const firstToken = sourceCode.getFirstToken(node, { includeComments: false });
        const leadingComments = firstToken
          ? sourceCode.getCommentsBefore(firstToken)
          : sourceCode.getAllComments();

        if (!leadingComments || leadingComments.length === 0) {
          context.report({
            node,
            messageId: 'missingLifecycle',
            data: { allowed: allowedDisplay },
          });
          return;
        }

        let annotation;
        for (const comment of leadingComments) {
          const match = LIFECYCLE_REGEX.exec(comment.value);
          if (match) {
            annotation = { comment, status: match[1], text: comment.value };
            break;
          }
        }

        if (!annotation) {
          context.report({
            node,
            messageId: 'missingLifecycle',
            data: { allowed: allowedDisplay },
          });
          return;
        }

        const normalizedStatus = annotation.status.toLowerCase();
        if (!allowed.includes(normalizedStatus)) {
          context.report({
            node: annotation.comment,
            messageId: 'invalidLifecycle',
            data: { status: annotation.status, allowed: allowedDisplay },
          });
          return;
        }

        if (requireDescription) {
          const hasDescription = /@lifecycle\s+[a-z-]+\s*-\s*.+/i.test(annotation.text.trim());
          if (!hasDescription) {
            context.report({
              node: annotation.comment,
              messageId: 'missingDescription',
            });
          }
        }
      },
    };
  },
};

const noEmojiCharactersRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Prevents emoji characters from entering source files (removes them automatically).',
    },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        properties: {
          allow: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      emojiDetected: 'Emoji characters are not allowed (found "{{emoji}}").',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const allowList = new Set(options.allow ?? []);

    return {
      Program(node) {
        const sourceCode = getSourceCode(context);
        const fullText = sourceCode.getText();
        const ranges = collectEmojiRanges(fullText);

        for (const range of ranges) {
          const emoji = fullText.slice(range.start, range.end);
          if (allowList.has(emoji)) {
            continue;
          }

          context.report({
            node,
            loc: {
              start: sourceCode.getLocFromIndex(range.start),
              end: sourceCode.getLocFromIndex(range.end),
            },
            messageId: 'emojiDetected',
            data: { emoji },
            fix(fixer) {
              return fixer.removeRange([range.start, range.end]);
            },
          });
        }
      },
    };
  },
};

const DEFAULT_COMPAT_MARKER =
  'backward[- ]compat|backwards compat|Kept for compat|Compatibility export';

/**
 * Forbids re-introducing pure re-export shim files.
 *
 * A shim here means a file whose entire body is import/export-from statements AND which carries a
 * backward-compatibility marker. Such a file gives a symbol a second import path without owning
 * anything: `rg` for the canonical path then misses every consumer using the alias path.
 *
 * Deliberately NOT flagged: a file that re-exports AND defines something of its own
 * (`infra/logging/index.ts` re-exports `Logger` but is the 495-line logger implementation), and a
 * barrel with no compat marker. The marker distinguishes "kept so old imports still resolve" from
 * "this is the module's public surface".
 *
 * Ported from `scripts/validate-no-crosslayer-reexport.js`. The script decided "pure re-export" by
 * testing each trimmed line against `/^(export\s|import\s|\}|\)|\{|type\s|[A-Za-z_$][\w$]*\s*,?$)/`
 * — a shape that also accepts any bare identifier line, so a multi-line object literal or array of
 * plain identifiers read as a re-export. The AST has no such ambiguity: a body node either is an
 * import/export-from declaration or it is not. It also gets the comment/code split for free, which
 * the script hand-rolled in `codeLines()`.
 */
const noCompatReexportShimRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbids pure re-export files carrying a backward-compatibility marker, which give a symbol a second import path',
    },
    schema: [
      {
        type: 'object',
        properties: {
          compatMarker: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      compatReexportShim:
        'Pure re-export file with a backward-compatibility marker gives a symbol a second import path. Point consumers at the canonical module and delete the shim, or drop the compatibility wording if this is a real public surface.',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const compatMarker = new RegExp(options.compatMarker ?? DEFAULT_COMPAT_MARKER, 'i');
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /** A re-export carries a source: `export … from '…'` / `export * from '…'` / `import … from '…'`. */
    const isReExportNode = (node) =>
      (node.type === 'ExportNamedDeclaration' && node.source !== null) ||
      node.type === 'ExportAllDeclaration' ||
      node.type === 'ImportDeclaration';

    return {
      Program(node) {
        if (node.body.length === 0) {
          return;
        }
        if (!node.body.every(isReExportNode)) {
          return;
        }
        // An import-only file re-exports nothing; the script required at least one `from` clause
        // reachable as an export, and a body of pure ImportDeclarations is not a shim.
        const reExportsSomething = node.body.some(
          (entry) =>
            entry.type === 'ExportAllDeclaration' ||
            (entry.type === 'ExportNamedDeclaration' && entry.source !== null)
        );
        if (!reExportsSomething) {
          return;
        }
        const carriesMarker = sourceCode
          .getAllComments()
          .some((comment) => compatMarker.test(comment.value));
        if (!carriesMarker) {
          return;
        }
        context.report({ node, messageId: 'compatReexportShim' });
      },
    };
  },
};

/**
 * `MECHANISM: <disposition> — <qualifier> — <reason>`
 *
 * Both leading fields are lenient in the pattern and validated afterwards, so a marker naming an
 * unrecognized disposition or qualifier reports which one is wrong rather than "no marker". The
 * reason group is optional for the same purpose: an author who wrote half the marker is told which
 * half is missing.
 */
const GUARD_MECHANISM_REGEX =
  /MECHANISM:\s*([A-Za-z-]+)\s*[—–-]\s*([A-Za-z-]+)\s*(?:[—–-]\s*(.*))?/i;

/**
 * Two dispositions, each with its own closed qualifier vocabulary.
 *
 * `script` — the guard stays a standalone process, and the qualifier names the property that
 * forces it. Anything outside these three belongs in a pass something already makes:
 *
 * - `reach`      — reads files the linter cannot see (`tests/`, `../cli/`, `../docs/`, non-TS
 *                  artifacts). ESLint sees the lint root minus its ignores; nothing else.
 * - `relation`   — compares two artifacts against each other. ESLint is single-file and cannot.
 * - `resolution` — needs a resolved module path rather than a literal match — dependency-cruiser's
 *                  job.
 *
 * `rehome` — the guard names none of the three and is pending a move; the qualifier is where it is
 * going and the reason carries the plan row that owns the port.
 *
 * A pending guard declares this IN ITSELF rather than in a config allowlist. That is deliberate:
 * an allowlist is a second place to update, and a rule only visits files that exist, so an entry
 * naming a deleted guard is never reported (observed 2026-08-06 when a retired guard orphaned its
 * entry). An in-file marker is deleted by the same `rm` that deletes the guard, so the stale-entry
 * class cannot occur rather than being detected after the fact.
 */
const MECHANISM_QUALIFIERS = {
  script: ['reach', 'relation', 'resolution'],
  rehome: ['eslint', 'dependency-cruiser', 'jest'],
};

const findMechanismVerdict = (comments) => {
  for (const comment of comments) {
    const match = GUARD_MECHANISM_REGEX.exec(comment.value);
    if (match) {
      return { comment, disposition: match[1], qualifier: match[2], reason: match[3] ?? '' };
    }
  }
  return undefined;
};

const requireGuardMechanismVerdictRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Requires a validate-no-* guard script to state which property forces it to be a script rather than an ESLint or dependency-cruiser rule',
    },
    schema: [
      {
        type: 'object',
        properties: {
          qualifiers: {
            type: 'object',
            additionalProperties: { type: 'array', items: { type: 'string' }, minItems: 1 },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missingVerdict:
        'This guard must declare "MECHANISM: <disposition> — <qualifier> — <reason>". Use "script" with one of ({{scriptQualifiers}}) when a linter structurally cannot do the job, or "rehome" with its destination when it is pending a move. A guard that can name neither belongs in a pass something already makes.',
      unknownDisposition:
        'Mechanism disposition "{{disposition}}" is not one of: {{dispositions}}.',
      unknownQualifier:
        'Mechanism qualifier "{{qualifier}}" is not valid for disposition "{{disposition}}" (expected one of: {{allowed}}).',
      missingReason:
        'Mechanism verdict names a disposition and qualifier but no reason. For "script", state what it reads or resolves that a linter cannot; for "rehome", name the plan row that owns the port.',
    },
  },
  create(context) {
    const qualifiers = context.options[0]?.qualifiers ?? MECHANISM_QUALIFIERS;
    const dispositions = Object.keys(qualifiers);

    return {
      Program(node) {
        const verdict = findMechanismVerdict(getSourceCode(context).getAllComments());

        if (verdict === undefined) {
          context.report({
            node,
            messageId: 'missingVerdict',
            data: { scriptQualifiers: (qualifiers.script ?? []).join(', ') },
          });
          return;
        }

        const disposition = verdict.disposition.toLowerCase();
        const allowedQualifiers = qualifiers[disposition];
        if (allowedQualifiers === undefined) {
          context.report({
            node: verdict.comment,
            messageId: 'unknownDisposition',
            data: { disposition: verdict.disposition, dispositions: dispositions.join(', ') },
          });
          return;
        }

        if (!allowedQualifiers.includes(verdict.qualifier.toLowerCase())) {
          context.report({
            node: verdict.comment,
            messageId: 'unknownQualifier',
            data: {
              qualifier: verdict.qualifier,
              disposition,
              allowed: allowedQualifiers.join(', '),
            },
          });
          return;
        }

        if (verdict.reason.trim() === '') {
          context.report({ node: verdict.comment, messageId: 'missingReason' });
        }
      },
    };
  },
};

/**
 * `mode` reached as a property, in any of the four spellings a program can write it. Comments and
 * string literals are deliberately absent: they are the reason the script this rule replaces
 * carried ten allowlist entries, and prose describing the migration is not the migration.
 */
const AUTOMATION_MODE_SELECTORS = [
  "Property[computed=false][key.name='mode']",
  "Property[computed=true][key.value='mode']",
  "MemberExpression[computed=false][property.name='mode']",
  "MemberExpression[computed=true][property.value='mode']",
  "TSPropertySignature[computed=false][key.name='mode']",
];

const noDeprecatedAutomationModeRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbids reading or declaring the deprecated automation `mode` property; script tools are configured with `trigger` + `confirm`',
    },
    schema: [],
    messages: {
      deprecatedMode:
        'Script tools are configured with `trigger` + `confirm`, not `mode`. The deprecated field is still parsed and folded forward in core/script-schema.ts and core/script-definition-loader.ts, which this rule does not visit; new code must not read it.',
    },
  },
  create(context) {
    const report = (node) => context.report({ node, messageId: 'deprecatedMode' });
    return Object.fromEntries(AUTOMATION_MODE_SELECTORS.map((selector) => [selector, report]));
  },
};

/**
 * A gate that declares retirable exceptions must also audit them.
 *
 * `closedBy` is this repo's marker for "this exemption names what would let it be deleted" — the
 * FORM half of exception hygiene. `auditExceptions` (scripts/lib/exception-hygiene.js) is the
 * TRUTH half: it asks, on every run, whether the entry still suppresses anything. Row 4.3: no gate
 * had both until 4.1, and nothing required the pair of a NEW surface.
 *
 * It is not hypothetical. `scripts/validate-db-claim-order.js` landed while this plan was open
 * carrying `closedBy` on every entry of `ACCEPTED_INHERITORS` and no audit call — the author
 * adopted the half that is visible while reading the file and missed the half you only make if you
 * know the harness exists. That asymmetry is why this is a rule rather than a convention.
 *
 * WHY `closedBy` AND NOT THE DECLARATION'S NAME: matching identifiers like `ALLOWLIST` /
 * `ACCEPTED_*` / `ALLOWED_*` finds `ALLOWED_METRIC_LABELS`, `ACCEPTED_PACKAGE_NAMES` and
 * `ALLOWED_PREFIX_TOKENS`, none of which are gate exceptions. `closedBy` is the property itself.
 *
 * KNOWN BLIND SPOT, stated rather than papered over: an exception list carrying NEITHER `closedBy`
 * nor an audit is invisible here, because nothing distinguishes it from an ordinary constant. This
 * rule catches the half-adopted case, which is the one observed. Widening it to identifier names
 * would trade a documented gap for silent false positives on domain vocabulary.
 */
const requireExceptionAuditRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'A gate declaring `closedBy` exceptions must pass them through `auditExceptions`',
    },
    schema: [],
    messages: {
      missingAudit:
        'This file declares exceptions with `closedBy` but never calls `auditExceptions`. `closedBy` is the form half — it states what would retire the entry. Without the truth half nothing ever asks whether the entry still suppresses a finding, so it survives after the defect it excuses is gone. Import `auditExceptions` from `./lib/exception-hygiene.js`, classify each entry, and fold `reportExceptionAudit`s count into the exit code.',
    },
  },
  create(context) {
    let firstClosedBy = null;
    let auditsExceptions = false;

    return {
      'Property > Identifier.key[name="closedBy"]'(node) {
        if (firstClosedBy === null) firstClosedBy = node;
      },
      'CallExpression > Identifier.callee[name="auditExceptions"]'() {
        auditsExceptions = true;
      },
      'Program:exit'() {
        if (firstClosedBy !== null && !auditsExceptions) {
          context.report({ node: firstClosedBy, messageId: 'missingAudit' });
        }
      },
    };
  },
};

export const rules = {
  'require-exception-audit': requireExceptionAuditRule,
  'no-context-deep-imports': noContextDeepImportsRule,
  'no-legacy-imports': noLegacyImportsRule,
  'require-file-lifecycle': requireLifecycleRule,
  'no-emojis': noEmojiCharactersRule,
  'no-compat-reexport-shim': noCompatReexportShimRule,
  'require-guard-mechanism-verdict': requireGuardMechanismVerdictRule,
  'no-deprecated-automation-mode': noDeprecatedAutomationModeRule,
};

export default {
  rules,
};

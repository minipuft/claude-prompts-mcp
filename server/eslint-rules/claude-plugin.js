const DEFAULT_FORBIDDEN_PATTERNS = ['legacy/', '/legacy/', '@legacy/', 'legacy-'];
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

    throw new Error(`Invalid pattern configuration supplied to claude/no-legacy-imports: ${pattern}`);
  });
};

const getSourceCode = (context) => context.sourceCode ?? context.getSourceCode();
const codeUnitLength = (codePoint) => (codePoint !== undefined && codePoint > 0xffff ? 2 : 1);
const matchesRegex = (regex, codePoint) => {
  if (codePoint === undefined) {
    return false;
  }
  return regex.test(String.fromCodePoint(codePoint));
};
const isEmojiStart = (codePoint) => matchesRegex(EXTENDED_PICTOGRAPHIC_REGEX, codePoint) || matchesRegex(EMOJI_COMPONENT_REGEX, codePoint);
const isEmojiComponent = (codePoint) => matchesRegex(EMOJI_COMPONENT_REGEX, codePoint);
const isEmojiModifier = (codePoint) => matchesRegex(EMOJI_MODIFIER_REGEX, codePoint);
const isVariationSelector = (codePoint) => (codePoint !== undefined ? VARIATION_SELECTORS.has(codePoint) : false);

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

        if (isVariationSelector(nextCodePoint) || isEmojiModifier(nextCodePoint) || isEmojiComponent(nextCodePoint)) {
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
      missingLifecycle: 'Files in guarded folders must declare a @lifecycle annotation (one of: {{allowed}}).',
      invalidLifecycle: 'Lifecycle status "{{status}}" is not allowed here (expected one of: {{allowed}}).',
      missingDescription: 'Lifecycle annotations must include a short description (e.g. "@lifecycle canonical - gate entrypoint").',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const allowed = (options.allowedStatuses ?? ['canonical', 'migrating', 'legacy']).map((status) =>
      status.toLowerCase(),
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
          context.report({ node, messageId: 'missingLifecycle', data: { allowed: allowedDisplay } });
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
          context.report({ node, messageId: 'missingLifecycle', data: { allowed: allowedDisplay } });
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
      description: 'Prevents emoji characters from entering source files (removes them automatically).',
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

export const rules = {
  'no-legacy-imports': noLegacyImportsRule,
  'require-file-lifecycle': requireLifecycleRule,
  'no-emojis': noEmojiCharactersRule,
};

export default {
  rules,
};

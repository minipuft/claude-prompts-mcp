#!/usr/bin/env node
/**
 * Merges manual [Unreleased] changelog entries into the latest versioned section.
 *
 * Runs as a post-step in the Release Please workflow. After Release Please
 * generates a versioned section from commit messages, this script takes any
 * richer manual entries from [Unreleased] and merges them in by section heading.
 *
 * Release Please inserts each new version section at the top of the file, above the
 * [Unreleased] header, so every release would push that header one section further down.
 * The script therefore also keeps exactly one [Unreleased] header directly above the
 * newest version section, whether or not there was anything to merge.
 *
 * Usage: node scripts/merge-unreleased-changelog.js [path/to/CHANGELOG.md]
 */

const fs = require('fs');
const path = require('path');

const CHANGELOG_PATH = process.argv[2] || path.join(__dirname, '..', 'CHANGELOG.md');

// Section order per changelog-generator skill / Keep a Changelog
const SECTION_ORDER = [
  'Added',
  'Changed',
  'Deprecated',
  'Removed',
  'Fixed',
  'Security',
  'Improved',
  'Documentation',
];

/**
 * Parse a changelog region into { heading: entries[] } map.
 * A "region" is the text between two ## headings.
 */
function parseSections(text) {
  const sections = new Map();
  let currentSection = null;

  for (const line of text.split('\n')) {
    const headingMatch = line.match(/^### (.+)$/);
    if (headingMatch) {
      currentSection = headingMatch[1].trim();
      if (!sections.has(currentSection)) {
        sections.set(currentSection, []);
      }
    } else if (currentSection && line.trim()) {
      sections.get(currentSection).push(line);
    }
  }

  return sections;
}

/**
 * Merge manual entries into versioned entries by section heading.
 * Manual entries are prepended (richer descriptions come first).
 */
function mergeSections(manualSections, versionedSections) {
  const merged = new Map();

  // Start with all versioned sections
  for (const [heading, entries] of versionedSections) {
    merged.set(heading, [...entries]);
  }

  // Merge manual sections in
  for (const [heading, entries] of manualSections) {
    if (merged.has(heading)) {
      // Prepend manual entries before auto-generated ones
      merged.set(heading, [...entries, ...merged.get(heading)]);
    } else {
      merged.set(heading, [...entries]);
    }
  }

  return merged;
}

/**
 * Render merged sections back to markdown, respecting section order.
 */
function renderSections(sections) {
  const lines = [];

  // Ordered sections first
  for (const heading of SECTION_ORDER) {
    if (sections.has(heading)) {
      lines.push(`### ${heading}\n`);
      for (const entry of sections.get(heading)) {
        lines.push(entry);
      }
      lines.push('');
      sections.delete(heading);
    }
  }

  // Any remaining sections not in the standard order
  for (const [heading, entries] of sections) {
    lines.push(`### ${heading}\n`);
    for (const entry of entries) {
      lines.push(entry);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Move the [Unreleased] block (header plus whatever body it still holds) so it sits
 * directly above the first versioned section. After a merge the body is empty; a body
 * that could not be merged (no ### headings) travels with its header rather than being
 * dropped. Returns the text unchanged when there is no [Unreleased] header, no versioned
 * section to sit above, or the header is already above the newest version.
 * A missing header is never invented: a changelog that does not keep one has chosen not to.
 */
function relocateUnreleased(content) {
  const lines = content.split('\n');
  const unreleasedIdx = lines.findIndex((line) => /^## \[Unreleased\]\s*$/.test(line));
  const firstVersionIdx = lines.findIndex((line) => /^## \[\d+\.\d+\.\d+\]/.test(line));

  if (unreleasedIdx === -1 || firstVersionIdx === -1 || unreleasedIdx < firstVersionIdx) {
    return content;
  }

  let blockEnd = lines.findIndex((line, idx) => idx > unreleasedIdx && /^## /.test(line));
  if (blockEnd === -1) blockEnd = lines.length;

  const body = lines
    .slice(unreleasedIdx + 1, blockEnd)
    .join('\n')
    .trim();
  const relocated = ['## [Unreleased]', '', ...(body ? [body, ''] : [])];

  const remaining = [...lines.slice(0, unreleasedIdx), ...lines.slice(blockEnd)];
  const withHeader = [
    ...remaining.slice(0, firstVersionIdx),
    ...relocated,
    ...remaining.slice(firstVersionIdx),
  ];
  const text = withHeader.join('\n');
  return blockEnd === lines.length ? `${text.trimEnd()}\n` : text;
}

/**
 * Merge [Unreleased] bullets into the newest versioned section by ### heading.
 * Returns { content, note }: content is the new text (identical when nothing merged),
 * note says what happened when nothing was merged, merged describes a merge.
 */
function mergeUnreleased(content) {
  const unreleasedMatch = content.match(/^## \[Unreleased\]\s*$/m);
  if (!unreleasedMatch) {
    return {
      content,
      note: 'No [Unreleased] section found. Nothing to merge.',
    };
  }

  const unreleasedStart = unreleasedMatch.index + unreleasedMatch[0].length;

  // The newest version is the first versioned heading in the file — Release Please puts it
  // at the top, above [Unreleased]; a Keep a Changelog layout puts it below.
  const bestMatch = /^## \[(\d+\.\d+\.\d+)\]/m.exec(content);
  if (!bestMatch) {
    return {
      content,
      note: 'No versioned section found. Nothing to merge into.',
    };
  }

  // Extract [Unreleased] content (between [Unreleased] heading and the next ## heading after it)
  const afterUnreleased = content.slice(unreleasedStart);
  const nextHeadingAfterUnreleased = afterUnreleased.match(/^## \[/m);
  const unreleasedText = nextHeadingAfterUnreleased
    ? afterUnreleased.slice(0, nextHeadingAfterUnreleased.index).trim()
    : afterUnreleased.trim();

  if (!unreleasedText) {
    return { content, note: '[Unreleased] is empty. Nothing to merge.' };
  }

  // Parse manual entries from [Unreleased]
  const manualSections = parseSections(unreleasedText);
  if (manualSections.size === 0) {
    return {
      content,
      note: '[Unreleased] has no section headings. Nothing to merge.',
    };
  }

  // Find the versioned section's content boundaries
  const versionedAbsoluteStart = bestMatch.index;
  const versionedHeadingEnd = content.indexOf('\n', versionedAbsoluteStart) + 1;
  const versionedHeading = content.slice(versionedAbsoluteStart, versionedHeadingEnd);

  const restAfterVersioned = content.slice(versionedHeadingEnd);
  const nextSectionMatch = restAfterVersioned.match(/^## \[/m);
  const versionedEnd = nextSectionMatch
    ? versionedHeadingEnd + nextSectionMatch.index
    : content.length;

  const versionedText = content.slice(versionedHeadingEnd, versionedEnd).trim();
  const versionedSections = parseSections(versionedText);

  // Merge
  const merged = mergeSections(manualSections, versionedSections);
  const mergedText = renderSections(merged);

  // Reconstruct: replace versioned section with merged content
  const beforeVersioned = content.slice(0, versionedAbsoluteStart);
  const afterVersioned = content.slice(versionedEnd);

  let newContent = [
    beforeVersioned.trimEnd(),
    '',
    versionedHeading.trimEnd(),
    '',
    mergedText.trimEnd(),
    '',
    afterVersioned.trimStart(),
  ].join('\n');

  // Clear [Unreleased] entries (keep heading, remove content until next ## heading)
  newContent = newContent.replace(/(## \[Unreleased\]\s*\n)[\s\S]*?(?=\n## \[)/m, '$1\n');

  const entryCount = [...manualSections.values()].reduce((sum, entries) => sum + entries.length, 0);
  return {
    content: newContent,
    merged: `Merged ${entryCount} manual entries from ${manualSections.size} sections into ${versionedHeading.trim()}`,
  };
}

function main() {
  if (!fs.existsSync(CHANGELOG_PATH)) {
    console.error(`Changelog not found: ${CHANGELOG_PATH}`);
    process.exit(1);
  }

  const original = fs.readFileSync(CHANGELOG_PATH, 'utf-8');

  const mergeResult = mergeUnreleased(original);
  const relocated = relocateUnreleased(mergeResult.content);
  const moved = relocated !== mergeResult.content;

  if (relocated === original) {
    console.log(
      `${mergeResult.note || 'Nothing to do.'} [Unreleased] is already above the newest release or absent.`,
    );
    return;
  }

  fs.writeFileSync(CHANGELOG_PATH, relocated, 'utf-8');

  const actions = [];
  if (mergeResult.merged) actions.push(mergeResult.merged);
  if (moved) actions.push('moved [Unreleased] above the newest release');
  console.log(actions.join('; '));
}

main();

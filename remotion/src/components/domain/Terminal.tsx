import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { colors, fontFamilies, fontSizes, radii, spacing } from "../../constants";
import type { TerminalVariant } from "../../constants/colors";

// Line types for terminal content
export type TerminalLine =
  | { type: "command"; text: string }
  | { type: "output"; text: string }
  | { type: "tool"; name: string; args?: string }
  | { type: "error"; text: string };

type TerminalProps = {
  variant: TerminalVariant;
  title?: string;
  lines: TerminalLine[];
  typing?: {
    enabled: boolean;
    charsPerSecond?: number;
    startFrame?: number;
  };
  cursor?: {
    visible?: boolean;
    blinkRate?: number;
  };
  start?: number;
};

const variantConfig = {
  claude: {
    prompt: "❯",
    borderRadius: radii.lg,
  },
  opencode: {
    prompt: "$",
    borderRadius: radii.md,
  },
  gemini: {
    prompt: ">",
    borderRadius: radii.md,
  },
} as const;

export const Terminal: React.FC<TerminalProps> = ({
  variant,
  title,
  lines,
  typing = { enabled: true, charsPerSecond: 30, startFrame: 0 },
  cursor = { visible: true, blinkRate: 15 },
  start = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const tokens = colors.terminal[variant];
  const config = variantConfig[variant];

  // Fade in animation
  const opacity = interpolate(frame, [start, start + fps * 0.5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Calculate visible characters for typing effect
  const totalChars = lines.reduce((acc, line) => {
    if (line.type === "command" || line.type === "output" || line.type === "error") {
      return acc + line.text.length + 1; // +1 for newline
    }
    if (line.type === "tool") {
      return acc + line.name.length + (line.args?.length ?? 0) + 1;
    }
    return acc;
  }, 0);

  const typingStart = typing.startFrame ?? start;
  const charsPerSecond = typing.charsPerSecond ?? 30;
  const visibleChars = typing.enabled
    ? Math.max(0, Math.floor(((frame - typingStart) / fps) * charsPerSecond))
    : totalChars;

  // Cursor blink
  const showCursor =
    cursor.visible !== false && Math.floor(frame / (cursor.blinkRate ?? 15)) % 2 === 0;

  return (
    <div
      style={{
        opacity,
        backgroundColor: tokens.bg,
        borderRadius: config.borderRadius,
        border: `1px solid ${colors.overlay.medium}`,
        boxShadow: "0 24px 60px rgba(0, 0, 0, 0.4)",
        overflow: "hidden",
        width: "100%",
      }}
    >
      {/* Chrome bar */}
      <div
        style={{
          backgroundColor: tokens.chrome,
          padding: `${spacing.sm}px ${spacing.md}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", gap: spacing.xs }}>
          <span style={{ width: 12, height: 12, borderRadius: 999, backgroundColor: "#ff5f56" }} />
          <span style={{ width: 12, height: 12, borderRadius: 999, backgroundColor: "#ffbd2e" }} />
          <span style={{ width: 12, height: 12, borderRadius: 999, backgroundColor: "#27ca40" }} />
        </div>
        <span
          style={{
            fontFamily: fontFamilies.body,
            fontSize: fontSizes.xs,
            color: colors.text.muted,
            textTransform: "lowercase",
          }}
        >
          {title ?? variant}
        </span>
        <div style={{ width: 52 }} /> {/* Spacer for centering */}
      </div>

      {/* Content area */}
      <div
        style={{
          padding: spacing.lg,
          display: "flex",
          flexDirection: "column",
          gap: spacing.sm,
          minHeight: 120,
        }}
      >
        {renderLines(lines, visibleChars, tokens, config.prompt, showCursor)}
      </div>

      {/* Accent bar at bottom */}
      <div
        style={{
          height: 3,
          background: `linear-gradient(90deg, ${tokens.accent}, transparent 80%)`,
        }}
      />
    </div>
  );
};

function renderLines(
  lines: TerminalLine[],
  visibleChars: number,
  tokens: (typeof colors.terminal)[TerminalVariant],
  promptChar: string,
  showCursor: boolean
) {
  let charCount = 0;
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = charCount;

    if (line.type === "command") {
      const lineEnd = lineStart + line.text.length;
      const visible = Math.max(0, Math.min(line.text.length, visibleChars - lineStart));

      if (visible > 0 || visibleChars > lineStart) {
        elements.push(
          <div
            key={i}
            style={{
              display: "flex",
              gap: spacing.sm,
              fontFamily: fontFamilies.mono,
              fontSize: fontSizes.sm,
            }}
          >
            <span style={{ color: tokens.prompt, flexShrink: 0 }}>{promptChar}</span>
            <span style={{ color: tokens.text }}>
              {line.text.slice(0, visible)}
              {visibleChars >= lineStart && visibleChars < lineEnd && showCursor && (
                <span style={{ color: tokens.accent }}>▋</span>
              )}
            </span>
          </div>
        );
      }
      charCount = lineEnd + 1;
    } else if (line.type === "output") {
      const lineEnd = lineStart + line.text.length;
      const visible = Math.max(0, Math.min(line.text.length, visibleChars - lineStart));

      if (visible > 0) {
        elements.push(
          <div
            key={i}
            style={{
              fontFamily: fontFamilies.mono,
              fontSize: fontSizes.sm,
              color: tokens.output,
              paddingLeft: spacing.lg + spacing.sm, // Indent to align with command text
            }}
          >
            {line.text.slice(0, visible)}
          </div>
        );
      }
      charCount = lineEnd + 1;
    } else if (line.type === "tool") {
      const toolText = `${line.name}${line.args ? `(${line.args})` : ""}`;
      const lineEnd = lineStart + toolText.length;
      const visible = Math.max(0, Math.min(toolText.length, visibleChars - lineStart));

      if (visible > 0) {
        elements.push(
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: spacing.sm,
              fontFamily: fontFamilies.mono,
              fontSize: fontSizes.sm,
            }}
          >
            <span
              style={{
                backgroundColor: tokens.toolBadge,
                color: "#fff",
                padding: `2px ${spacing.xs}px`,
                borderRadius: radii.sm,
                fontSize: fontSizes.xs,
              }}
            >
              TOOL
            </span>
            <span style={{ color: tokens.text }}>{toolText.slice(0, visible)}</span>
          </div>
        );
      }
      charCount = lineEnd + 1;
    } else if (line.type === "error") {
      const lineEnd = lineStart + line.text.length;
      const visible = Math.max(0, Math.min(line.text.length, visibleChars - lineStart));

      if (visible > 0) {
        elements.push(
          <div
            key={i}
            style={{
              fontFamily: fontFamilies.mono,
              fontSize: fontSizes.sm,
              color: colors.status.fail,
              paddingLeft: spacing.lg + spacing.sm,
            }}
          >
            {line.text.slice(0, visible)}
          </div>
        );
      }
      charCount = lineEnd + 1;
    }
  }

  // Show cursor at end if all text is visible
  if (showCursor && visibleChars >= charCount) {
    elements.push(
      <div
        key="cursor-end"
        style={{
          display: "flex",
          gap: spacing.sm,
          fontFamily: fontFamilies.mono,
          fontSize: fontSizes.sm,
        }}
      >
        <span style={{ color: tokens.prompt }}>{promptChar}</span>
        <span style={{ color: tokens.accent }}>▋</span>
      </div>
    );
  }

  return elements;
}

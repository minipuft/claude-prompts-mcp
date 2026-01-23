import { colors, fontFamilies, fontSizes, radii, spacing } from "../../constants";

type CodeBlockProps = {
  code: string;
  accent?: string;
};

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  accent = colors.accent.primary,
}) => {
  return (
    <div
      style={{
        backgroundColor: colors.background.tertiary,
        borderRadius: radii.lg,
        border: `1px solid ${colors.overlay.medium}`,
        padding: spacing.lg,
        boxShadow: "0 18px 40px rgba(0, 0, 0, 0.35)",
        whiteSpace: "pre-wrap",
        fontFamily: fontFamilies.mono,
        fontSize: fontSizes.sm,
        color: colors.text.primary,
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          width: 10,
          height: 10,
          borderRadius: 999,
          backgroundColor: accent,
          boxShadow: `0 0 12px ${accent}`,
        }}
      />
      {code}
    </div>
  );
};

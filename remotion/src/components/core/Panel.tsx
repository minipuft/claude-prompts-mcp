import { colors, radii, spacing } from "../../constants";

type PanelProps = {
  children: React.ReactNode;
  padding?: number;
  borderColor?: string;
  background?: string;
  width?: number | string;
};

export const Panel: React.FC<PanelProps> = ({
  children,
  padding = spacing.lg,
  borderColor = colors.overlay.medium,
  background = colors.overlay.light,
  width,
}) => {
  return (
    <div
      style={{
        padding,
        background,
        border: `1px solid ${borderColor}`,
        borderRadius: radii.lg,
        width,
        boxShadow: "0 20px 60px rgba(0, 0, 0, 0.35)",
      }}
    >
      {children}
    </div>
  );
};

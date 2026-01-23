import { colors, spacing } from "../../constants";

type FlowConnectorProps = {
  active?: boolean;
};

export const FlowConnector: React.FC<FlowConnectorProps> = ({ active = false }) => {
  return (
    <div
      style={{
        width: 80,
        height: 4,
        borderRadius: 999,
        backgroundColor: active ? colors.accent.primary : colors.overlay.medium,
        boxShadow: active ? `0 0 14px ${colors.accent.primary}` : undefined,
        marginInline: spacing.md,
      }}
    />
  );
};

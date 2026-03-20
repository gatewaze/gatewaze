import { Tooltip as ReactTooltip } from "@/components/shared/Tooltip";

export default function Tooltip() {
  return (
    <ReactTooltip
      anchorSelect="[data-tooltip]"
      opacity={1}
      style={{
        padding: "0.3rem 0.75rem",
        borderRadius: "0.5rem",
        zIndex: 1000,
      }}
    />
  );
}

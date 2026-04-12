import { Text } from "@radix-ui/themes";
import { Lock } from "lucide-react";

export function ColorInput({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className={disabled ? "opacity-60" : ""}>
      <Text as="label" size="2" weight="medium" className="flex items-center gap-1.5">
        {label}
        {disabled && <Lock className="h-3 w-3 text-[var(--gray-9)]" />}
      </Text>
      <Text as="p" size="1" color="gray" className="pb-2">
        {description}
      </Text>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-10 w-14 cursor-pointer rounded border border-[var(--gray-6)] bg-transparent p-1 disabled:cursor-not-allowed"
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          disabled={disabled}
          className="max-w-[140px] rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-sm disabled:cursor-not-allowed"
        />
        <div className="h-10 flex-1 rounded border border-[var(--gray-6)] bg-white p-0.5">
          <div
            className="h-full w-full rounded-sm"
            style={{ backgroundColor: value }}
          />
        </div>
      </div>
    </div>
  );
}

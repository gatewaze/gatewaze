import { Text } from "@radix-ui/themes";

export function ColorInput({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Text as="label" size="2" weight="medium">
        {label}
      </Text>
      <Text as="p" size="1" color="gray">
        {description}
      </Text>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-14 cursor-pointer rounded border border-[var(--gray-6)] bg-transparent p-1"
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          className="max-w-[140px] rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-sm"
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

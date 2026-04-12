import { Text, Slider } from "@radix-ui/themes";

export function SliderInput({
  label,
  description,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  description?: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div>
      <Text as="label" size="2" weight="medium">
        {label}
      </Text>
      {description && (
        <Text as="p" size="1" color="gray" className="pb-2">
          {description}
        </Text>
      )}
      <div className="flex items-center gap-3 pt-1">
        <input
          type="number"
          value={value}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(parseFloat(Math.min(max, Math.max(min, v)).toFixed(2)));
          }}
          min={min}
          max={max}
          step={step}
          className="w-[72px] rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-sm tabular-nums"
        />
        <Slider
          value={[value]}
          onValueChange={([v]) => onChange(parseFloat(v.toFixed(2)))}
          min={min}
          max={max}
          step={step}
          className="flex-1"
        />
      </div>
    </div>
  );
}

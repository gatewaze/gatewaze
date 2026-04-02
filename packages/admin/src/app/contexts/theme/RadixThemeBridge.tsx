import { ReactNode } from "react";
import { Theme } from "@radix-ui/themes";
import { useThemeContext } from "./context";
import type { PrimaryColor } from "@/configs/@types/theme";
import { useActiveThemeModule } from "@/hooks/useActiveThemeModule";

// Map our PrimaryColor names to Radix Theme accentColor values.
// Most names match directly since we now use Radix color names.
const accentColorMap: Record<PrimaryColor, React.ComponentProps<typeof Theme>["accentColor"]> = {
  pink: "pink",
  red: "red",
  crimson: "crimson",
  orange: "orange",
  amber: "amber",
  green: "green",
  teal: "teal",
  blue: "blue",
  indigo: "indigo",
  violet: "violet",
  purple: "purple",
  plum: "plum",
  cyan: "cyan",
  rose: "pink", // Tailwind's rose ≈ Radix's pink
};

export function RadixThemeBridge({ children }: { children: ReactNode }) {
  const { isDark, primaryColorScheme } = useThemeContext();
  const activeTheme = useActiveThemeModule();
  const accentColor = accentColorMap[primaryColorScheme?.name] ?? "cyan";

  const radixOverrides = activeTheme?.themeOverrides.admin?.radixThemeProps ?? {};

  return (
    <Theme
      accentColor={accentColor}
      grayColor="slate"
      appearance={isDark ? "dark" : "light"}
      scaling="100%"
      panelBackground="translucent"
      {...radixOverrides}
    >
      {children}
    </Theme>
  );
}

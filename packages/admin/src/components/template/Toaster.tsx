// Import Dependencies
import { Toaster as SonnerToaster } from "sonner";

// Local Imports
import { defaultTheme } from "@/configs/theme";
import { useThemeContext } from "@/app/contexts/theme/context";

// ----------------------------------------------------------------------

export default function Toaster() {
  const { isDark, notification } = useThemeContext();

  return (
    <SonnerToaster
      theme={isDark ? "dark" : "light"}
      offset="16px"
      position={notification?.position || defaultTheme?.notification?.position}
      expand={
        notification?.isExpanded || defaultTheme?.notification?.isExpanded
      }
      visibleToasts={
        notification?.visibleToasts || defaultTheme?.notification?.visibleToasts
      }
      richColors
    />
  );
}

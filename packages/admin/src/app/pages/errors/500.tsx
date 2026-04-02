// Local Imports
import RepairServer from "@/assets/illustrations/repair-server.svg?react";
import { Page } from "@/components/shared/Page";
import { useThemeContext } from "@/app/contexts/theme/context";

// ----------------------------------------------------------------------

export default function Error500() {
  const {
    primaryColorScheme: primary,
    lightColorScheme: light,
    darkColorScheme: dark,
    isDark,
  } = useThemeContext();

  return (
    <Page title="Error 500">
      <main className="min-h-100vh relative grid w-full grow grid-cols-1 place-items-center p-4">
        <div className="w-full max-w-[26rem] text-center">
          <RepairServer
            className="w-full"
            style={{
              "--primary": primary[500],
              "--dark-400": isDark ? dark[400] : light[500],
              "--dark-600": isDark ? dark[600] : light[700],
            } as React.CSSProperties}
          />
          <p className="pt-8 text-7xl font-bold text-primary-600 dark:text-primary-500">
            500
          </p>
          <p className="pt-4 text-xl font-semibold text-[var(--gray-12)]">
            Internal Server Error
          </p>
          <p className="text-balance pt-2 text-[var(--gray-11)]">
            The server has been deserted for a while. Please be patient or try
            again later
          </p>
        </div>
      </main>
    </Page>
  );
}

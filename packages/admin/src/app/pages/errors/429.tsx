// Local Imports
import WindowCrash from "@/assets/illustrations/window-crash.svg?react";
import { Page } from "@/components/shared/Page";
import { useThemeContext } from "@/app/contexts/theme/context";

// ----------------------------------------------------------------------

export default function Error429() {
  const {
    primaryColorScheme: primary,
    lightColorScheme: light,
    darkColorScheme: dark,
    isDark,
  } = useThemeContext();

  return (
    <Page title="Error 429">
      <main className="min-h-100vh relative grid w-full grow grid-cols-1 place-items-center p-4">
        <div className="w-full max-w-[26rem] text-center">
          <WindowCrash
            className="w-full"
            style={{
              ["--primary" as string]: primary[500],
              ["--dark-700" as string]: isDark ? dark[700] : light[100],
              ["--dark-800" as string]: isDark ? dark[800] : light[300],
            }}
          />
          <p className="pt-6 text-7xl font-bold text-primary-600 dark:text-primary-500">
            429
          </p>
          <p className="pt-4 text-xl font-semibold text-[var(--gray-12)]">
            Too many requests
          </p>
          <p className="text-balance pt-2 text-[var(--gray-11)]">
            The user has send too many requests in a given amount of time.
            Intended for use with rate limiting schemas
          </p>
        </div>
      </main>
    </Page>
  );
}

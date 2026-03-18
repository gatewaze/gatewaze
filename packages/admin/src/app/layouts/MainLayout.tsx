import { Outlet } from 'react-router-dom';
import { SearchProvider } from '@/app/contexts/search/SearchProvider';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useTheme } from '@/app/contexts/theme/ThemeProvider';
import { isBrandingEnabled, GITHUB_URL } from '@/lib/branding';
import { AppSidebar } from './AppSidebar';
import { Header } from './Header';
import { SkipToMain } from '@/components/skip-to-main';
import { GradientBackground } from '@/components/gradient-background';
import { GlowProvider } from '@/components/glow-context';

export function MainLayout() {
  const defaultOpen = getCookieValue('sidebar_state') !== 'false';
  const { resolvedTheme } = useTheme();

  return (
    <GlowProvider>
      <SearchProvider>
        <SidebarProvider defaultOpen={defaultOpen}>
          <SkipToMain />
          <GradientBackground />
          <AppSidebar />
          <SidebarInset>
            <Header />
            <main id="content" className="relative z-10 flex-1 overflow-y-auto px-8 py-6 md:px-12 md:py-8">
              <Outlet />
            </main>
            {isBrandingEnabled && (
              <footer className="relative z-10 flex justify-center md:justify-end px-8 md:px-12 py-4 pb-6">
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="flex flex-col items-start gap-0.5 opacity-40 hover:opacity-80 transition-opacity">
                  <span className="text-[9px] font-medium tracking-wide text-muted-foreground">Powered by</span>
                  <img
                    src={resolvedTheme === 'dark'
                      ? '/gatewaze-wordmark-white.svg'
                      : '/gatewaze-wordmark-black.svg'}
                    alt="Gatewaze"
                    className="h-5"
                  />
                </a>
              </footer>
            )}
          </SidebarInset>
        </SidebarProvider>
      </SearchProvider>
    </GlowProvider>
  );
}

function getCookieValue(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? match[2] : null;
}

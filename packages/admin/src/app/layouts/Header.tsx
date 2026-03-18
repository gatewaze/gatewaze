import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { ThemeSwitch } from '@/components/theme-switch';

export function Header() {
  return (
    <header className="relative z-10 flex h-16 shrink-0 items-center gap-2 border-b border-border/50 px-8 md:px-12 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <ThemeSwitch />
      </div>
    </header>
  );
}

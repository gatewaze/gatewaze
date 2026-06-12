// Import Dependencies
import { Outlet } from "react-router";

// Local Imports
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { ContentFade } from "./ContentFade";
import { ContentTransitionsProvider } from "@/app/contexts/contentTransitions";
import { ImpersonationBanner } from "@/components/impersonation/ImpersonationBanner";
import { ModuleUpdateBanner } from "@/components/shared/ModuleUpdateBanner";
import GradientBackground from "@/components/shared/GradientBackground";

// ----------------------------------------------------------------------

export default function Sideblock() {
  return (
    <ContentTransitionsProvider>
      <GradientBackground />
      <ModuleUpdateBanner />
      <ImpersonationBanner />
      <Header />
      <main className="main-content transition-content grid grid-cols-1 p-(--margin-x)">
        <ContentFade>
          <Outlet />
        </ContentFade>
      </main>
      <Sidebar />
    </ContentTransitionsProvider>
  );
}
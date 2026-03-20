// Import Dependencies
import clsx from "clsx";
import { Outlet } from "react-router";

// Local Imports
import { Sidebar } from "./Sidebar";
import { ImpersonationBanner } from "@/components/impersonation/ImpersonationBanner";
import { ModuleUpdateBanner } from "@/components/shared/ModuleUpdateBanner";
import PixelTrail from "@/components/shared/PixelTrail";

// ----------------------------------------------------------------------

export default function MainLayout() {
  return (
    <>
      <PixelTrail />
      <ModuleUpdateBanner />
      <ImpersonationBanner />
      <main
        className={clsx("main-content transition-content grid grid-cols-1 p-(--margin-x)")}
      >
        <Outlet />
      </main>
      <Sidebar />
    </>
  );
}

// Import Dependencies
import { Outlet } from "react-router";

// Local Imports
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { ImpersonationBanner } from "@/components/impersonation/ImpersonationBanner";
import { ModuleUpdateBanner } from "@/components/shared/ModuleUpdateBanner";
import PixelTrail from "@/components/shared/PixelTrail";

// ----------------------------------------------------------------------

export default function Sideblock() {
  return (
    <>
      <PixelTrail />
      <ModuleUpdateBanner />
      <ImpersonationBanner />
      <Header />
      <main className="main-content transition-content grid grid-cols-1 p-(--margin-x)">
        <Outlet />
      </main>
      <Sidebar />
    </>
  );
} 
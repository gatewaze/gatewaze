// Import Dependencies
import { Outlet } from "react-router";

// Local Imports
import { Page } from "@/components/shared/Page";
import { Header } from "@/app/layouts/MainLayout/Header";
import { Sidebar } from "./Sidebar";
import { Card } from "@/components/ui";

// ----------------------------------------------------------------------

export default function Settings() {
  return (
    <Page title="Setting">
      <Header />
      <main className="main-content transition-content grid flex-1 grid-cols-1 place-content-start px-(--margin-x) py-6">
        <Card className="h-full w-full p-4 sm:px-5 2xl:mx-auto 2xl:max-w-5xl">
          <Outlet />
        </Card>
      </main>
      <Sidebar />
    </Page>
  );
}

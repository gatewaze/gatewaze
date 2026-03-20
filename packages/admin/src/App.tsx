// Import Dependencies
import { RouterProvider } from "react-router";

// Local Imports
import { AuthProvider } from "@/app/contexts/auth/Provider";
import { BreakpointProvider } from "@/app/contexts/breakpoint/Provider";
import { ModulesProviderWrapper } from "@/app/contexts/modules/Provider";
import { SidebarProvider } from "@/app/contexts/sidebar/Provider";
import { ThemeProvider } from "@/app/contexts/theme/Provider";
import { RadixThemeBridge } from "@/app/contexts/theme/RadixThemeBridge";
import router from "./app/router/router";
import "@/utils/testSupabase"; // Import test utilities for debugging
import "@/utils/supabaseSetup"; // Import setup utilities
import "@/utils/supabaseQuickSetup"; // Import quick setup utilities

// ----------------------------------------------------------------------

function App() {
  return (
    <AuthProvider>
      <ModulesProviderWrapper>
        <ThemeProvider>
          <RadixThemeBridge>
            <BreakpointProvider>
              <SidebarProvider>
                <RouterProvider router={router} />
              </SidebarProvider>
            </BreakpointProvider>
          </RadixThemeBridge>
        </ThemeProvider>
      </ModulesProviderWrapper>
    </AuthProvider>
  );
}

export default App;

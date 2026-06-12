import { useEffect, useState, type ReactNode } from "react";
import { getSupabase } from "@/lib/supabase";
import { ContentTransitionsContext, CONTENT_TRANSITIONS_KEY } from "./context";

export function ContentTransitionsProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await getSupabase()
          .from("platform_settings")
          .select("value")
          .eq("key", CONTENT_TRANSITIONS_KEY)
          .maybeSingle<{ value: string }>();
        if (!cancelled && data) setEnabled(data.value !== "off");
      } catch {
        // Default to enabled when the setting can't be read.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ContentTransitionsContext.Provider value={{ enabled, setEnabled }}>
      {children}
    </ContentTransitionsContext.Provider>
  );
}

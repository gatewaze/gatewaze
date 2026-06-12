import { createContext, useContext } from "react";

/**
 * Whether admin content fade transitions are enabled. Backed by the
 * `admin_content_transitions` platform setting ('on' | 'off'), defaulting to
 * enabled. Exposed app-wide so both the route-level fade (ContentFade) and the
 * tab-level fade (WorkspaceLayout) read one value, and the Settings toggle can
 * flip it live.
 */
export const CONTENT_TRANSITIONS_KEY = "admin_content_transitions";

export interface ContentTransitionsContextValue {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
}

export const ContentTransitionsContext = createContext<ContentTransitionsContextValue>({
  enabled: true,
  setEnabled: () => {},
});

export const useContentTransitions = () => useContext(ContentTransitionsContext);

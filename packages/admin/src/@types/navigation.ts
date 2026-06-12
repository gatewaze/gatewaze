import { NavigationType } from "@/constants/app";

export interface NavigationTree {
  id: string;
  type: NavigationType;
  path?: string;
  title?: string;
  transKey?: string;
  icon?: string;
  childs?: NavigationTree[];
  requiredFeature?: string;
  /**
   * Module/core-declared default sidebar section title (e.g. "Content").
   * Used to seed the categorized default layout; a saved layout overrides it.
   */
  defaultSection?: string;
  /** Declared sort weight within a section (lower first). */
  order?: number;
}

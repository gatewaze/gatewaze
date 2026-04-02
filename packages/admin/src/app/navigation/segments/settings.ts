import { NavigationTree } from "@/@types/navigation";

export const settings: NavigationTree = {
  id: "settings",
  type: "root",
  path: "/settings",
  title: "Settings",
  transKey: "nav.settings.settings",
  icon: "settings",
  childs: [
    {
      id: "general",
      type: "item",
      path: "/settings/general",
      title: "General",
      transKey: "nav.settings.general",
      icon: "settings.general",
    },
    {
      id: "appearance",
      type: "item",
      path: "/settings/appearance",
      title: "Appearance",
      transKey: "nav.settings.appearance",
      icon: "settings.appearance",
    },
    {
      id: "branding",
      type: "item",
      path: "/settings/branding",
      title: "Branding",
      transKey: "nav.settings.branding",
      icon: "settings.branding",
    },
  ],
};

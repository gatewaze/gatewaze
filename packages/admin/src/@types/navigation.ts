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
}

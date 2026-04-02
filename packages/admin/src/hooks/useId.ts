import { useId as useReactId } from "react";

export function useId(staticId?: string, suffix: string = ""): string {
  const uid = `tl-${useReactId()}-${suffix}`;

  if (typeof staticId === "string") return staticId;

  return uid;
}

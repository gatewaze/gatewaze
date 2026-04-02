import { useCallback, useEffect, useRef, useState } from "react";

export function useHover<T extends HTMLElement = any>() {
  const [hovered, setHovered] = useState<boolean>(false);
  const ref = useRef<T>(null);
  const onMouseEnter = useCallback(() => setHovered(true), []);
  const onMouseLeave = useCallback(() => setHovered(false), []);

  useEffect(() => {
    const node = ref.current;

    if (node) {
      node.addEventListener("mouseenter", onMouseEnter);
      node.addEventListener("mouseleave", onMouseLeave);

      return () => {
        node?.removeEventListener("mouseenter", onMouseEnter);
        node?.removeEventListener("mouseleave", onMouseLeave);
      };
    }

    return undefined;
  }, [ref.current]);

  return [ref, hovered] as const;
}

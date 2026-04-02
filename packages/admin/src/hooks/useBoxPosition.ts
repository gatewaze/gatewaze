import { useState, useEffect, useRef } from "react";

interface BoxPosition {
  x: number;
  y: number;
}

export function useBoxPosition<T extends HTMLElement = HTMLElement>() {
  const [position, setPosition] = useState<BoxPosition>({ x: 0, y: 0 });
  const ref = useRef<T>(null);

  useEffect(() => {
    const updatePosition = () => {
      if (ref.current) {
        const rect = ref.current.getBoundingClientRect();
        setPosition({ x: rect.left, y: rect.top });
      }
    };

    const currentElement = ref.current;
    const resizeObserver = new ResizeObserver(updatePosition);

    if (currentElement) {
      resizeObserver.observe(currentElement);
      updatePosition(); // Initial position update
    }

    // Add scroll and window resize listeners
    window.addEventListener("scroll", updatePosition);
    window.addEventListener("resize", updatePosition);

    return () => {
      if (currentElement) {
        resizeObserver.unobserve(currentElement);
      }
      window.removeEventListener("scroll", updatePosition);
      window.removeEventListener("resize", updatePosition);
    };
  }, []);

  return {
    ref,
    left: position.x,
    top: position.y,
  };
}

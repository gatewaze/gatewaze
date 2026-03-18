// Import Dependencies
import { useEffect, useState, ReactNode } from "react";

// ----------------------------------------------------------------------

interface DelayedProps {
  children: ReactNode;
  wait?: number;
}

export function Delayed({ children, wait = 300 }: DelayedProps) {
  const [isShown, setIsShown] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsShown(true);
    }, wait);
    return () => clearTimeout(timer);
  }, [wait]);

  if (!children) throw new Error("No children provided");

  return isShown ? children : null;
}

import { useEffect, useRef, useState } from "react";
import { useIsMounted } from "./useIsMounted";

interface BoxSize {
  width?: number;
  height?: number;
}

interface UseBoxSizeOptions {
  ref: React.RefObject<HTMLElement | null>;
  box?: "content-box" | "border-box" | "device-pixel-content-box";
  onResize?: (size: BoxSize) => void;
}

const initialSize = {
  width: undefined,
  height: undefined,
};

export function useBoxSize(options: UseBoxSizeOptions): BoxSize {
  const { ref, box = "content-box" } = options;
  const [{ width, height }, setSize] = useState<BoxSize>(initialSize);
  const isMounted = useIsMounted();
  const previousSize = useRef<BoxSize>({ ...initialSize });
  const onResize = useRef<((size: BoxSize) => void) | undefined>(undefined);
  onResize.current = options.onResize;

  useEffect(() => {
    if (!ref.current) return;

    if (typeof window === "undefined" || !("ResizeObserver" in window)) return;

    const observer = new ResizeObserver(([entry]) => {
      const boxProp =
        box === "border-box"
          ? "borderBoxSize"
          : box === "device-pixel-content-box"
            ? "devicePixelContentBoxSize"
            : "contentBoxSize";

      const newWidth = extractSize(entry, boxProp, "inlineSize");
      const newHeight = extractSize(entry, boxProp, "blockSize");

      const hasChanged =
        previousSize.current.width !== newWidth ||
        previousSize.current.height !== newHeight;

      if (hasChanged) {
        const newSize = { width: newWidth, height: newHeight };
        previousSize.current.width = newWidth;
        previousSize.current.height = newHeight;

        if (onResize.current) {
          onResize.current(newSize);
        } else {
          if (isMounted()) {
            setSize(newSize);
          }
        }
      }
    });

    observer.observe(ref.current, { box });

    return () => {
      observer.disconnect();
    };
  }, [box, ref, isMounted]);

  return { width, height };
}

function extractSize(
  entry: ResizeObserverEntry,
  box: string,
  sizeType: string
): number | undefined {
  const entryBox = (
    entry as unknown as {
      [key: string]: ResizeObserverSize[] | ResizeObserverSize;
    }
  )[box];

  if (!entryBox) {
    if (box === "contentBoxSize") {
      return entry.contentRect[sizeType === "inlineSize" ? "width" : "height"];
    }
    return undefined;
  }

  return Array.isArray(entryBox)
    ? entryBox[0][sizeType as keyof ResizeObserverSize]
    : entryBox[sizeType as keyof ResizeObserverSize];
}

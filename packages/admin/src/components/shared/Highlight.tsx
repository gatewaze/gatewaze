// Import Dependencies
import clsx from "clsx";
import { Fragment } from "react";

// Local Imports
import { HighlightChunk, useHighlight } from "@/hooks";

// ----------------------------------------------------------------------

/**
 * Props for the Highlight component
 */
interface HighlightProps {
  /**
   * Text content to be highlighted
   */
  children: string | number;
  /**
   * The search query to highlight within the text
   */
  query: string | string[];
  /**
   * Whether to remove default styling
   */
  unstyled?: boolean;
  /**
   * Additional CSS class for highlighted text
   */
  highlightClass?: string;
}

/**
 * Highlight component that marks occurrences of a query within text
 */
export function Highlight({
  children,
  query,
  unstyled = false,
  highlightClass,
}: HighlightProps) {
  if (!(typeof children === "string" || typeof children === "number")) {
    throw new Error(
      "The children prop of Highlight must be a string or number.",
    );
  }

  const chunks: HighlightChunk[] = useHighlight({
    query,
    text: children.toString(),
  });

  return (
    <>
      {chunks.map((chunk, index) => {
        return chunk.match ? (
          <mark
            key={index}
            className={clsx(
              "whitespace-nowrap",
              !unstyled &&
              "inline-block rounded-xs bg-lime-200 dark:bg-lime-300",
              highlightClass,
            )}
          >
            {chunk.text}
          </mark>
        ) : (
          <Fragment key={index}>{chunk.text}</Fragment>
        );
      })}
    </>
  );
}

// Import Dependencies
import clsx from "clsx";
import { SVGProps } from "react";
import { useLayoutEffect } from "react";

// Local Imports
import {
  injectStyles,
  insertStylesToHead,
  makeStyleTag,
  removeStylesFromHead,
} from "@/utils/dom/injectStylesToHead";

// ----------------------------------------------------------------------

const css = `
@keyframes checkmark {
    0% {
        stroke-dashoffset: 100px
    }
    100% {
        stroke-dashoffset: 0px
    }
}

@keyframes checkmark-circle {
    0% {
        stroke-dashoffset: 480px 
    }
    100% {
        stroke-dashoffset: 960px
    }
}

svg[data-animated-tick=true] .checkmark-tick {
    animation: checkmark 0.25s ease-in 0.6s backwards
}

svg[data-animated-tick=true] .checkmark-circle {
    animation: checkmark-circle 0.6s ease-in-out backwards;
}`;

interface AnimatedTickProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  strokeWidth?: number;
  animate?: boolean;
  className?: string;
}

export function AnimatedTick({
  strokeWidth = 10,
  animate = true,
  className,
  ...rest
}: AnimatedTickProps) {
  useLayoutEffect(() => {
    const sheet = makeStyleTag();

    injectStyles(sheet, css);
    insertStylesToHead(sheet);

    return () => removeStylesFromHead(sheet);
  }, []);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 154 154"
      fill="none"
      data-animated-tick={animate}
      className={clsx("stroke-current", className)}
      {...rest}
    >
      <path
        d="M77 141C112.346 141 141 112.346 141 77C141 41.6538 112.346 13 77 13C41.6538 13 13 41.6538 13 77C13 112.346 41.6538 141 77 141Z"
        style={{ strokeDasharray: "480px, 480px", strokeDashoffset: "960px" }}
        strokeWidth={strokeWidth}
        className="checkmark-circle"
      />
      <path
        d="M46 80.2444L63.9556 98.1111L107.067 55"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ strokeDasharray: "100px, 100px", strokeDashoffset: "200px" }}
        className="checkmark-tick"
      />
    </svg>
  );
}

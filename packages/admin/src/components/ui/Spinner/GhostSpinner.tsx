import clsx from "clsx";
import { forwardRef, ForwardedRef } from "react";
import { Spinner, SpinnerProps } from "./Spinner";

const GhostSpinner = forwardRef(
  (
    props: Omit<SpinnerProps, "color">,
    ref: ForwardedRef<HTMLDivElement>,
  ) => {
    const { className, ...rest } = props;

    return (
      <Spinner
        className={clsx("[&_svg]:text-white", className)}
        ref={ref}
        {...rest}
      />
    );
  },
);

GhostSpinner.displayName = "GhostSpinner";

export { GhostSpinner };

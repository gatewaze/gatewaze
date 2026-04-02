// Import Dependencies
import { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import clsx from "clsx";

// ----------------------------------------------------------------------

export type BoxProps<T extends ElementType = "div"> = {
    component?: T;
    className?: string;
    children?: ReactNode;
} & ComponentPropsWithoutRef<T>;

// Specialized type for any props
type AnyProps = Record<string, any>;

function Box<T extends ElementType = "div">({
    component,
    className,
    ...rest
}: BoxProps<T> & AnyProps) {
    const Component = component || "div";

    return (
        <Component
            className={clsx("relative break-words print:border", className)}
            {...rest}
        />
    );
}

export { Box };

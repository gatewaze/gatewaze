// Import Dependencies
import { ElementType, ForwardedRef, forwardRef, ReactNode } from "react";
import clsx from "clsx";

// Local Imports
import {
  PolymorphicComponentProps,
  PolymorphicRef,
} from "@/@types/polymorphic";

// ----------------------------------------------------------------------

type TableOwnProps<T extends ElementType = "table"> = {
  component?: T;
  children?: ReactNode;
  className?: string;
  hoverable?: boolean;
  zebra?: boolean;
  dense?: boolean;
  sticky?: boolean;
};

export type TableProps<E extends ElementType = "table"> =
  PolymorphicComponentProps<E, TableOwnProps<E>>;

const TableInner = forwardRef(
  <E extends ElementType = "table">(props: any, ref: ForwardedRef<any>) => {
    const {
      component,
      children,
      className,
      hoverable,
      zebra,
      dense,
      sticky,
      ...rest
    } = props as TableProps<E>;

    const Component = component || "table";

    return (
      <Component
        className={clsx(
          "table",
          hoverable && "is-hoverable",
          zebra && "is-zebra",
          dense && "is-dense",
          sticky && "is-sticky",
          className,
        )}
        ref={ref}
        {...rest}
      >
        {children}
      </Component>
    );
  },
);

type TableComponent = (<E extends ElementType = "table">(
  props: TableProps<E> & { ref?: PolymorphicRef<E> },
) => ReactNode) & { displayName?: string };

const Table = TableInner as TableComponent;
Table.displayName = "Table";

export { Table };

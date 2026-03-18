// Import Dependencies
import { ElementType, ReactNode } from "react";
import clsx from "clsx";
import { PolymorphicComponentProps } from "@/@types/polymorphic";

// ----------------------------------------------------------------------

// Polymorphic component type definition
type TableTagOwnProps<T extends ElementType> = {
  component?: T;
  className?: string;
  children?: ReactNode;
};

type TableTagProps<T extends ElementType> = PolymorphicComponentProps<T, TableTagOwnProps<T>>;

type TableTagFactoryProps = {
  className: string;
  component: ElementType;
}

function createTableTagComponent({
  className: defaultClassName,
  component: defaultComponent,
}: TableTagFactoryProps) {
  function TableComponent<T extends ElementType = typeof defaultComponent>({
    component,
    className,
    children,
    ...rest
  }: TableTagProps<T>) {
    const Component = component || defaultComponent;

    return (
      <Component
        className={clsx(defaultClassName, className)}
        {...rest}
      >
        {children}
      </Component>
    );
  }

  TableComponent.displayName = typeof defaultComponent === 'string'
    ? defaultComponent
    : 'TableComponent';

  return TableComponent;
}

export const TBody = createTableTagComponent({
  className: "table-tbody group/tbody",
  component: "tbody",
});

export const THead = createTableTagComponent({
  className: "table-thead group/thead",
  component: "thead",
});

export const TFoot = createTableTagComponent({
  className: "table-tfoot group/tfoot",
  component: "tfoot",
});

export const Tr = createTableTagComponent({
  className: "table-tr group/tr",
  component: "tr",
});

export const Th = createTableTagComponent({
  className: "table-th group/th",
  component: "th",
});

export const Td = createTableTagComponent({
  className: "table-td group/td",
  component: "td",
}); 
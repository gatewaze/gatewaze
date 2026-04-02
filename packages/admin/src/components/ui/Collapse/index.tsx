// Import Dependencies
import {
  ReactNode,
  CSSProperties,
  ElementType,
  forwardRef,
  ForwardedRef,
} from "react";

// Local Imports
import { useCollapse } from "@/hooks";
import { Box } from "@/components/ui";
import {
  PolymorphicComponentProps,
  PolymorphicRef,
} from "@/@types/polymorphic";

// ----------------------------------------------------------------------

type CollapseOwnProps<C extends ElementType = "div"> = {
  component?: C;
  children?: ReactNode;
  in: boolean;
  transitionDuration?: number;
  transitionTimingFunction?: CSSProperties["transitionTimingFunction"];
  min?: string;
  style?: CSSProperties;
  onTransitionEnd?: () => void;
  className?: string;
};

export type CollapseProps<C extends ElementType = "div"> =
  PolymorphicComponentProps<C, CollapseOwnProps<C>>;

const CollapseInner = forwardRef(
  <E extends ElementType = "div">(props: any, ref: ForwardedRef<any>) => {
    const {
      children,
      in: opened,
      transitionDuration,
      transitionTimingFunction,
      min,
      style,
      onTransitionEnd,
      component = "div",
      className,
      ...rest
    } = props as CollapseProps<E>;

    const getCollapseProps = useCollapse({
      opened,
      transitionDuration,
      transitionTimingFunction,
      min,
      onTransitionEnd,
    });

    if (transitionDuration === 0) {
      return opened ? (
        <Box
          component={component as any}
          ref={ref}
          className={className}
          {...rest}
        >
          {children}
        </Box>
      ) : null;
    }

    const boxProps = getCollapseProps({ style, className, ref, ...rest });
    return (
      <Box component={component as any} {...boxProps}>
        {children}
      </Box>
    );
  },
);

type CollapseComponent = (<E extends ElementType = "div">(
  props: CollapseProps<E> & { ref?: PolymorphicRef<E> },
) => ReactNode) & { displayName?: string };

const Collapse = CollapseInner as CollapseComponent;
Collapse.displayName = "Collapse";

export { Collapse };

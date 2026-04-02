import {
  ElementType,
  ComponentPropsWithRef,
  ComponentPropsWithoutRef,
} from "react";

export type PolymorphicRef<E extends ElementType> =
  ComponentPropsWithRef<E>["ref"];

export type AsProp<E extends ElementType> = {
  component?: E;
};

export type PropsToOmit<E extends ElementType, P> = keyof (AsProp<E> & P);

export type PolymorphicComponentProps<
  E extends ElementType,
  Props = Record<string, unknown>,
> = Omit<ComponentPropsWithoutRef<E>, PropsToOmit<E, Props>> &
  Props &
  AsProp<E>;

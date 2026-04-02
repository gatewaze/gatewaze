// Local Imports
import { ReactNode } from "react";
import { useId, useUncontrolled } from "@/hooks";
import { AccordionContextProvider } from "./Accordion.context";
import { PolymorphicComponentProps } from "@/@types/polymorphic";

type AccordionProviderOwnProps = {
  children: ReactNode;
  multiple?: boolean;
  value?: string | string[];
  defaultValue?: string | string[];
  onChange?: (value: string | string[]) => void;
  id?: string;
  transitionDuration?: number;
  loop?: boolean;
}

export type AccordionProviderProps =
  PolymorphicComponentProps<"div", AccordionProviderOwnProps>;

export function AccordionProvider({
  children,
  multiple = false,
  value,
  defaultValue,
  onChange,
  id,
  transitionDuration,
  loop,
}: AccordionProviderProps) {
  const uid = useId(id, "accordion");

  const [_value, handleChange] = useUncontrolled<string | string[]>({
    value,
    defaultValue,
    finalValue: multiple ? [] : "",
    onChange,
  });

  const isItemActive = (itemValue: string): boolean =>
    Array.isArray(_value) ? _value.includes(itemValue) : _value === itemValue;

  const handleItemChange = (itemValue: string) => {
    const nextValue: string | string[] = Array.isArray(_value)
      ? _value.includes(itemValue)
        ? _value.filter((selectedValue) => selectedValue !== itemValue)
        : [..._value, itemValue]
      : itemValue === _value
        ? ""
        : itemValue;

    handleChange(nextValue);
  };

  return (
    <AccordionContextProvider
      value={{
        isItemActive,
        onChange: handleItemChange,
        buttonId: `${uid}-control`,
        panelId: `${uid}-panel`,
        transitionDuration,
        loop,
      }}
    >
      {children}
    </AccordionContextProvider>
  );
}

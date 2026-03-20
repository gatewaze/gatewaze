import { createSafeContext } from "@/utils/createSafeContext";

interface AccordionItemContext {
  value: string;
}

export const [AccordionItemContextProvider, useAccordionItemContext] =
  createSafeContext<AccordionItemContext>(
    "useAccordionItemContext must be used within AccordionItemProvider",
  );

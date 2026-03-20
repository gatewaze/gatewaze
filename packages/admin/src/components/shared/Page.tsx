// Import Dependencies
import { ElementType, Fragment, ReactNode } from "react";

// Local Imports
import { APP_NAME } from "@/constants/app";
import { useDocumentTitle } from "@/hooks/index";

// ----------------------------------------------------------------------

type PageProps<T extends ElementType = typeof Fragment> = {
  title?: string;
  component?: T;
  children: ReactNode;
} & React.ComponentPropsWithoutRef<T>;

function Page<T extends ElementType = typeof Fragment>({
  title = "",
  component,
  children,
  ...rest
}: PageProps<T>) {
  const Component: ElementType = component || Fragment;
  useDocumentTitle(`${title} - ${APP_NAME}`);

  return <Component {...rest}>{children}</Component>;
}

export { Page };
